import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, FileText, Printer, ShoppingCart } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import BotoneraProductos from '../../components/ventas/BotoneraProductos'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import {
  crearVentaVentanilla, subscribeVentaVentanilla, subscribeVentanillaDelDia,
} from '../../services/ventaVentanillaService'
import { getTopeConsumidorFinalSinIdentificar } from '../../services/arcaConfigService'
import { generateComprobanteVentanilla } from '../../utils/pdf'
import { generateFacturaArcaPdf } from '../../utils/facturaArcaPdf'
import { armarFacturaDeVenta } from '../../utils/facturaDeVenta'
import { generateQrDataUrl } from '../../utils/qr'
import { usePreciosTango } from '../../hooks/usePreciosTango'
import { empresaDeCanal, motivoSinPrecioTango, precioTangoDe } from '../../utils/precioTango'
import { documentoDeVenta } from '../../utils/circuitoDocumento'
import { esClienteFacturable, esCuitValido } from '../../utils/facturable'
import {
  CanalVenta, FormaPago, PLANTAS, VentaCamionItem, VentaVentanilla,
} from '../../types'
import { reportError } from '@/services/observability'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

const CANALES: { id: CanalVenta; label: string }[] = [
  { id: 'contado', label: 'Venta Contado (Redonhielo)' },
  { id: 'promo',   label: 'Promo (Rolito)' },
]
const FORMAS_PAGO: { id: FormaPago; label: string; soloRegistrado?: boolean }[] = [
  { id: 'contado_efectivo',      label: 'Efectivo' },
  { id: 'contado_transferencia', label: 'Transferencia' },
  { id: 'cuenta_corriente',      label: 'Cuenta corriente', soloRegistrado: true },
]

// Cuánto se espera el CAE antes de ofrecerle a caja seguir sin la factura.
// ARCA suele responder en segundos; si pasa de esto, algo está lento y el
// mostrador no puede quedar frenado indefinidamente.
const ESPERA_CAE_MS = 45_000

const nroFactura = (v: VentaVentanilla) =>
  v.factura
    ? `${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
    : ''

// Venta por ventanilla (caja): terceros que compran en el mostrador. Cliente
// registrado → su lista de precios; ocasional → la lista que elija caja.
//
// Mismo circuito de documentos que el camión (docs/arca §11): contado en
// efectivo o transferencia → factura electrónica por ARCA, que emite la Cloud
// Function al crearse la venta; cuenta corriente → remito (la factura la
// oficina); promo → no oficial. Decisión 2026-09-03: en el mostrador NO se
// imprime nada hasta tener el CAE — caja espera unos segundos y sale la
// factura junto con el turno. Muelle entrega contra el turno.
export default function VentanillaPage() {
  const { user } = useAuth()
  const { clientes } = useClientesActivos()
  const { listas } = useAllListasPrecios()
  const { catalogo } = useCatalogo()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const [tipoCliente, setTipoCliente] = useState<'registrado' | 'ocasional'>('registrado')
  const [clienteId,   setClienteId]   = useState('')
  const [ocasionalNombre, setOcasionalNombre] = useState('')
  const [ocasionalCuit,   setOcasionalCuit]   = useState('')
  const [ocasionalDni,    setOcasionalDni]    = useState('')
  const [listaOcasionalId, setListaOcasionalId] = useState('')
  const [canal,       setCanal]       = useState<CanalVenta>('contado')
  const [cantidades,  setCantidades]  = useState<Record<string, number>>({})
  const [formaPago,   setFormaPago]   = useState<FormaPago | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [ventas,      setVentas]      = useState<VentaVentanilla[]>([])
  // Tope de ARCA para facturar a un consumidor final sin CUIT ni DNI. 0 =
  // siempre pedir documento (también mientras no se cargó en config/arca).
  const [topeSinIdentificar, setTopeSinIdentificar] = useState(0)
  // Venta recién cobrada cuya factura se está esperando (modal).
  const [esperando, setEsperando] = useState<VentaVentanilla | null>(null)

  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentas), [plantaId, fecha])
  useEffect(() => { getTopeConsumidorFinalSinIdentificar().then(setTopeSinIdentificar) }, [])

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.uid, c])), [clientes])
  // Cliente registrado: precios de Tango (contado → Redonhielo, promo →
  // Rolito; especial del cliente o su lista). Sin precio en Tango no se
  // vende. Ocasional: la lista de la app que elija caja.
  const empresa = empresaDeCanal(canal)
  const { precios: preciosTango } = usePreciosTango(empresa, { enabled: tipoCliente === 'registrado' })
  const registrado = tipoCliente === 'registrado'
  const listaOcasional = registrado ? undefined : listas.find((l) => l.id === listaOcasionalId)
  const sinPrecioMotivo = registrado && cliente ? motivoSinPrecioTango(preciosTango, cliente, empresa) : null

  const precioDe = (productoId: string): number => {
    if (registrado) return cliente ? (precioTangoDe(preciosTango, cliente, empresa, productoId)?.precio ?? 0) : 0
    return listaOcasional?.items.find((i) => i.productoId === productoId)?.precio ?? 0
  }
  const sinPrecio = (productoId: string): boolean =>
    registrado && (!cliente || precioTangoDe(preciosTango, cliente, empresa, productoId) === null)

  const items: VentaCamionItem[] = catalogo
    .filter((p) => (cantidades[p.id] ?? 0) > 0)
    .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: cantidades[p.id], precioUnitario: precioDe(p.id) }))
  const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)

  // Qué papel sale de esta venta. Con la forma de pago sin elegir se asume la
  // que factura, que es justo cuando hace falta avisar.
  const documento = documentoDeVenta(canal, formaPago ?? 'contado_efectivo', total)
  const vaAFacturar = documento === 'factura_arca'

  // Aviso fiscal ANTES de cobrar (la autoridad es el servidor; esto evita
  // cobrar una venta cuya factura va a rebotar).
  const avisoFiscal = useMemo((): string | null => {
    if (!vaAFacturar) return null
    if (tipoCliente === 'registrado') {
      if (!cliente) return null
      const r = esClienteFacturable(cliente)
      return r.facturable ? null : `A este cliente no se le puede facturar: ${r.motivos.join(', ')}. Corregí su ficha o cobrale por cuenta corriente.`
    }
    const cuit = ocasionalCuit.trim()
    const dni  = ocasionalDni.trim()
    if (cuit) return esCuitValido(cuit) ? null : 'El CUIT del ocasional no es válido.'
    if (dni)  return dni.length === 7 || dni.length === 8 ? null : 'El DNI tiene que tener 7 u 8 dígitos.'
    if (topeSinIdentificar <= 0) return 'Para facturar a un consumidor final hace falta CUIT o DNI.'
    if (total > topeSinIdentificar) return `Por más de ${money(topeSinIdentificar)} ARCA exige CUIT o DNI del cliente.`
    return null
  }, [vaAFacturar, tipoCliente, cliente, ocasionalCuit, ocasionalDni, topeSinIdentificar, total])

  const abrirConfirmacion = () => {
    setError('')
    if (tipoCliente === 'registrado' && !cliente) { setError('Elegí el cliente.'); return }
    if (tipoCliente === 'ocasional' && !ocasionalNombre.trim()) { setError('Poné el nombre del cliente ocasional.'); return }
    if (tipoCliente === 'ocasional' && !listaOcasional) { setError('Elegí la lista de precios para el ocasional.'); return }
    if (sinPrecioMotivo || items.some((i) => sinPrecio(i.productoId))) { setError('Hay productos sin precio en Tango para este cliente. Corregilo en Tango y sincronizá.'); return }
    if (items.length === 0) { setError('Cargá al menos un producto.'); return }
    if (!formaPago) { setError('Elegí la forma de pago.'); return }
    if (formaPago === 'cuenta_corriente' && tipoCliente === 'ocasional') { setError('Cuenta corriente solo para clientes registrados.'); return }
    if (avisoFiscal) { setError(avisoFiscal); return }
    setConfirmando(true)
  }

  // Comprobante de turno: número grande + QR de seguimiento. Es contra lo que
  // muelle entrega.
  const imprimirTurno = async (v: VentaVentanilla) => {
    try {
      const qrDataUrl = await generateQrDataUrl(
        `${window.location.origin}/turnos/${v.plantaId}?turno=${v.turno}`,
      )
      await generateComprobanteVentanilla({
        id:            v.id,
        plantaId:      v.plantaId,
        canal:         v.canal,
        clienteNombre: v.clienteNombre,
        clienteCuit:   v.clienteOcasional?.cuit ?? clientePorId.get(v.clienteId ?? '')?.cuit,
        items:         v.items,
        total:         v.total,
        formaPago:     v.formaPago,
        cajaNombre:    v.cajaNombre,
        fecha:         v.fecha.toDate(),
        turno:         v.turno,
        qrDataUrl,
      })
    } catch (err) {
      reportError(err, { origen: 'VentanillaPage', accion: 'error al generar el comprobante de turno' })
    }
  }

  // Factura electrónica: con los importes tal como se declararon a ARCA.
  const imprimirFactura = async (v: VentaVentanilla): Promise<boolean> => {
    const armado = armarFacturaDeVenta(v, v.clienteId ? clientePorId.get(v.clienteId) : undefined)
    if (!armado.ok) { setError(armado.motivo); return false }
    try {
      await generateFacturaArcaPdf({ ...armado.datos, descargar: true })
      return true
    } catch (err) {
      reportError(err, { origen: 'VentanillaPage', accion: 'error al generar la factura' })
      setError('No se pudo generar el PDF de la factura. Reimprimila desde el listado.')
      return false
    }
  }

  const limpiar = () => {
    setClienteId('')
    setOcasionalNombre('')
    setOcasionalCuit('')
    setOcasionalDni('')
    setCantidades({})
    setFormaPago(null)
  }

  const confirmar = async () => {
    if (!user || !formaPago) return
    setGuardando(true)
    setError('')
    try {
      const venta = await crearVentaVentanilla(
        {
          canal,
          cliente: tipoCliente === 'registrado' && cliente
            ? { uid: cliente.uid, nombre: cliente.razonSocial || cliente.nombre, codigoTango: cliente.codigoTango, idGva14Tango: cliente.idGva14Tango }
            : undefined,
          ocasional: tipoCliente === 'ocasional'
            ? {
                nombre: ocasionalNombre.trim(),
                ...(ocasionalCuit.trim() ? { cuit: ocasionalCuit.trim() } : {}),
                ...(ocasionalDni.trim()  ? { dni:  ocasionalDni.trim() }  : {}),
              }
            : undefined,
          items,
          formaPago,
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      limpiar()
      if (documentoDeVenta(venta.canal, venta.formaPago, venta.total) === 'factura_arca') {
        // Nada se imprime hasta tener el CAE: se espera en el modal.
        setEsperando(venta)
      } else {
        imprimirTurno(venta)
      }
    } catch (err) {
      reportError(err, { origen: 'VentanillaPage', accion: 'error al crear la venta' })
      setError('No se pudo registrar la venta. Revisá la conexión e intentá de nuevo.')
      setConfirmando(false)
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const toggleClass = (activo: boolean) =>
    `flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
      activo ? 'bg-accent/10 border-accent text-accent' : 'bg-white border-[#D3D1C7] text-gray-600 hover:bg-gray-50'
    }`

  const estadoFactura = (v: VentaVentanilla) => {
    if (documentoDeVenta(v.canal, v.formaPago, v.total) !== 'factura_arca') return null
    const f = v.factura
    if (f?.estado === 'emitida' && f.cae) return { texto: `Factura ${nroFactura(v)}`, clase: 'text-gray-600', imprimible: true }
    if (f?.estado === 'rechazada') return { texto: 'ARCA rechazó la factura', clase: 'text-red-700', imprimible: false }
    if (f?.estado === 'incierta') return { texto: 'Factura en revisión', clase: 'text-amber-700', imprimible: false }
    return { texto: 'Facturando…', clase: 'text-gray-400', imprimible: false }
  }

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ventanilla</h1>
        <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
      </div>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <ShoppingCart size={18} className="text-accent" /> Nueva venta
        </h2>

        {/* Cliente */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setTipoCliente('registrado')} className={toggleClass(tipoCliente === 'registrado')}>Cliente registrado</button>
          <button type="button" onClick={() => { setTipoCliente('ocasional'); if (formaPago === 'cuenta_corriente') setFormaPago(null) }} className={toggleClass(tipoCliente === 'ocasional')}>Ocasional</button>
        </div>

        {tipoCliente === 'registrado' ? (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Cliente</label>
            <ClienteCombobox items={toComboItems(clientes)} value={clienteId} onChange={setClienteId} placeholder="Buscar cliente…" />
            {sinPrecioMotivo && (
              <p className="text-xs text-amber-600 mt-1">{sinPrecioMotivo} No se puede vender hasta que se corrija en Tango y se sincronice.</p>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
              <input value={ocasionalNombre} onChange={(e) => setOcasionalNombre(e.target.value)} placeholder="Juan Pérez" className={selectClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">CUIT (opcional)</label>
              <input value={ocasionalCuit} onChange={(e) => setOcasionalCuit(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="20360242871" className={selectClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">DNI (si no tiene CUIT)</label>
              <input value={ocasionalDni} onChange={(e) => setOcasionalDni(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="36024287" className={selectClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Lista de precios</label>
              <select value={listaOcasionalId} onChange={(e) => setListaOcasionalId(e.target.value)} className={selectClass}>
                <option value="">Elegir lista…</option>
                {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Canal */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Canal</label>
          <div className="flex gap-2">
            {CANALES.map((c) => (
              <button key={c.id} type="button" onClick={() => setCanal(c.id)} className={toggleClass(canal === c.id)}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* Productos */}
        <div>
          <p className="text-xs text-gray-500 mb-2">Mercadería</p>
          <BotoneraProductos
            catalogo={catalogo}
            precioDe={precioDe}
            sinPrecio={sinPrecio}
            cantidades={cantidades}
            onChange={setCantidades}
          />
        </div>

        {/* Forma de pago */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Forma de pago</label>
          <div className="flex gap-2">
            {FORMAS_PAGO.filter((f) => !f.soloRegistrado || tipoCliente === 'registrado').map((f) => (
              <button key={f.id} type="button" onClick={() => setFormaPago(f.id)} className={toggleClass(formaPago === f.id)}>{f.label}</button>
            ))}
          </div>
          {vaAFacturar && (
            <p className="text-xs text-gray-500 mt-1.5">
              Sale factura electrónica: se imprime cuando ARCA responde (unos segundos).
            </p>
          )}
        </div>

        {avisoFiscal && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
            <p className="text-amber-800 text-sm">{avisoFiscal}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-bold text-gray-900">Total: {money(total)}</p>
          <Button onClick={abrirConfirmacion} disabled={items.length === 0 || sinPrecioMotivo !== null || items.some((i) => sinPrecio(i.productoId))}>
            {vaAFacturar ? 'Cobrar y facturar' : 'Cobrar y emitir comprobante'}
          </Button>
        </div>
      </section>

      {/* Ventas del día */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">Ventanilla de hoy</h2>
        {ventas.length === 0 && <p className="text-gray-400 text-sm">Todavía no hubo ventas por ventanilla hoy.</p>}
        {ventas.map((v) => {
          const fac = estadoFactura(v)
          return (
            <div key={v.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
              <span className="shrink-0 w-11 h-11 rounded-xl bg-accent/10 text-accent font-black text-lg flex items-center justify-center">
                {v.turno}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{v.clienteNombre}</p>
                <p className="text-xs text-gray-500">
                  {money(v.total)} · {FORMAS_PAGO.find((f) => f.id === v.formaPago)?.label} · {v.canal === 'contado' ? 'Contado' : 'Promo'}
                  {fac && <span className={`ml-1 ${fac.clase}`}>· {fac.texto}</span>}
                </p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${
                v.estado === 'entregado' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'
              }`}>
                {v.estado === 'entregado' ? 'Entregado' : 'Para entregar'}
              </span>
              {fac?.imprimible && (
                <button onClick={() => imprimirFactura(v)} title="Reimprimir factura" className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
                  <FileText size={16} />
                </button>
              )}
              <button onClick={() => imprimirTurno(v)} title="Reimprimir turno" className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
                <Printer size={16} />
              </button>
            </div>
          )
        })}
      </section>

      {/* Confirmación */}
      {confirmando && (
        <Modal open onClose={() => setConfirmando(false)} title="Confirmar venta">
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{tipoCliente === 'registrado' ? (cliente?.razonSocial || cliente?.nombre) : ocasionalNombre}</span>
              {' '}· {CANALES.find((c) => c.id === canal)?.label} · {FORMAS_PAGO.find((f) => f.id === formaPago)?.label}
            </p>
            <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 text-sm">
              {items.map((i) => (
                <div key={i.productoId} className="flex justify-between px-3 py-1.5">
                  <span className="text-gray-700">{i.cantidad} × {i.nombre}</span>
                  <span className="font-medium text-gray-900">{money(i.precioUnitario * i.cantidad)}</span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-1.5 bg-gray-50 font-semibold">
                <span>Total</span><span>{money(total)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {vaAFacturar
                ? 'Se pide el CAE a ARCA y se imprimen la factura y el turno. Muelle entrega contra el turno.'
                : 'Se imprime el comprobante — muelle entrega la mercadería contra ese papel.'}
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">
                {vaAFacturar ? 'Confirmar y facturar' : 'Confirmar e imprimir'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {esperando && (
        <EsperaFacturaModal
          ventaId={esperando.id}
          onImprimirFactura={imprimirFactura}
          onImprimirTurno={imprimirTurno}
          onClose={() => setEsperando(null)}
        />
      )}
    </main>
  )
}

// ── Espera del CAE ────────────────────────────────────────────────────────────
// Se suscribe a la venta recién creada y reacciona cuando el trigger escribe
// `factura`. Emitida → imprime factura y turno una sola vez. Rechazada o
// incierta → lo dice y deja imprimir el turno igual (la mercadería ya se
// cobró; la factura la resuelve la oficina, que recibe el aviso por mail).
function EsperaFacturaModal({ ventaId, onImprimirFactura, onImprimirTurno, onClose }: {
  ventaId: string
  onImprimirFactura: (v: VentaVentanilla) => Promise<boolean>
  onImprimirTurno: (v: VentaVentanilla) => Promise<void>
  onClose: () => void
}) {
  const [venta, setVenta] = useState<VentaVentanilla | null>(null)
  const [tardando, setTardando] = useState(false)
  const [impresa, setImpresa] = useState(false)
  const impresoRef = useRef(false)

  useEffect(() => subscribeVentaVentanilla(ventaId, setVenta), [ventaId])
  useEffect(() => {
    const t = setTimeout(() => setTardando(true), ESPERA_CAE_MS)
    return () => clearTimeout(t)
  }, [])

  const f = venta?.factura
  const emitida = f?.estado === 'emitida' && !!f.cae

  // Impresión automática, una sola vez, apenas llega el CAE.
  useEffect(() => {
    if (!venta || !emitida || impresoRef.current) return
    impresoRef.current = true
    ;(async () => {
      const ok = await onImprimirFactura(venta)
      await onImprimirTurno(venta)
      setImpresa(ok)
    })()
  }, [venta, emitida, onImprimirFactura, onImprimirTurno])

  const titulo = emitida ? 'Factura emitida'
    : f?.estado === 'rechazada' ? 'ARCA rechazó la factura'
    : f?.estado === 'incierta' ? 'Factura en revisión'
    : 'Facturando…'

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="space-y-3">
        {!f && (
          <div className="flex items-center gap-3 py-2">
            <LoadingSpinner />
            <div>
              <p className="text-sm text-gray-800">Pidiendo el CAE a ARCA. Suele tardar unos segundos.</p>
              {tardando && (
                <p className="text-xs text-amber-700 mt-1">
                  Está tardando más de lo normal. Podés imprimir el turno para que muelle entregue; la factura
                  se imprime desde el listado cuando llegue, y si no llega la oficina recibe el aviso.
                </p>
              )}
            </div>
          </div>
        )}

        {emitida && venta && (
          <div className="flex items-start gap-2">
            <CheckCircle2 size={18} className="text-accent mt-0.5 shrink-0" />
            <p className="text-sm text-gray-800">
              Factura {nroFactura(venta)} autorizada.{' '}
              {impresa ? 'Se generaron la factura y el turno.' : 'Generando los comprobantes…'}
            </p>
          </div>
        )}

        {f?.estado === 'rechazada' && (
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-800">
              ARCA no autorizó esta factura. La venta quedó registrada y cobrada: entregá contra el turno y
              avisá a la oficina, que también recibe el detalle por mail.
            </p>
          </div>
        )}

        {f?.estado === 'incierta' && (
          <div className="flex items-start gap-2">
            <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-800">
              Se pidió el CAE y ARCA no respondió a tiempo. Se resuelve solo dentro de la hora; la factura se
              imprime desde el listado cuando aparezca. Entregá contra el turno.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {venta && (emitida ? (
            <Button variant="outline" onClick={() => { onImprimirFactura(venta); onImprimirTurno(venta) }} className="flex-1">
              Reimprimir
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onImprimirTurno(venta)} className="flex-1" disabled={!f && !tardando}>
              Imprimir solo el turno
            </Button>
          ))}
          <Button onClick={onClose} className="flex-1" disabled={!f && !tardando}>Listo</Button>
        </div>
      </div>
    </Modal>
  )
}
