import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock, FileText, Printer, ShoppingCart } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import SelectorSucursal from '@/components/ventas/SelectorSucursal'
import { clienteEnSucursal, necesitaSucursal } from '@/utils/sucursalesTango'
import { clienteImpreso } from '@/utils/clienteImpreso'
import BotoneraProductos from '../../components/ventas/BotoneraProductos'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useDiaActual, useFechaDelDia } from '../../hooks/useDiaActual'
import { useMiMostrador } from '@/hooks/useMiMostrador'
import MiDiaMostrador from '@/components/expedicion/MiDiaMostrador'
import SolicitarAnulacionModal from '@/components/expedicion/SolicitarAnulacionModal'
import { subscribeRendicion } from '@/services/rendicionService'
import {
  crearVentaVentanilla, subscribeVentaVentanilla, subscribeVentanillaDelDia,
} from '../../services/ventaVentanillaService'
import { getPreciosIncluyenIva, getTopeConsumidorFinalSinIdentificar } from '../../services/arcaConfigService'
import { desgloseFactura, percepcionVigenteDe } from '@/utils/totalFacturado'
import { nombreSucursalVenta } from '@/utils/sucursalesTango'
import type { FacturaArcaData } from '../../utils/facturaArcaPdf'
import { armarFacturaDeVenta, armarNotaCreditoDeVenta } from '../../utils/facturaDeVenta'
import { generateTicketsVentanilla, type TurnoTicketData } from '@/utils/ventanillaTicket'
import { imprimirPdf, leerModoImpresion, guardarModoImpresion, MODOS_IMPRESION, type ModoImpresion } from '@/utils/ticketTermico'
import { usePreciosTango } from '../../hooks/usePreciosTango'
import { useCopiasTicketVentanilla } from '@/hooks/useCopiasTicketVentanilla'
import { empresaDeCanal, motivoSinPrecioTango, precioTangoDe } from '../../utils/precioTango'
import { documentoDeVenta } from '../../utils/circuitoDocumento'
import { esClienteFacturable, esCuitValido } from '../../utils/facturable'
import { inhabilitadoEnTango, motivoInhabilitado } from '@/utils/inhabilitadoTango'
import { admiteCuentaCorriente } from '@/utils/condicionVenta'
import {
  CanalVenta, FormaPago, PLANTAS, VentaCamionItem, VentaVentanilla, type AnulacionEnVenta, type Rendicion,
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

// Estado de la anulación de la factura (nota de crédito, 2026-09-09), tal como
// lo escribe el server en la venta.
const textoAnulacion = (a: AnulacionEnVenta): { texto: string; clase: string } => {
  const nc = a.notaCredito
  switch (a.estado) {
    case 'pendiente': return { texto: 'Anulación pendiente de autorizar', clase: 'text-amber-700' }
    case 'aprobada':  return { texto: 'Anulación aprobada · emitiendo la nota de crédito…', clase: 'text-amber-700' }
    case 'anulada':   return { texto: `ANULADA · Nota de crédito ${nc ? `${String(nc.puntoVenta).padStart(5, '0')}-${String(nc.numero).padStart(8, '0')}` : ''}`, clase: 'text-red-700 font-semibold' }
    case 'rechazada': return { texto: 'Anulación rechazada: la factura sigue vigente', clase: 'text-gray-600' }
    case 'error':     return { texto: 'No se pudo emitir la nota de crédito: avisá a administración', clase: 'text-red-700' }
  }
}

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
  const { catalogo } = useCatalogo()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()
  const dia   = useDiaActual()

  const [tipoCliente, setTipoCliente] = useState<'registrado' | 'ocasional'>('registrado')
  const [clienteId,   setClienteId]   = useState('')
  const [ocasionalNombre, setOcasionalNombre] = useState('')
  // Orden de compra del cliente registrado (opcional, 2026-09-11): remito/factura y leyenda en Tango.
  const [ordenCompra, setOrdenCompra] = useState('')
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
  // Con la caja del día cerrada ya no se puede pedir anular (la venta ya se rindió).
  const [cerrada,     setCerrada]     = useState<Rendicion | null>(null)
  const [anulando,    setAnulando]    = useState<VentaVentanilla | null>(null)
  // Tope de ARCA para facturar a un consumidor final sin CUIT ni DNI. 0 =
  // siempre pedir documento (también mientras no se cargó en config/arca).
  const [topeSinIdentificar, setTopeSinIdentificar] = useState(0)
  // Venta recién cobrada cuya factura se está esperando (modal).
  const [esperando, setEsperando] = useState<VentaVentanilla | null>(null)
  // Cómo imprime ESTE dispositivo (tablet con RawBT por Bluetooth, o el
  // diálogo/descarga de siempre). Se guarda en el aparato, no en la cuenta.
  const [modoImpresion, setModoImpresion] = useState<ModoImpresion>(() => leerModoImpresion())
  const cambiarModoImpresion = (m: ModoImpresion) => { guardarModoImpresion(m); setModoImpresion(m) }

  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentas), [plantaId, fecha])
  useEffect(() => { if (!user) return; return subscribeRendicion(dia, user.uid, setCerrada) }, [user, dia])
  useEffect(() => { getTopeConsumidorFinalSinIdentificar().then(setTopeSinIdentificar) }, [])
  // Con precios netos la factura suma el IVA: se muestra el total que va a salir (2026-09-11).
  const [preciosIncluyenIva, setPreciosIncluyenIva] = useState(false)
  useEffect(() => { getPreciosIncluyenIva().then(setPreciosIncluyenIva) }, [])
  // Copias del comprobante de turno (original cliente / duplicado muelle /
  // triplicado seguridad) según config/ventanilla; aplica también a la reimpresión.
  const copiasTicket = useCopiasTicketVentanilla()
  // Mi día: mis ventas (del stream de la planta), mis cobranzas y las
  // liquidaciones que cerré (el efectivo recibido entra a mi caja).
  const misVentas = useMemo(() => ventas.filter((v) => v.cajaId === user?.uid), [ventas, user?.uid])
  const mio = useMiMostrador(user?.uid, dia, misVentas)

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.uid, c])), [clientes])
  // Cuenta corriente solo si Tango la tiene habilitada para el cliente (su
  // condición de venta); a un CONTADO el Facturador le rechaza la cuota.
  const ctaCte = tipoCliente === 'registrado' ? admiteCuentaCorriente(cliente) : { ok: false as const }
  useEffect(() => { if (formaPago === 'cuenta_corriente' && !ctaCte.ok) setFormaPago(null) }, [formaPago, ctaCte.ok])
  // Sucursal (código de Tango) cuando la cuenta tiene varias en la empresa del canal.
  const [sucursal, setSucursal] = useState('')
  useEffect(() => { setSucursal('') }, [clienteId, canal])
  const faltaSucursal = tipoCliente === 'registrado' && necesitaSucursal(cliente, empresaDeCanal(canal)) && !sucursal
  // Cliente registrado: precios de Tango (contado → Redonhielo, promo →
  // Rolito; especial del cliente o su lista). Sin precio en Tango no se
  // vende. Ocasional: la lista de la app que elija caja.
  // Precios de Tango de la empresa del canal (contado → Redonhielo, promo →
  // Rolito). Registrado: especial del cliente o su lista. Ocasional: la lista
  // de Tango que elija caja (solo las que tienen algún precio cargado).
  const empresa = empresaDeCanal(canal)
  const { precios: preciosTango } = usePreciosTango(empresa)
  const registrado = tipoCliente === 'registrado'
  const listasOcasional = useMemo(
    () => Object.entries(preciosTango?.listas ?? {})
      .map(([nro, l]) => ({ nro, nombre: l.nombre, precios: l.precios }))
      .filter((l) => Object.values(l.precios).some((p) => p > 0))
      .sort((a, b) => Number(a.nro) - Number(b.nro)),
    [preciosTango],
  )
  const listaOcasional = registrado ? undefined : listasOcasional.find((l) => l.nro === listaOcasionalId)
  const sinPrecioMotivo = registrado && cliente ? motivoSinPrecioTango(preciosTango, cliente, empresa) : null

  const precioDe = (productoId: string): number => {
    if (registrado) return cliente ? (precioTangoDe(preciosTango, cliente, empresa, productoId)?.precio ?? 0) : 0
    return listaOcasional?.precios[productoId] ?? 0
  }
  const sinPrecio = (productoId: string): boolean =>
    registrado
      ? (!cliente || precioTangoDe(preciosTango, cliente, empresa, productoId) === null)
      : !((listaOcasional?.precios[productoId] ?? 0) > 0)

  const items: VentaCamionItem[] = catalogo
    .filter((p) => (cantidades[p.id] ?? 0) > 0)
    .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: cantidades[p.id], precioUnitario: precioDe(p.id) }))
  const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)

  // Qué papel sale de esta venta. Con la forma de pago sin elegir se asume la
  // que factura, que es justo cuando hace falta avisar.
  const documento = documentoDeVenta(canal, formaPago ?? 'contado_efectivo', total)
  const vaAFacturar = documento === 'factura_arca'
  // Neto + IVA + percepción de IIBB (solo cliente registrado en el padrón): lo que va a facturar ARCA.
  const conIva = vaAFacturar && items.length > 0
    ? desgloseFactura(items, { preciosIncluyenIva, percepcionAlicuota: tipoCliente === 'registrado' ? percepcionVigenteDe(cliente) : 0 })
    : null

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

  // Inhabilitado en Tango en la empresa del canal: no se vende, con el documento que sea.
  const avisoInhabilitado = tipoCliente === 'registrado' && cliente && inhabilitadoEnTango(cliente, empresa) ? motivoInhabilitado(empresa) : null

  const abrirConfirmacion = () => {
    setError('')
    if (tipoCliente === 'registrado' && !cliente) { setError('Elegí el cliente.'); return }
    if (tipoCliente === 'ocasional' && !ocasionalNombre.trim()) { setError('Poné el nombre del cliente ocasional.'); return }
    if (tipoCliente === 'ocasional' && !listaOcasional) { setError('Elegí la lista de precios para el ocasional.'); return }
    if (sinPrecioMotivo || items.some((i) => sinPrecio(i.productoId))) { setError('Hay productos sin precio en Tango para este cliente. Corregilo en Tango y sincronizá.'); return }
    if (items.length === 0) { setError('Cargá al menos un producto.'); return }
    if (!formaPago) { setError('Elegí la forma de pago.'); return }
    if (formaPago === 'cuenta_corriente' && !ctaCte.ok) { setError(ctaCte.motivo ?? 'Cuenta corriente solo para clientes registrados.'); return }
    if (avisoInhabilitado) { setError(avisoInhabilitado); return }
    if (avisoFiscal) { setError(avisoFiscal); return }
    setConfirmando(true)
  }

  // Los papeles del mostrador salen por la impresora térmica de 80 mm
  // (Eliprinter RP-8060P) en un solo trabajo de impresión: la factura
  // electrónica (si la hay) y el comprobante de turno, que es contra lo que
  // muelle entrega. Devuelve true si se generó todo lo pedido.
  const imprimir = async (v: VentaVentanilla, partes: { factura: boolean; turno: boolean }): Promise<boolean> => {
    let facturaDatos: FacturaArcaData | undefined
    let facturaOk = true
    if (partes.factura) {
      const armado = armarFacturaDeVenta(v, v.clienteId ? clientePorId.get(v.clienteId) : undefined)
      if (armado.ok) facturaDatos = armado.datos
      else { setError(armado.motivo); facturaOk = false }
    }
    const turnoDatos: TurnoTicketData | undefined = partes.turno ? {
      plantaId:      v.plantaId,
      canal:         v.canal,
      clienteNombre: v.clienteNombre,
      clienteCuit:   v.clienteOcasional?.cuit ?? clientePorId.get(v.clienteId ?? '')?.cuit,
      // Sucursal a la que va la carga (cuentas con varias): muelle entrega contra este papel.
      sucursal:      v.clienteId ? clienteImpreso(v, clientePorId.get(v.clienteId)).sucursal || undefined : undefined,
      items:         v.items,
      total:         v.total,
      formaPago:     v.formaPago,
      cajaNombre:    v.cajaNombre,
      fecha:         v.fecha.toDate(),
      turno:         v.turno,
      urlTurno:      `${window.location.origin}/turnos/${v.plantaId}?turno=${v.turno}`,
      facturaNro:    v.factura?.estado === 'emitida' ? nroFactura(v) : undefined,
    } : undefined
    if (!facturaDatos && !turnoDatos) return false
    try {
      const blob = await generateTicketsVentanilla({ factura: facturaDatos, turno: turnoDatos, copiasTurno: copiasTicket[v.plantaId] })
      await imprimirPdf(blob, `ventanilla-turno-${v.turno}.pdf`, modoImpresion)
      return facturaOk
    } catch (err) {
      reportError(err, { origen: 'VentanillaPage', accion: 'error al generar los tickets de ventanilla' })
      setError('No se pudo generar el ticket. Reimprimilo desde el listado.')
      return false
    }
  }
  const imprimirTurno   = (v: VentaVentanilla) => imprimir(v, { factura: false, turno: true })
  const imprimirFactura = (v: VentaVentanilla) => imprimir(v, { factura: true, turno: false })
  const imprimirTodo    = (v: VentaVentanilla) => imprimir(v, { factura: true, turno: true })
  const imprimirNotaCredito = async (v: VentaVentanilla) => {
    const armado = armarNotaCreditoDeVenta(v, v.clienteId ? clientePorId.get(v.clienteId) : undefined)
    if (!armado.ok) { setError(armado.motivo); return }
    try {
      const blob = await generateTicketsVentanilla({ factura: armado.datos })
      await imprimirPdf(blob, `nota-credito-turno-${v.turno}.pdf`, modoImpresion)
    } catch (err) {
      reportError(err, { origen: 'VentanillaPage', accion: 'error al imprimir la nota de crédito' })
      setError('No se pudo generar la nota de crédito.')
    }
  }
  const puedePedirAnulacion = (v: VentaVentanilla) =>
    v.factura?.estado === 'emitida' && !!v.factura.cae && v.cajaId === user?.uid && !cerrada
    && (!v.anulacion || v.anulacion.estado === 'rechazada' || v.anulacion.estado === 'error')

  const limpiar = () => {
    setClienteId('')
    setOcasionalNombre('')
    setOrdenCompra('')
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
            ? (() => { const c = clienteEnSucursal(cliente, empresaDeCanal(canal), sucursal); return { uid: c.uid, nombre: c.razonSocial || c.nombre, codigoTango: c.codigoTango, idGva14Tango: c.idGva14Tango, sucursalNombre: nombreSucursalVenta(cliente, empresaDeCanal(canal), c.codigoTango) } })()
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
          ...(tipoCliente === 'registrado' && ordenCompra.trim() ? { ordenCompra: ordenCompra.trim() } : {}),
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ventanilla</h1>
          <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
        </div>
        <label className="text-xs text-gray-500 flex items-center gap-2">
          <Printer size={14} /> Impresión
          <select value={modoImpresion} onChange={(e) => cambiarModoImpresion(e.target.value as ModoImpresion)}
            className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent">
            {MODOS_IMPRESION.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
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
            <div className="mt-2">
              <SelectorSucursal cliente={cliente} empresa={empresaDeCanal(canal)} value={sucursal} onChange={setSucursal} />
            </div>
            <div className="mt-2">
              <label className="text-xs text-gray-500 mb-1 block">Orden de compra del cliente (opcional)</label>
              <input value={ordenCompra} onChange={(e) => setOrdenCompra(e.target.value)} maxLength={40} placeholder="Nº de OC si el cliente la pide" className={selectClass} />
            </div>
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
              <label className="text-xs text-gray-500 mb-1 block">Lista de precios (Tango)</label>
              <select value={listaOcasionalId} onChange={(e) => setListaOcasionalId(e.target.value)} className={selectClass}>
                <option value="">Elegir lista…</option>
                {listasOcasional.map((l) => <option key={l.nro} value={l.nro}>{l.nro} · {l.nombre}</option>)}
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
            {FORMAS_PAGO.filter((f) => !f.soloRegistrado || (tipoCliente === 'registrado' && ctaCte.ok)).map((f) => (
              <button key={f.id} type="button" onClick={() => setFormaPago(f.id)} className={toggleClass(formaPago === f.id)}>{f.label}</button>
            ))}
          </div>
          {tipoCliente === 'registrado' && cliente && !ctaCte.ok && ctaCte.motivo && (
            <p className="text-xs text-amber-700 mt-1.5">{ctaCte.motivo}</p>
          )}
          {vaAFacturar && (
            <p className="text-xs text-gray-500 mt-1.5">
              Sale factura electrónica: se imprime cuando ARCA responde (unos segundos).
            </p>
          )}
        </div>

        {avisoInhabilitado && (
          <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-700 mt-0.5 shrink-0" />
            <p className="text-red-800 text-sm">{avisoInhabilitado}</p>
          </div>
        )}
        {avisoFiscal && !avisoInhabilitado && (
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
          <div>
            <p className="text-lg font-bold text-gray-900">{conIva ? 'Total con IVA' : 'Total'}: {money(conIva ? conIva.total : total)}</p>
            {conIva && <p className="text-xs text-gray-500 tabular-nums">Neto {money(conIva.neto)} · IVA {money(conIva.iva)}{conIva.percepcion > 0 ? ` · Perc. IIBB ${money(conIva.percepcion)}` : ''}</p>}
          </div>
          <Button onClick={abrirConfirmacion} disabled={items.length === 0 || sinPrecioMotivo !== null || items.some((i) => sinPrecio(i.productoId)) || faltaSucursal}>
            {vaAFacturar ? 'Cobrar y facturar' : 'Cobrar y emitir comprobante'}
          </Button>
        </div>
      </section>

      {/* Mi día: lo que vendió, cobró y recibió este usuario (2026-09-09). */}
      {user && <MiDiaMostrador calc={mio.calc} nombre={user.nombre} cerrarHref="/caja/rendiciones" />}

      {/* Ventas del día */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">Ventanilla de hoy <span className="text-sm font-normal text-gray-500">· {ventas.length} ventas · {money(ventas.filter((v) => v.anulacion?.estado !== 'anulada').reduce((s, v) => s + v.total, 0))}</span></h2>
        {ventas.length === 0 && <p className="text-gray-400 text-sm">Todavía no hubo ventas por ventanilla hoy.</p>}
        {ventas.map((v) => {
          const fac = estadoFactura(v)
          return (
            <div key={v.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
              <span className="shrink-0 w-11 h-11 rounded-xl bg-accent/10 text-accent font-black text-lg flex items-center justify-center">
                {v.turno}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {v.clienteNombre}
                  {v.cajaId !== user?.uid && <span className="ml-2 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-1.5 py-0.5 align-middle">{v.cajaNombre}</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {money(v.total)} · {FORMAS_PAGO.find((f) => f.id === v.formaPago)?.label} · {v.canal === 'contado' ? 'Contado' : 'Promo'}
                  {fac && <span className={`ml-1 ${fac.clase}`}>· {fac.texto}</span>}
                </p>
                {v.anulacion && (() => { const t = textoAnulacion(v.anulacion); return <p className={`text-xs ${t.clase}`}>{t.texto}</p> })()}
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
              {v.anulacion?.estado === 'anulada' && (
                <button onClick={() => imprimirNotaCredito(v)} title="Reimprimir nota de crédito" className="text-red-500 hover:text-red-700 transition-colors p-2 rounded-lg hover:bg-red-50">
                  <FileText size={16} />
                </button>
              )}
              {puedePedirAnulacion(v) && (
                <button onClick={() => setAnulando(v)} title="Anular factura (pide autorización)" className="text-gray-400 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50">
                  <Ban size={16} />
                </button>
              )}
              <button onClick={() => imprimirTurno(v)} title="Reimprimir turno" className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
                <Printer size={16} />
              </button>
            </div>
          )
        })}
      </section>

      {anulando && user && (
        <SolicitarAnulacionModal objetivo={{ coleccion: 'ventasVentanilla', venta: anulando }} actor={{ uid: user.uid, nombre: user.nombre }} onCerrar={() => setAnulando(null)} />
      )}

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
              {conIva && (
                <div className="px-3 py-1.5 text-xs text-gray-500 tabular-nums space-y-0.5 border-t border-gray-100">
                  <p className="flex justify-between"><span>Neto</span><span>{money(conIva.neto)}</span></p>
                  <p className="flex justify-between"><span>IVA 21 %</span><span>{money(conIva.iva)}</span></p>
                  {conIva.percepcion > 0 && <p className="flex justify-between"><span>Percepción IIBB</span><span>{money(conIva.percepcion)}</span></p>}
                </div>
              )}
              <div className="flex justify-between px-3 py-1.5 bg-gray-50 font-semibold">
                <span>{conIva ? 'Total con IVA' : 'Total'}</span><span>{money(conIva ? conIva.total : total)}</span>
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
          onImprimirTodo={imprimirTodo}
          onImprimirTurno={imprimirTurno}
          onClose={() => setEsperando(null)}
          autoImprimir={modoImpresion !== 'rawbt'}
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
function EsperaFacturaModal({ ventaId, onImprimirTodo, onImprimirTurno, onClose, autoImprimir }: {
  ventaId: string
  /** Factura + turno en un solo trabajo de impresión. */
  onImprimirTodo: (v: VentaVentanilla) => Promise<boolean>
  onImprimirTurno: (v: VentaVentanilla) => Promise<boolean>
  onClose: () => void
  /**
   * false en modo RawBT: Chrome no deja abrir otra app sin un toque del
   * usuario, así que al llegar el CAE se muestra un botón grande en vez de
   * imprimir solo (un toque, salen factura y turno).
   */
  autoImprimir: boolean
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
    if (!venta || !emitida || impresoRef.current || !autoImprimir) return
    impresoRef.current = true
    onImprimirTodo(venta).then(setImpresa)
  }, [venta, emitida, onImprimirTodo, autoImprimir])

  const imprimirConToque = () => {
    if (!venta) return
    impresoRef.current = true
    onImprimirTodo(venta).then(setImpresa)
  }

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
              {impresa ? 'Salen la factura y el turno por la impresora de tickets.' : autoImprimir ? 'Generando los tickets…' : 'Tocá el botón para imprimirlos.'}
            </p>
          </div>
        )}
        {emitida && venta && !autoImprimir && !impresa && (
          <Button onClick={imprimirConToque} className="w-full h-14 text-base">
            <Printer size={18} className="mr-2" /> Imprimir factura y turno
          </Button>
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
            <Button variant="outline" onClick={() => onImprimirTodo(venta)} className="flex-1">
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
