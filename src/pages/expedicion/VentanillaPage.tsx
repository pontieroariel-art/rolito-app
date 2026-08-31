import { useEffect, useMemo, useState } from 'react'
import { Printer, ShoppingCart } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import BotoneraProductos from '../../components/ventas/BotoneraProductos'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { crearVentaVentanilla, subscribeVentanillaDelDia } from '../../services/ventaVentanillaService'
import { generateComprobanteVentanilla } from '../../utils/pdf'
import { generateQrDataUrl } from '../../utils/qr'
import { precioEfectivo } from '../../utils/helpers'
import {
  CanalVenta, FormaPago, PLANTAS, VentaCamionItem, VentaVentanilla,
} from '../../types'

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

// Venta por ventanilla (caja): terceros que compran en el mostrador. Cliente
// registrado → su lista de precios; ocasional → la lista que elija caja.
// Muelle entrega contra el comprobante impreso.
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
  const [listaOcasionalId, setListaOcasionalId] = useState('')
  const [canal,       setCanal]       = useState<CanalVenta>('contado')
  const [cantidades,  setCantidades]  = useState<Record<string, number>>({})
  const [formaPago,   setFormaPago]   = useState<FormaPago | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [ventas,      setVentas]      = useState<VentaVentanilla[]>([])

  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentas), [plantaId, fecha])

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const lista = tipoCliente === 'registrado'
    ? listas.find((l) => l.id === cliente?.listaPreciosId)
    : listas.find((l) => l.id === listaOcasionalId)

  const precioDe = (productoId: string): number => {
    const base = lista?.items.find((i) => i.productoId === productoId)?.precio ?? 0
    return tipoCliente === 'registrado' && cliente ? precioEfectivo(cliente, productoId, base) : base
  }

  const items: VentaCamionItem[] = catalogo
    .filter((p) => (cantidades[p.id] ?? 0) > 0)
    .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: cantidades[p.id], precioUnitario: precioDe(p.id) }))
  const total = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)

  const abrirConfirmacion = () => {
    setError('')
    if (tipoCliente === 'registrado' && !cliente) { setError('Elegí el cliente.'); return }
    if (tipoCliente === 'ocasional' && !ocasionalNombre.trim()) { setError('Poné el nombre del cliente ocasional.'); return }
    if (tipoCliente === 'ocasional' && !lista) { setError('Elegí la lista de precios para el ocasional.'); return }
    if (items.length === 0) { setError('Cargá al menos un producto.'); return }
    if (!formaPago) { setError('Elegí la forma de pago.'); return }
    if (formaPago === 'cuenta_corriente' && tipoCliente === 'ocasional') { setError('Cuenta corriente solo para clientes registrados.'); return }
    setConfirmando(true)
  }

  const imprimir = async (v: VentaVentanilla) => {
    try {
      // QR de seguimiento del turno: el papel es la identificación (el
      // número viaja adentro del link — ver TurnosVentanillaPage).
      const qrDataUrl = await generateQrDataUrl(
        `${window.location.origin}/turnos/${v.plantaId}?turno=${v.turno}`,
      )
      await generateComprobanteVentanilla({
        id:            v.id,
        plantaId:      v.plantaId,
        canal:         v.canal,
        clienteNombre: v.clienteNombre,
        clienteCuit:   v.clienteOcasional?.cuit,
        items:         v.items,
        total:         v.total,
        formaPago:     v.formaPago,
        cajaNombre:    v.cajaNombre,
        fecha:         v.fecha.toDate(),
        turno:         v.turno,
        qrDataUrl,
      })
    } catch (err) {
      console.error('[ventanilla] error al generar el PDF:', err)
    }
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
            ? { nombre: ocasionalNombre.trim(), ...(ocasionalCuit.trim() ? { cuit: ocasionalCuit.trim() } : {}) }
            : undefined,
          items,
          formaPago,
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      setClienteId('')
      setOcasionalNombre('')
      setOcasionalCuit('')
      setCantidades({})
      setFormaPago(null)
      imprimir(venta)
    } catch (err) {
      console.error('[ventanilla] error al crear la venta:', err)
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
            {cliente && !lista && (
              <p className="text-xs text-amber-600 mt-1">Este cliente no tiene lista de precios asignada — los precios salen en $0.</p>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="text-xs text-gray-500 mb-1 block">Nombre</label>
              <input value={ocasionalNombre} onChange={(e) => setOcasionalNombre(e.target.value)} placeholder="Juan Pérez" className={selectClass} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">CUIT (opcional)</label>
              <input value={ocasionalCuit} onChange={(e) => setOcasionalCuit(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="20360242871" className={selectClass} />
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
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-bold text-gray-900">Total: {money(total)}</p>
          <Button onClick={abrirConfirmacion} disabled={items.length === 0}>Cobrar y emitir comprobante</Button>
        </div>
      </section>

      {/* Ventas del día */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">Ventanilla de hoy</h2>
        {ventas.length === 0 && <p className="text-gray-400 text-sm">Todavía no hubo ventas por ventanilla hoy.</p>}
        {ventas.map((v) => (
          <div key={v.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <span className="shrink-0 w-11 h-11 rounded-xl bg-accent/10 text-accent font-black text-lg flex items-center justify-center">
              {v.turno}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{v.clienteNombre}</p>
              <p className="text-xs text-gray-500">
                {money(v.total)} · {FORMAS_PAGO.find((f) => f.id === v.formaPago)?.label} · {v.canal === 'contado' ? 'Contado' : 'Promo'}
              </p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${
              v.estado === 'entregado' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'
            }`}>
              {v.estado === 'entregado' ? 'Entregado' : 'Para entregar'}
            </span>
            <button onClick={() => imprimir(v)} title="Reimprimir comprobante" className="text-gray-400 hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
              <Printer size={16} />
            </button>
          </div>
        ))}
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
            <p className="text-xs text-gray-500">Se imprime el comprobante — muelle entrega la mercadería contra ese papel.</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmar} loading={guardando} className="flex-1">Confirmar e imprimir</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
