import { useMemo, useRef, useState } from 'react'
import {
  PenLine, User, Banknote, Smartphone, Wallet,
  Trash2, CheckCircle2, ShoppingCart, ChevronRight, Clock, UserPlus,
  FileText, Tag, ArrowLeft, Repeat, ChevronDown,
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
import { useRemitosCargaChofer } from '../../hooks/useRemitosCargaChofer'
import { useCatalogo } from '../../hooks/useCatalogo'
import BotoneraProductos from '../../components/ventas/BotoneraProductos'
import { crearVentaCamion } from '../../services/ventaCamionService'
import { precioEfectivo } from '../../utils/helpers'
import { esClienteFacturable } from '../../utils/facturable'
import { articulosDeCambio, itemsDeCambio } from '../../utils/cambios'
import { documentoDeVenta } from '../../utils/circuitoDocumento'
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
  const { remitos: remitosCarga } = useRemitosCargaChofer()
  const { catalogo } = useCatalogo()
  const firmaRef = useRef<SignaturePadHandle>(null)

  // Camión del día: el remito de carga emitido por caja es la fuente primaria
  // (users/{uid}.camionId no lo escribe ninguna UI, solo el seed — queda como
  // fallback para no romper choferes sin remito digital todavía).
  //
  // Puede no haber ninguno, y NO frena la venta: el que va de acompañante no
  // tiene remito propio, y un chofer sin camión asignado igual sale a vender.
  // La venta queda sin camión y por lo tanto fuera del stock en vivo de ese
  // camión, pero sigue contando para la liquidación del repartidor, que es por
  // persona. Perder la venta sería mucho peor que perder la atribución.
  const camionIdHoy = remitosCarga[0]?.camionId ?? user?.camionId ?? ''

  const [canal, setCanal] = useState<CanalVenta | null>(null)
  const [clienteId, setClienteId] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [cantidadesCambio, setCantidadesCambio] = useState<Record<string, number>>({})
  const [cambiosAbierto, setCambiosAbierto] = useState(false)
  const [formaPago, setFormaPago] = useState<FormaPago | null>(null)
  const [firmante, setFirmante] = useState('')
  const [resumenOpen, setResumenOpen] = useState(false)
  const [firmaPreview, setFirmaPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState<{ cliente: string; total: number } | null>(null)
  const [error, setError] = useState('')

  const cliente = useMemo(() => clientes.find((c) => c.uid === clienteId), [clientes, clienteId])
  const lista   = useMemo(() => listas.find((l) => l.id === cliente?.listaPreciosId), [listas, cliente])

  // Una venta contado factura electrónicamente; una promo no. Si al cliente le
  // falta un dato fiscal, mejor frenar ACÁ que descubrirlo cuando la factura
  // rebote, con la mercadería ya entregada y el chofer a diez cuadras.
  const noFacturable = useMemo(() => {
    if (canal !== 'contado' || !cliente) return null
    const r = esClienteFacturable(cliente)
    return r.facturable ? null : r.motivos
  }, [canal, cliente])

  const precioDe = (productoId: string): number => {
    if (!cliente) return 0
    const base = lista?.items.find((i) => i.productoId === productoId)?.precio ?? 0
    return precioEfectivo(cliente, productoId, base)
  }

  const items: VentaCamionItem[] = catalogo
    .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: cantidades[p.id] ?? 0, precioUnitario: precioDe(p.id) }))
    .filter((i) => i.cantidad > 0)

  // Cambios: la bolsa rota del cliente por una nueva. Un artículo por producto,
  // derivado del catálogo, siempre en $0 — van como renglones del documento que
  // salga (factura o remito), nunca en el total.
  const articulosCambio = useMemo(() => articulosDeCambio(catalogo), [catalogo])
  const cambios = itemsDeCambio(articulosCambio, cantidadesCambio)

  const total    = items.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0)
  const unidades = items.reduce((s, i) => s + i.cantidad, 0)
  const unidadesCambio = cambios.reduce((s, i) => s + i.cantidad, 0)

  // Qué papel le va a quedar al cliente. Con la forma de pago sin elegir
  // todavía asumimos la que factura: es justo el caso en el que hace falta
  // avisar que a este cliente no se le puede facturar.
  const documento = documentoDeVenta(canal, formaPago ?? 'contado_efectivo', total)
  const bloqueaVenta = noFacturable !== null && documento === 'factura_arca'

  // Una operación de solo cambios no cobra nada: preguntarle al chofer cómo
  // cobró sobraría.
  const seCobra = total > 0

  const reset = () => {
    setClienteId('')
    setCantidades({})
    setCantidadesCambio({})
    setFormaPago(null)
    setFirmante('')
    setFirmaPreview(null)
    firmaRef.current?.clear()
  }

  const abrirResumen = () => {
    setError('')
    if (!cliente)            { setError('Elegí un cliente.'); return }
    if (items.length === 0 && cambios.length === 0) { setError('Cargá al menos un producto o un cambio.'); return }
    if (seCobra && !formaPago) { setError('Elegí la forma de pago.'); return }
    if (bloqueaVenta)        { setError('A este cliente no se le puede facturar todavía. Mirá el aviso de arriba.'); return }
    if (!firmante.trim())    { setError('Poné el nombre de quien firma.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma)              { setError('Falta la firma del cliente.'); return }
    setFirmaPreview(firma)
    setResumenOpen(true)
  }

  const confirmar = () => {
    if (!user || !cliente || !canal) return
    // Una operación de solo cambios no se cobra: la forma de pago no se le
    // pregunta al chofer, y contra un total de $0 no mueve ninguna cuenta.
    const formaPagoFinal = formaPago ?? 'contado_efectivo'
    setGuardando(true)
    try {
      crearVentaCamion(
        { canal, cliente, items, cambios, formaPago: formaPagoFinal, firmaCliente: firmaPreview ?? undefined, firmanteNombre: firmante },
        { uid: user.uid, nombre: user.nombre, camionId: camionIdHoy },
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
        {/* Sin camión se vende igual (acompañante, o todavía sin remito de
            carga). Solo se avisa que la venta no va a figurar en el stock de
            ningún camión — para la liquidación de la persona cuenta igual. */}
        {!camionIdHoy && (
          <div className="rounded-xl border border-[#D3D1C7] bg-white px-3.5 py-2.5">
            <p className="text-sm text-gray-600">
              No tenés un camión asignado hoy. Podés vender igual: la venta queda a tu nombre.
            </p>
          </div>
        )}

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
          {noFacturable && (
            bloqueaVenta ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-800">
                  A este cliente no se le puede hacer una venta contado
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
                  {noFacturable.map((motivo) => <li key={motivo}>{motivo}</li>)}
                </ul>
                <p className="mt-2 text-xs text-red-700">
                  La venta contado emite factura y sin esos datos ARCA la rechaza. Pedí que se
                  completen desde la oficina, o hacé la entrega como <b>Promo</b>.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">
                  A este cliente le faltan datos fiscales
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                  {noFacturable.map((motivo) => <li key={motivo}>{motivo}</li>)}
                </ul>
                <p className="mt-2 text-xs text-amber-800">
                  En cuenta corriente la entrega sale igual, con remito. Avisá a la oficina: sin
                  esos datos después no van a poder facturarlo.
                </p>
              </div>
            )
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
            <BotoneraProductos
              catalogo={catalogo}
              precioDe={precioDe}
              cantidades={cantidades}
              onChange={setCantidades}
            />
          )}
        </section>

        {/* Cambios — bolsa rota del cliente por una nueva, sin cargo. Van en el
            mismo papel que la venta, en $0. Plegado por defecto: la mayoría de
            las operaciones no lleva cambios. */}
        {cliente && (
          <section className="space-y-2 animate-in fade-in-0 duration-300">
            <button
              onClick={() => setCambiosAbierto((v) => !v)}
              className="w-full flex items-center gap-2 text-left"
            >
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5 cursor-pointer">
                <Repeat size={13} /> Cambios
              </label>
              {unidadesCambio > 0 && (
                <span className="rounded-full bg-accent/12 text-accent text-[11px] font-bold px-2 py-0.5">
                  {unidadesCambio} u.
                </span>
              )}
              <span className="ml-auto text-gray-300">
                {cambiosAbierto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
            </button>

            {cambiosAbierto && (
              <div className="space-y-2 animate-in fade-in-0 duration-200">
                <p className="text-xs text-gray-400">
                  Bolsa defectuosa por una nueva, sin cargo. Se lista en el mismo comprobante
                  en $0. Acordate de guardar la rota: se entrega a muelle al volver.
                </p>
                <BotoneraProductos
                  catalogo={articulosCambio}
                  precioDe={() => 0}
                  cantidades={cantidadesCambio}
                  onChange={setCantidadesCambio}
                />
              </div>
            )}
          </section>
        )}

        {cliente && (
          <>
            {/* Forma de pago — solo si hay algo que cobrar */}
            {seCobra ? (
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
            ) : cambios.length > 0 && (
              <div className="rounded-xl border border-[#D3D1C7] bg-white px-3.5 py-2.5 animate-in fade-in-0 duration-300">
                <p className="text-sm font-semibold text-gray-700">Solo cambios — no se cobra nada</p>
                <p className="text-xs text-gray-500 mt-0.5">Sale un remito con la mercadería que se movió.</p>
              </div>
            )}

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
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Total{unidades > 0 ? ` · ${unidades} u.` : ''}{unidadesCambio > 0 ? ` · ${unidadesCambio} cambio` : ''}
            </p>
            <p className="text-2xl font-black tabular-nums leading-none">{money(total)}</p>
          </div>
          <Button
            onClick={abrirResumen}
            disabled={(items.length === 0 && cambios.length === 0) || !cliente || bloqueaVenta}
            className="flex-1 flex items-center justify-center gap-1.5"
          >
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
            {/* Los cambios se listan con los productos, en $0: así los va a ver
                el cliente en el papel. */}
            {cambios.map((i) => (
              <div key={i.productoId} className="flex items-center gap-3 px-3.5 py-2.5">
                <Repeat size={13} className="text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{i.nombre}</p>
                  <p className="text-xs text-gray-400">{i.cantidad} × sin cargo</p>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0 text-gray-400">{money(0)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between px-3.5 py-3 bg-[#F8F7F2]">
              <span className="text-sm font-semibold text-gray-600">Total</span>
              <span className="text-xl font-black tabular-nums">{money(total)}</span>
            </div>
          </div>

          {documento && (
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <FileText size={13} className="text-gray-400 shrink-0" />
              {documento === 'factura_arca'
                ? 'Sale factura electrónica de Redonhielo.'
                : documento === 'no_oficial'
                  ? 'Sale comprobante de Rolito.'
                  : 'Sale remito — la factura la hace la oficina.'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#D3D1C7] px-3.5 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Pago</p>
              {formaPagoActual ? (
                <p className="text-sm font-semibold flex items-center gap-1.5 mt-0.5">
                  <formaPagoActual.icon size={15} className="text-accent" /> {formaPagoActual.label}
                </p>
              ) : (
                <p className="text-sm font-semibold text-gray-400 mt-0.5">Sin cargo</p>
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
