import { useMemo, useRef, useState } from 'react'
import {
  Minus, Plus, PenLine, User, Banknote, Smartphone, Wallet,
  Trash2, CheckCircle2, ShoppingCart, ChevronRight, Clock, UserPlus,
  FileText, Tag, ArrowLeft,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ClienteCombobox, { toComboItems } from '../../components/ui/ClienteCombobox'
import SignaturePad, { SignaturePadHandle } from '../../components/heladeras/SignaturePad'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { crearVentaCamion } from '../../services/ventaCamionService'
import { precioEfectivo } from '../../utils/helpers'
import { PRODUCTS } from '../../utils/constants'
import { FormaPago, CanalVenta, VentaCamionItem } from '../../types'

const CANALES: { id: CanalVenta; titulo: string; empresa: string; color: string; icon: typeof Tag }[] = [
  { id: 'contado', titulo: 'Venta Contado', empresa: 'Redonhielo', color: '#1D9E75', icon: FileText },
  { id: 'promo',   titulo: 'Promo',         empresa: 'Rolito',     color: '#ea580c', icon: Tag },
]

const FORMAS_PAGO: { id: FormaPago; label: string; icon: typeof Banknote }[] = [
  { id: 'contado_efectivo',      label: 'Efectivo',       icon: Banknote },
  { id: 'contado_transferencia', label: 'Transferencia',  icon: Smartphone },
  { id: 'cuenta_corriente',      label: 'Cta. corriente', icon: Wallet },
]

// Color categórico por producto — identidad de un vistazo (paleta distinguible,
// pensada para no depender del color: el nombre siempre acompaña). Acento sutil,
// no protagonista, para mantener la línea limpia.
const PRODUCT_COLORS: Record<string, string> = {
  bolsa_2kg:     '#2563eb',
  bolsa_3kg:     '#0891b2',
  bolsa_10kg:    '#4f46e5',
  picado_10kg:   '#0d9488',
  escamas_10kg:  '#7c3aed',
  barra:         '#db2777',
  anticorrosivo: '#ea580c',
  agua_6l:       '#16a34a',
}
const colorDe = (id: string) => PRODUCT_COLORS[id] ?? '#6b7280'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

export default function VentaCamion() {
  const { user } = useAuth()
  const { clientes, loading: loadingClientes } = useClientesActivos()
  const { listas } = useAllListasPrecios()
  const firmaRef = useRef<SignaturePadHandle>(null)

  const [canal, setCanal] = useState<CanalVenta | null>(null)
  const [clienteId, setClienteId] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null)
  const [firmante, setFirmante] = useState('')
  const [resumenOpen, setResumenOpen] = useState(false)
  const [firmaPreview, setFirmaPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState<{ cliente: string; total: number } | null>(null)
  const [error, setError] = useState('')

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const lista   = useMemo(() => listas.find((l) => l.id === cliente?.listaPreciosId), [listas, cliente])

  const precioDe = (productoId: string): number => {
    if (!cliente) return 0
    const base = lista?.items.find((i) => i.productoId === productoId)?.precio ?? 0
    return precioEfectivo(cliente, productoId, base)
  }

  const items: VentaCamionItem[] = PRODUCTS
    .map((p) => ({ productoId: p.id, nombre: p.name, cantidad: cantidades[p.id] ?? 0, precioUnitario: precioDe(p.id) }))
    .filter((i) => i.cantidad > 0)

  const total    = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)
  const unidades = items.reduce((s, i) => s + i.cantidad, 0)

  const setCantidad = (productoId: string, delta: number) =>
    setCantidades((c) => ({ ...c, [productoId]: Math.max(0, (c[productoId] ?? 0) + delta) }))

  // Carga directa por teclado (numérico): para cantidades grandes no hace falta
  // tocar "+" de a uno. Filtra a dígitos y limita a 99.999.
  const setCantidadInput = (productoId: string, raw: string) =>
    setCantidades((c) => ({ ...c, [productoId]: Math.min(99999, Number(raw.replace(/\D/g, '')) || 0) }))

  const reset = () => {
    setClienteId('')
    setCantidades({})
    setFormaPago(null)
    setFirmante('')
    setFirmaPreview(null)
    firmaRef.current?.clear()
  }

  const abrirResumen = () => {
    setError('')
    if (!user?.camionId)     { setError('No tenés un camión asignado. Avisá a logística.'); return }
    if (!cliente)            { setError('Elegí un cliente.'); return }
    if (items.length === 0)  { setError('Cargá al menos un producto.'); return }
    if (!formaPago)          { setError('Elegí la forma de pago.'); return }
    if (!firmante.trim())    { setError('Poné el nombre de quien firma.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma)              { setError('Falta la firma del cliente.'); return }
    setFirmaPreview(firma)
    setResumenOpen(true)
  }

  const confirmar = () => {
    if (!user?.camionId || !cliente || !canal || !formaPago) return
    setGuardando(true)
    try {
      crearVentaCamion(
        { canal, cliente, items, formaPago, firmaCliente: firmaPreview ?? undefined, firmanteNombre: firmante },
        { uid: user.uid, nombre: user.nombre, camionId: user.camionId },
      )
      setExito({ cliente: cliente.razonSocial || cliente.nombre, total })
      reset()
      setResumenOpen(false)
    } catch {
      setError('No se pudo registrar la venta. Intentá de nuevo.')
      setResumenOpen(false)
    } finally {
      setGuardando(false)
    }
  }

  if (!user) return <LoadingSpinner fullScreen />

  const formaPagoActual = formaPago ? FORMAS_PAGO.find((f) => f.id === formaPago)! : null
  const canalActual = canal ? CANALES.find((c) => c.id === canal)! : null

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (exito) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="relative mb-6">
            <span className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
            <div className="relative w-24 h-24 rounded-full bg-success/15 flex items-center justify-center animate-in zoom-in-50 duration-300">
              <CheckCircle2 size={56} className="text-success" strokeWidth={2.2} />
            </div>
          </div>
          <h2 className="text-2xl font-black animate-in fade-in-0 slide-in-from-bottom-1 duration-300">¡Venta registrada!</h2>
          <p className="text-gray-500 mt-1 animate-in fade-in-0 duration-500">{exito.cliente}</p>
          <p className="text-4xl font-black tabular-nums mt-4 animate-in zoom-in-95 duration-300">{money(exito.total)}</p>
          <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1.5">
            <Clock size={13} /> Remito en camino a Tango
          </div>
          <Button onClick={() => { setExito(null); setCanal(null) }} className="mt-8 w-full max-w-xs">Registrar otra venta</Button>
        </main>
      </div>
    )
  }

  // ── Paso 1: elegir canal (Promo / Venta Contado) antes del formulario ──────
  if (!canal) {
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900 flex flex-col">
        <div className="bg-gradient-to-br from-[#1a6b52] to-[#1D9E75] text-white">
          <div className="max-w-lg mx-auto px-4 py-5 flex items-center gap-3">
            <Link to="/chofer" aria-label="Volver al inicio"
              className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 active:scale-90 transition-transform">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-xl font-bold leading-tight">Nueva venta</h1>
              <p className="text-white/70 text-xs">Elegí el tipo de venta para empezar</p>
            </div>
          </div>
        </div>
        <main className="flex-1 max-w-lg mx-auto w-full p-4 flex flex-col justify-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo de venta</p>
          {CANALES.map((c) => {
            const Icon = c.icon
            return (
              <button key={c.id} onClick={() => setCanal(c.id)}
                className="w-full text-left bg-white border border-[#D3D1C7] rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:border-gray-300 active:scale-[0.99] transition-all">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${c.color}18`, color: c.color }}>
                  <Icon size={26} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-lg font-bold">{c.titulo}</div>
                  <div className="text-sm text-gray-500">{c.empresa}</div>
                </div>
                <ChevronRight size={22} className="text-gray-300 shrink-0" />
              </button>
            )
          })}
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      {/* Encabezado con acento + canal elegido */}
      <div className="bg-gradient-to-br from-[#1a6b52] to-[#1D9E75] text-white">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => setCanal(null)} aria-label="Cambiar tipo de venta"
            className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 active:scale-90 transition-transform">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight">Venta desde el camión</h1>
            <p className="text-white/70 text-xs">Descarga a demanda · remito en Tango</p>
          </div>
          {canalActual && (
            <span className="flex items-center gap-1.5 rounded-full bg-white pl-2.5 pr-3 py-1 text-sm font-bold shrink-0" style={{ color: canalActual.color }}>
              <canalActual.icon size={14} /> {canalActual.titulo}
            </span>
          )}
        </div>
      </div>

      <main className="max-w-lg mx-auto p-4 space-y-5 pb-28">
        {/* Cliente */}
        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <User size={13} /> Cliente
          </label>
          {loadingClientes
            ? <p className="text-xs text-gray-400">Cargando clientes…</p>
            : <ClienteCombobox items={toComboItems(clientes)} value={clienteId} onChange={setClienteId} />}
          {cliente && !cliente.listaPreciosId && (
            <p className="text-xs text-amber-600">Este cliente no tiene lista de precios asignada — los precios figuran en $0.</p>
          )}
        </section>

        {/* Productos */}
        <section className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <ShoppingCart size={13} /> Productos
          </label>

          {!cliente ? (
            // Estado vacío: sin cliente no hay precios; se guía en vez de mostrar $0.
            <div className="bg-white border border-dashed border-[#D3D1C7] rounded-2xl px-6 py-10 flex flex-col items-center text-center animate-in fade-in-0 duration-300">
              <div className="w-12 h-12 rounded-2xl bg-[#F0EEE7] flex items-center justify-center mb-3">
                <UserPlus size={22} className="text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">Elegí un cliente para empezar</p>
              <p className="text-xs text-gray-400 mt-0.5">Los precios se cargan de su lista automáticamente.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {PRODUCTS.map((p) => {
                const cant = cantidades[p.id] ?? 0
                const precio = precioDe(p.id)
                const activo = cant > 0
                const color = colorDe(p.id)
                return (
                  <div key={p.id}
                    className={`flex items-center gap-3 bg-white rounded-xl px-3.5 py-2.5 border transition-all duration-150 ${
                      activo ? 'border-accent shadow-sm' : 'border-[#D3D1C7]'
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">
                        {money(precio)} / {p.unit}
                        {activo && <span className="font-semibold" style={{ color }}> · {money(precio * cant)}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setCantidad(p.id, -1)} disabled={cant === 0} aria-label="Restar"
                        className="w-9 h-9 rounded-lg border border-[#D3D1C7] bg-white flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform">
                        <Minus size={16} />
                      </button>
                      <input
                        type="text" inputMode="numeric" value={cant === 0 ? '' : String(cant)}
                        onChange={(e) => setCantidadInput(p.id, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="0" aria-label={`Cantidad de ${p.name}`}
                        className={`w-12 text-center text-base font-bold tabular-nums bg-transparent rounded-md border py-1 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors ${
                          activo ? 'text-gray-900 border-transparent' : 'text-gray-300 border-transparent placeholder-gray-300'
                        }`}
                      />
                      <button onClick={() => setCantidad(p.id, 1)} aria-label="Sumar"
                        className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center active:scale-90 transition-transform">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {cliente && (
          <>
            {/* Forma de pago */}
            <section className="space-y-2 animate-in fade-in-0 duration-300">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Forma de pago</label>
              <div className="grid grid-cols-3 gap-2">
                {FORMAS_PAGO.map((f) => {
                  const Icon = f.icon
                  const sel = formaPago === f.id
                  return (
                    <button key={f.id} onClick={() => setFormaPago(f.id)}
                      className={`rounded-xl border p-3 flex flex-col items-center gap-1.5 transition-all ${
                        sel ? 'border-accent bg-accent/10 text-accent shadow-sm' : 'border-[#D3D1C7] text-gray-500 hover:border-gray-300'
                      }`}>
                      <Icon size={20} />
                      <span className="text-xs font-semibold text-center leading-tight">{f.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Firma + aclaración */}
            <section className="space-y-2 animate-in fade-in-0 duration-300">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                <PenLine size={13} /> Firma del cliente
              </label>
              <input
                value={firmante}
                onChange={(e) => setFirmante(e.target.value)}
                placeholder="Nombre y apellido de quien firma"
                className="w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent placeholder-gray-400"
              />
              <SignaturePad ref={firmaRef} />
              <button onClick={() => firmaRef.current?.clear()}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <Trash2 size={12} /> Borrar firma
              </button>
            </section>
          </>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 animate-in fade-in-0 slide-in-from-top-1">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}
      </main>

      {/* Barra fija de acción */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-[#D3D1C7] p-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Total{unidades > 0 ? ` · ${unidades} u.` : ''}</p>
            <p className="text-2xl font-black tabular-nums leading-none">{money(total)}</p>
          </div>
          <Button onClick={abrirResumen} disabled={items.length === 0 || !cliente} className="flex-1 flex items-center justify-center gap-1.5">
            Revisar y confirmar <ChevronRight size={18} />
          </Button>
        </div>
      </div>

      {/* Resumen / comprobante */}
      <Modal open={resumenOpen} onClose={() => !guardando && setResumenOpen(false)} title="Resumen de la venta" variant="light">
        <div className="space-y-4">
          {canalActual && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: `${canalActual.color}12` }}>
              <canalActual.icon size={16} style={{ color: canalActual.color }} />
              <span className="text-sm font-bold" style={{ color: canalActual.color }}>{canalActual.titulo}</span>
              <span className="text-xs text-gray-400">· {canalActual.empresa}</span>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Cliente</p>
              <p className="font-semibold text-gray-900 truncate">{cliente?.razonSocial || cliente?.nombre}</p>
            </div>
            {cliente?.codigoCliente && (
              <span className="text-xs bg-[#F0EEE7] text-gray-500 rounded-md px-2 py-0.5 shrink-0">{cliente.codigoCliente}</span>
            )}
          </div>

          <div className="rounded-xl border border-[#D3D1C7] divide-y divide-[#EDEBE4] overflow-hidden">
            {items.map((i) => (
              <div key={i.productoId} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorDe(i.productoId) }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{i.nombre}</p>
                  <p className="text-xs text-gray-400">{i.cantidad} × {money(i.precioUnitario)}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0">{money(i.precioUnitario * i.cantidad)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between px-3.5 py-3 bg-[#F8F7F2]">
              <span className="text-sm font-semibold text-gray-600">Total</span>
              <span className="text-xl font-black tabular-nums">{money(total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#D3D1C7] px-3.5 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Pago</p>
              {formaPagoActual && (
                <p className="text-sm font-semibold flex items-center gap-1.5 mt-0.5">
                  <formaPagoActual.icon size={15} className="text-accent" /> {formaPagoActual.label}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-[#D3D1C7] px-3.5 py-2.5 min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Firma</p>
              <p className="text-sm font-semibold truncate mt-0.5">{firmante || '—'}</p>
            </div>
          </div>

          {firmaPreview && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Constancia firmada</p>
              <img src={firmaPreview} alt="Firma del cliente" className="w-full h-28 object-contain bg-white border border-[#D3D1C7] rounded-xl" />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setResumenOpen(false)} disabled={guardando} className="flex-1">
              Volver
            </Button>
            <Button onClick={confirmar} loading={guardando} className="flex-1 flex items-center justify-center gap-1.5">
              <CheckCircle2 size={18} /> Aceptar y registrar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
