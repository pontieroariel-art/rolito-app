import { useState, useMemo, useCallback, useEffect, useRef, memo, lazy, Suspense } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Plus, MoreVertical, Pencil, XCircle, GripVertical, ChevronLeft, ChevronRight, Clock, CalendarDays } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import MapaPlanificacion from '../../components/admin/MapaPlanificacion'
import DespachoBoard from '../../components/admin/DespachoBoard'
import PedidoSearchBar from '../../components/admin/PedidoSearchBar'
import EditOrderModal from '../../components/admin/EditOrderModal'
import CancelOrderModal from '../../components/admin/CancelOrderModal'
import { useKanbanOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAuth } from '../../context/AuthContext'
import { moveOrderDate, moveOrderToBandeja, assignDriver } from '../../services/orderService'
import { summarizeProducts, tsToDate, getCodigoCliente, buildCodigoByClientId, toDateStr as dateToStr } from '../../utils/helpers'
import { resolveClientDisplay } from '../../utils/constants'
import { Order, UserProfile } from '../../types'
import { reportError } from '@/services/observability'

// Lazy: cargan pdfjs-dist (448K) y xlsx (484K) respectivamente — pesan casi
// 1MB entre las dos y son de uso puntual ("Importar"), no tiene sentido que
// entren al bundle de la pantalla que logística tiene abierta todo el día.
const ImportarPedidoModal    = lazy(() => import('../../components/admin/ImportarPedidoModal'))
const ImportarPedidosYaModal = lazy(() => import('../../components/admin/ImportarPedidosYaModal'))

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']

// ── Helpers ───────────────────────────────────────────────────────────────────

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateToStr(o.date.toDate())
}

function driverColor(email: string, choferes: UserProfile[]): string {
  const idx = choferes.findIndex((c) => c.email === email)
  return idx >= 0 ? DRIVER_COLORS[idx % DRIVER_COLORS.length] : '#F59E0B'
}

function buildColumns(start: Date): { id: string; label: string; sublabel?: string }[] {
  const today = dateToStr(new Date())
  const cols: { id: string; label: string; sublabel?: string }[] = [
    { id: 'bandeja', label: 'Bandeja', sublabel: 'Sin fecha / Pendientes' },
  ]
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + i)
    const str     = dateToStr(d)
    const isToday = str === today
    const name    = d.toLocaleDateString('es-AR', { weekday: 'short' })
    const label   = isToday ? 'Hoy' : name.charAt(0).toUpperCase() + name.slice(1)
    cols.push({ id: str, label, sublabel: d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) })
  }
  return cols
}

function getOrderColumn(order: Order, dayIds: Set<string>): string | null {
  const dateStr = orderDateStr(order)
  if (!dateStr) return 'bandeja'
  if (dayIds.has(dateStr)) return dateStr
  const today = dateToStr(new Date())
  if (dateStr < today && !['entregado', 'cancelado'].includes(order.status)) return 'bandeja'
  return null
}

// EditOrderModal y CancelOrderModal viven en components/admin/ (extraídos
// de acá — ver plan de migración del Backoffice, Fase 3).

// ── OrderQuickView (popover de detalle) ─────────────────────────────────────
// Al hacer clic en un bloque de la grilla horaria, un cluster o un pedido de
// Bandeja se abre este detalle — reemplaza a la tarjeta expandible en línea
// que tenía sentido en un tablero de columnas, no en una grilla horaria.

function OrderQuickView({ order, choferes, codigoCliente, columns, onClose, onEdit, onCancel }: {
  order:         Order
  choferes:      UserProfile[]
  codigoCliente?: string
  columns:       { id: string; label: string; sublabel?: string }[]
  onClose:       () => void
  onEdit:        (order: Order) => void
  onCancel:      (order: Order) => void
}) {
  const [assigning,     setAssigning]     = useState(false)
  const [loadingDriver, setLoadingDriver] = useState<string | null>(null)
  const [showMoveTo,    setShowMoveTo]    = useState(false)
  const [movingTo,      setMovingTo]      = useState<string | null>(null)

  const driver = order.driverId ? choferes.find((c) => c.email === order.driverId) : null
  const color  = order.driverId ? driverColor(order.driverId, choferes) : null
  const canEdit = !['entregado', 'cancelado'].includes(order.status)

  const handleAssign = async (email: string) => {
    setLoadingDriver(email)
    try {
      await assignDriver(order.id, email)
    } catch (err) {
      reportError(err, { origen: 'LogisticaDashboard' })
    } finally {
      setLoadingDriver(null)
      setAssigning(false)
    }
  }

  // Alternativa no-drag para mover un pedido de día: en mobile no hay
  // columnas visibles para arrastrar la tarjeta hacia otro día.
  const handleMoveTo = async (targetCol: string) => {
    setMovingTo(targetCol)
    try {
      if (targetCol === 'bandeja') await moveOrderToBandeja(order.id)
      else await moveOrderDate(order.id, targetCol)
      onClose()
    } catch (err) {
      reportError(err, { origen: 'LogisticaDashboard' })
    } finally {
      setMovingTo(null)
    }
  }

  return (
    <Modal open onClose={onClose} title={order.clientName}>
      <div className="space-y-3">
        {codigoCliente && <p className="text-xs text-gray-400 font-mono -mt-1">{codigoCliente}</p>}
        {order.clientAddress && <p className="text-sm text-gray-500">{order.clientAddress}</p>}
        <p className="text-sm text-gray-700">{summarizeProducts(order.products)}</p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          {driver ? (
            <button
              onClick={() => setAssigning((v) => !v)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: `${color}18`, color: color!, border: `1px solid ${color}40` }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color! }} />
              {driver.nombreContacto || driver.nombre}
            </button>
          ) : (
            <button
              onClick={() => setAssigning((v) => !v)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              Sin asignar
            </button>
          )}
          {order.horaEntrega && <span className="text-xs text-gray-400">{order.horaEntrega}</span>}
        </div>

        {assigning && (
          <div className="pt-1 border-t border-gray-100 flex flex-wrap gap-1.5">
            {choferes.map((c) => {
              const col = driverColor(c.email, choferes)
              return (
                <button
                  key={c.uid}
                  onClick={() => handleAssign(c.email)}
                  disabled={loadingDriver !== null}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
                  style={{ backgroundColor: `${col}18`, color: col, border: `1px solid ${col}40` }}
                >
                  {loadingDriver === c.email
                    ? <span className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
                    : <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col }} />
                  }
                  {c.nombreContacto || c.nombre}
                </button>
              )
            })}
          </div>
        )}

        {canEdit && (
          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowMoveTo((v) => !v)}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border text-sm transition-colors ${
                showMoveTo ? 'border-accent text-accent bg-accent/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <CalendarDays size={13} /> Mover a...
            </button>
            {showMoveTo && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {columns.map((col) => (
                  <button
                    key={col.id}
                    disabled={movingTo !== null}
                    onClick={() => handleMoveTo(col.id)}
                    className="text-xs px-2.5 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
                  >
                    {movingTo === col.id ? '...' : col.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {canEdit && (
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => { onClose(); onEdit(order) }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={13} /> Editar
            </button>
            <button
              onClick={() => { onClose(); onCancel(order) }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <XCircle size={13} /> Cancelar
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── OrderListRow (fila draggable, sin horario) ──────────────────────────────

// Indicador de estado del pedido en la agenda (el borde izquierdo sigue siendo
// el color del CHOFER; esto se suma como un punto). Pedido por Lucas: ver de un
// vistazo entregados/pendientes/despachados/cancelados sin que los entregados
// se oculten.
const ESTADO_INFO: Record<Order['status'], { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#9ca3af' },
  confirmado: { label: 'Despachado', color: '#2563eb' },
  en_camino:  { label: 'En camino',  color: '#0891b2' },
  entregado:  { label: 'Entregado',  color: '#16a34a' },
  cancelado:  { label: 'Cancelado',  color: '#dc2626' },
}

const OrderListRow = memo(function OrderListRow({ order, choferes, codigoCliente, isHighlighted, onClick }: {
  order: Order; choferes: UserProfile[]; codigoCliente?: string; isHighlighted?: boolean; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.id })
  const color = order.driverId ? driverColor(order.driverId, choferes) : '#D97706'
  const est = ESTADO_INFO[order.status] ?? ESTADO_INFO.pendiente
  const completado = order.status === 'entregado' || order.status === 'cancelado'
  const totalUnits = order.products.reduce((sum, p) => sum + p.quantity, 0)
  const { logo: clientLogo, empresa, sucursal } = resolveClientDisplay(order.clientId, order.clientName)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.35 : 1,
        borderLeftColor: color,
      }}
      className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-r-lg overflow-hidden bg-white border border-l-[3px] border-[#E4E1D6] cursor-pointer touch-none select-none hover:border-accent/60 hover:shadow-sm transition-all ${
        isHighlighted ? 'ring-2 ring-accent/40' : ''
      } ${completado ? 'opacity-60' : ''}`}
    >
      {clientLogo && (
        <span className="shrink-0 w-4 h-4 rounded bg-[#F8F7F2] ring-1 ring-[#E4E1D6] flex items-center justify-center overflow-hidden">
          <img src={clientLogo.src} alt="" title={clientLogo.alt} className="w-full h-full object-contain" />
        </span>
      )}
      <p className={`text-xs font-semibold text-gray-900 truncate min-w-0 flex-1 ${order.status === 'cancelado' ? 'line-through' : ''}`}>
        {!clientLogo && empresa && (
          <span className="text-gray-400 font-normal">{empresa} · </span>
        )}
        {sucursal}
      </p>
      {codigoCliente && (
        <span className="text-[9px] text-gray-400 font-mono shrink-0">{codigoCliente}</span>
      )}
      {order.numeroOC && (
        <span className="text-[9px] text-gray-400 font-mono shrink-0">OC {order.numeroOC}</span>
      )}
      {order.reprogramado && (
        <span className="text-amber-500 shrink-0" title={`Reprogramado${order.motivoReprogramacion ? `: ${order.motivoReprogramacion}` : ''}`}>↻</span>
      )}
      <span className="text-[10px] text-gray-400 font-mono tabular-nums shrink-0">{totalUnits}u</span>
      <span title={est.label} aria-label={est.label} className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: est.color }} />
    </div>
  )
}, (prev, next) => {
  const o1 = prev.order, o2 = next.order
  return (
    o1.id === o2.id && o1.status === o2.status && o1.driverId === o2.driverId &&
    o1.clientName === o2.clientName && o1.numeroOC === o2.numeroOC && o1.products.length === o2.products.length &&
    o1.reprogramado === o2.reprogramado && o1.motivoReprogramacion === o2.motivoReprogramacion &&
    prev.choferes === next.choferes && prev.isHighlighted === next.isHighlighted &&
    prev.codigoCliente === next.codigoCliente
  )
})

// ── DayListColumn (columna de día: cabecera + lista completa de pedidos) ───

const DayListColumn = memo(function DayListColumn({ id, label, sublabel, orders, choferes, codigoByClientId, isToday, isBandeja, highlightedOrderId, onOpenOrder, fullWidth }: {
  id:        string
  label:     string
  sublabel?: string
  orders:    Order[]
  choferes:  UserProfile[]
  codigoByClientId: Map<string, string | undefined>
  isToday:   boolean
  isBandeja?: boolean
  highlightedOrderId?: string | null
  onOpenOrder: (order: Order) => void
  fullWidth?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const unassigned = orders.filter((o) => !o.driverId).length
  // Sin asignar primero, para triage rápido en días con muchos pedidos.
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => Number(!!a.driverId) - Number(!!b.driverId)),
    [orders],
  )

  return (
    <div className={`flex flex-col rounded-xl border transition-colors ${
      fullWidth ? 'w-full h-full' : 'w-[340px] shrink-0'
    } ${
      !fullWidth && isBandeja ? 'sticky left-0 z-10 shadow-[6px_0_12px_-6px_rgba(0,0,0,0.15)]' : ''
    } ${
      isOver ? 'border-accent bg-accent/5' : isToday ? 'border-accent/40 bg-accent/[0.03]' : isBandeja ? 'border-[#D3D1C7] bg-gray-50' : 'border-[#D3D1C7] bg-white'
    }`}>
      <div className="text-center py-2 border-b border-[#D3D1C7] shrink-0">
        <p className={`text-sm font-bold ${isToday ? 'text-accent' : 'text-gray-900'}`}>{label}</p>
        {sublabel && <p className="text-[10px] text-gray-400">{sublabel}</p>}
        <div className="flex items-center justify-center gap-1 mt-0.5 h-4">
          {unassigned > 0 && (
            <span className="text-[9px] bg-amber-100 text-amber-600 border border-amber-200 px-1.5 rounded-full font-semibold leading-none">
              {unassigned}⚠
            </span>
          )}
          {orders.length > 0 && (
            <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 rounded-full font-semibold leading-none">
              {orders.length}
            </span>
          )}
        </div>
      </div>

      <div ref={setNodeRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {sortedOrders.map((order) => (
          <OrderListRow
            key={order.id}
            order={order}
            choferes={choferes}
            codigoCliente={getCodigoCliente(codigoByClientId, order.clientId, order.clientAddress)}
            isHighlighted={order.id === highlightedOrderId}
            onClick={() => onOpenOrder(order)}
          />
        ))}
        {orders.length === 0 && (
          <div className="flex items-center justify-center h-full py-6">
            <p className="text-xs text-gray-400">{isOver ? '+ Soltar acá' : 'Sin pedidos'}</p>
          </div>
        )}
      </div>
    </div>
  )
}, (prev, next) => {
  if (prev.id !== next.id || prev.choferes !== next.choferes) return false
  if (prev.isToday !== next.isToday || prev.highlightedOrderId !== next.highlightedOrderId) return false
  if (prev.fullWidth !== next.fullWidth || prev.codigoByClientId !== next.codigoByClientId) return false
  if (prev.orders.length !== next.orders.length) return false
  return prev.orders.every((o, i) => {
    const n = next.orders[i]
    return o.id === n.id && o.status === n.status && o.driverId === n.driverId
  })
})

// ── MiniCalendar ─────────────────────────────────────────────────────────────

function MiniCalendar({
  orders,
  startDate,
  onSelectDay,
}: {
  orders:      Order[]
  startDate:   Date
  onSelectDay: (date: Date) => void
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(startDate); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })

  useEffect(() => {
    setViewMonth((prev) => {
      if (
        startDate.getMonth()    === prev.getMonth() &&
        startDate.getFullYear() === prev.getFullYear()
      ) return prev
      const d = new Date(startDate); d.setDate(1); d.setHours(0, 0, 0, 0)
      return d
    })
  }, [startDate])

  const datesWithOrders = useMemo(() => {
    const s = new Set<string>()
    orders.forEach((o) => { if (o.status !== 'cancelado') { const d = orderDateStr(o); if (d) s.add(d) } })
    return s
  }, [orders])

  const days = useMemo(() => {
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay  = new Date(year, month + 1, 0)
    let dow = firstDay.getDay()
    dow = dow === 0 ? 6 : dow - 1
    const result: (Date | null)[] = Array(dow).fill(null)
    for (let d = 1; d <= lastDay.getDate(); d++) result.push(new Date(year, month, d))
    return result
  }, [viewMonth])

  const windowSet = useMemo(() => {
    const s = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate); d.setDate(d.getDate() + i); s.add(dateToStr(d))
    }
    return s
  }, [startDate])

  const today = dateToStr(new Date())
  const monthLabel = viewMonth.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const rangeStart = startDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
  const rangeEnd   = new Date(startDate.getTime() + 6 * 86400000)
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })

  return (
    <div className="w-44 shrink-0 bg-white border border-[#D3D1C7] rounded-xl shadow-lg p-3 flex flex-col gap-2">
      {/* Navegación de mes */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft size={13} />
        </button>
        <p className="text-[11px] font-semibold text-gray-700 capitalize">{monthLabel}</p>
        <button
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Cabecera días */}
      <div className="grid grid-cols-7 text-center">
        {['L','M','X','J','V','S','D'].map((d) => (
          <span key={d} className="text-[9px] font-semibold text-gray-400">{d}</span>
        ))}
      </div>

      {/* Grilla de días */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />
          const str       = dateToStr(day)
          const inWindow  = windowSet.has(str)
          const hasOrders = datesWithOrders.has(str)
          const isToday   = str === today

          return (
            <button
              key={str}
              onClick={() => onSelectDay(day)}
              title={str}
              className={`relative flex flex-col items-center justify-center h-6 w-6 rounded-md mx-auto text-[11px] font-medium transition-colors
                ${inWindow  ? 'bg-accent/15 text-accent font-bold'        : 'text-gray-700 hover:bg-gray-100'}
                ${isToday && !inWindow ? 'ring-1 ring-accent/60 text-accent' : ''}
              `}
            >
              {day.getDate()}
              {hasOrders && (
                <span className={`absolute bottom-0 w-1 h-1 rounded-full ${inWindow ? 'bg-accent' : 'bg-gray-300'}`} />
              )}
            </button>
          )
        })}
      </div>

      {/* Semana activa */}
      <div className="border-t border-[#D3D1C7] pt-1.5 text-center">
        <p className="text-[10px] text-gray-400">{rangeStart} – {rangeEnd}</p>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function LogisticaDashboard() {
  // Gerente comercial ve las mismas pestañas que logística (incluido
  // Despacho) — firestore.rules le da el mismo acceso a despachos/
  // asignacionesDia que a operador (super_admin/logistica).
  const tabs = ['pedidos', 'despacho', 'mapa'] as const
  const [mainTab,      setMainTab]      = useState<'despacho' | 'pedidos' | 'mapa'>('pedidos')
  const [importModal,  setImportModal]  = useState(false)
  const [pedidosYaModal, setPedidosYaModal] = useState(false)
  const [pedidoManual, setPedidoManual] = useState(false)
  const [activeId,     setActiveId]     = useState<string | null>(null)
  const [allClients,   setAllClients]   = useState<UserProfile[]>([])
  const clientsLoadedRef = useRef(false)

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(12, 0, 0, 0); return d
  })
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null)
  const [detailOrder,        setDetailOrder]        = useState<Order | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mini-calendario: popover en vez de columna fija, para no perder ancho
  // de la grilla. Se cierra solo al elegir un día o al clickear afuera.
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!calendarOpen) return
    const onOutside = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setCalendarOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [calendarOpen])

  // Fila de días: la rueda del mouse (vertical) también scrollea horizontal
  // mientras el puntero está sobre la fila — sin trackpad, deslizar hacia
  // la derecha no era descubrible. El degradado del borde derecho se apaga
  // solo al llegar al final.
  const [canScrollRight, setCanScrollRight] = useState(true)
  const dayRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = dayRowRef.current
    if (!el) return
    const updateEdge = () => setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4)
    updateEdge()
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', updateEdge)
    window.addEventListener('resize', updateEdge)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', updateEdge)
      window.removeEventListener('resize', updateEdge)
    }
  }, [])

  const goToToday    = () => { const d = new Date(); d.setHours(12, 0, 0, 0); setStartDate(d) }
  const goToPrevWeek = () => setStartDate((p) => { const d = new Date(p); d.setDate(d.getDate() - 7); return d })
  const goToNextWeek = () => setStartDate((p) => { const d = new Date(p); d.setDate(d.getDate() + 7); return d })
  const handleSelectDay = (day: Date) => { const d = new Date(day); d.setHours(12, 0, 0, 0); setStartDate(d) }

  // Resultado del buscador global: si el pedido está en la ventana del Kanban
  // (últimos 30 días → futuro) se salta a su semana y se resalta la tarjeta;
  // si es un pedido viejo que quedó fuera de esa ventana, se abre el detalle
  // directamente porque no hay tarjeta a la que saltar.
  const handleSearchJump = (order: Order) => {
    const inKanbanWindow = orders.some((o) => o.id === order.id)
    if (!inKanbanWindow) { setDetailOrder(order); return }
    setMainTab('pedidos')
    handleSelectDay(tsToDate(order.date))
    setHighlightedOrderId(order.id)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedOrderId(null), 2500)
  }

  const { orders,   loading: loadO } = useKanbanOrders()
  const { choferes, loading: loadC } = useChoferes()
  const loading = loadO || loadC

  // Cargar clientes al abrir cualquier tab que los necesite (una sola vez):
  // pedidos usa el código de cliente en las tarjetas, mapa/despacho el resto del perfil.
  useEffect(() => {
    if (!['pedidos', 'mapa', 'despacho'].includes(mainTab) || clientsLoadedRef.current) return
    const load = async () => {
      const { getClientesActivos } = await import('../../services/userService')
      const data = await getClientesActivos()
      setAllClients(data)
      clientsLoadedRef.current = true
    }
    load()
  }, [mainTab])

  // codigoCliente a nivel usuario es solo el código de UNA sucursal (la
  // primera cargada) — en grupos empresarios cada sucursal tiene su propio
  // código en addresses[].id (así quedó del import de Excel). Domicilios
  // creados desde la UI en cambio tienen un id random (crypto.randomUUID())
  // que no es un código real, así que no se usa como tal. El mapa guarda
  // ambas cosas: la clave "uid|dirección" para resolver el código exacto de
  // la sucursal del pedido, y la clave "uid" sola como fallback.
  const codigoByClientId = useMemo(() => buildCodigoByClientId(allClients), [allClients])

  const sensors = useSensors(
    useSensor(MouseSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const columns  = useMemo(() => buildColumns(startDate), [startDate])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return d
  }), [startDate])
  const dayIds  = useMemo(() => new Set(columns.filter((c) => c.id !== 'bandeja').map((c) => c.id)), [columns])

  // Mobile: una sola columna visible a la vez, elegida con chips. Si la
  // semana cambia (navegación) y el día elegido ya no está en la ventana,
  // se recae en "hoy" (si está en el rango) o el primer día de la semana.
  const isMobile = useIsMobile()
  const [mobileCol, setMobileCol] = useState(() => dateToStr(new Date()))
  useEffect(() => {
    if (columns.some((c) => c.id === mobileCol)) return
    const today = dateToStr(new Date())
    setMobileCol(columns.some((c) => c.id === today) ? today : (columns[1]?.id ?? columns[0].id))
  }, [columns, mobileCol])

  // Detalle rápido de un pedido: no encaja en la fila de columnas, se
  // resuelve como overlay aparte.
  const [quickViewOrder, setQuickViewOrder] = useState<Order | null>(null)
  const [cancelOrder,    setCancelOrder]    = useState<Order | null>(null)

  const ordersByColumn = useMemo(() => {
    const result: Record<string, Order[]> = {}
    columns.forEach((c) => { result[c.id] = [] })
    // Se incluyen entregados y cancelados (antes se filtraban): la agenda ahora
    // muestra el día completo, con el estado indicado por color y atenuados
    // (ver OrderListRow). getOrderColumn ya evita traer completados viejos
    // fuera de la semana visible.
    orders
      .forEach((o) => {
        const col = getOrderColumn(o, dayIds)
        if (col === null) return
        if (result[col] !== undefined) result[col].push(o)
        else result['bandeja'].push(o)
      })
    Object.values(result).forEach((arr) =>
      arr.sort((a, b) => orderDateStr(a).localeCompare(orderDateStr(b)) || a.clientName.localeCompare(b.clientName)),
    )
    return result
  }, [orders, columns, dayIds])

  const activeOrder = activeId ? orders.find((o) => o.id === activeId) : null

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string)

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over) return
    const orderId   = active.id as string
    const targetCol = over.id as string
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const currentCol = getOrderColumn(order, dayIds)
    if (currentCol === targetCol) return
    try {
      if (targetCol === 'bandeja') {
        await moveOrderToBandeja(orderId)
      } else {
        await moveOrderDate(orderId, targetCol)
      }
    } catch (err) {
      // Si el write falla la tarjeta vuelve sola a su columna (onSnapshot manda).
      reportError(err, { origen: 'LogisticaDashboard' })
    }
  }, [orders, dayIds])

  const todayStr = dateToStr(new Date())

  const kpis = useMemo(() => {
    const todayOrders = orders.filter((o) => orderDateStr(o) === todayStr)
    return {
      total:      todayOrders.filter((o) => !['cancelado'].includes(o.status)).length,
      sinAsignar: todayOrders.filter((o) => !o.driverId && !['entregado', 'cancelado'].includes(o.status)).length,
      enCamino:   todayOrders.filter((o) => o.status === 'en_camino').length,
      entregados: todayOrders.filter((o) => o.status === 'entregado').length,
    }
  }, [orders, todayStr])

  const weekRangeLabel = `${startDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })} – ${
    new Date(startDate.getTime() + 6 * 86400000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  }`

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#F1EFE8] text-gray-900">

      {/* Header + Tabs — compacto, altura fija: todo lo periférico cede el
          máximo de alto y ancho posible a la grilla de la pestaña Pedidos. */}
      <div className="px-4 pt-3 flex-shrink-0">
        {/* Título + KPIs + acciones — una sola fila en desktop, apilado en mobile */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 mb-2">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-base font-bold text-gray-900 shrink-0">Planificación</h1>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-baseline gap-1">
                <b className="text-sm font-bold text-gray-900 tabular-nums">{kpis.total}</b>
                <span className="text-gray-400">hoy</span>
              </span>
              <span className="flex items-baseline gap-1">
                <b className={`text-sm font-bold tabular-nums ${kpis.sinAsignar > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{kpis.sinAsignar}</b>
                <span className={kpis.sinAsignar > 0 ? 'text-amber-500' : 'text-gray-400'}>sin asignar</span>
              </span>
              <span className="flex items-baseline gap-1">
                <b className="text-sm font-bold tabular-nums text-accent">{kpis.enCamino}</b>
                <span className="text-gray-400">en camino</span>
              </span>
              <span className="flex items-baseline gap-1">
                <b className="text-sm font-bold tabular-nums text-green-600">{kpis.entregados}</b>
                <span className="text-gray-400">entregados</span>
              </span>
            </div>
          </div>
          {mainTab === 'pedidos' && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setImportModal(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-white border border-[#D3D1C7] rounded-lg hover:border-accent transition-colors text-gray-700"
              >
                <FileText size={13} />
                <span className="hidden sm:inline">Cargar PDF</span>
              </button>
              <button
                onClick={() => setPedidosYaModal(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-white border border-[#D3D1C7] rounded-lg hover:border-accent transition-colors text-gray-700"
              >
                <img src="/logo-pedidosya.png" alt="" className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cargar Pedidos Ya</span>
              </button>
              <button
                onClick={() => setPedidoManual(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors font-medium"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Pedido manual</span>
              </button>
            </div>
          )}
        </div>

        {/* Tabs + buscador global — apilados en mobile para no comprimirse */}
        <div className="flex flex-col md:flex-row md:items-start gap-2 md:gap-3">
          <div className="flex border-b border-gray-200 gap-1 shrink-0 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t} onClick={() => setMainTab(t)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  mainTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}>
                {t === 'despacho' ? 'Despacho' : t === 'pedidos' ? 'Pedidos' : 'Mapa'}
              </button>
            ))}
          </div>
          <div className="w-full md:flex-1 md:min-w-[240px] md:max-w-lg">
            <PedidoSearchBar onJumpAndHighlight={handleSearchJump} onOpenDetail={setDetailOrder} codigoByClientId={codigoByClientId} />
          </div>
        </div>
      </div>

      {/* Contenido (ocupa el resto de la pantalla) */}
      <div className={`flex-1 min-h-0 overflow-hidden ${mainTab === 'pedidos' ? 'flex flex-col' : ''}`}>


        {/* Tab Despacho */}
        {mainTab === 'despacho' && (
          <DespachoBoard
            orders={orders}
            choferes={choferes}
            allClients={allClients}
            loading={loading}
          />
        )}

        {/* Tab Mapa */}
        {mainTab === 'mapa' && (
          <MapaPlanificacion
            orders={orders}
            choferes={choferes}
            allClients={allClients}
            weekDays={weekDays}
          />
        )}

        {/* Tab Pedidos */}
        {mainTab === 'pedidos' && (loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner /></div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-4">

            {/* Barra de navegación de semana — el rango de fechas abre el
                mini-calendario como popover en desktop; en mobile es solo
                texto (la fila de chips de día ya cubre la navegación fina) */}
            <div ref={calendarRef} className="relative flex items-center gap-2 mb-2 flex-wrap">
              <button
                onClick={goToPrevWeek}
                className="p-1.5 rounded-lg border border-[#D3D1C7] bg-white hover:border-accent text-gray-500 hover:text-accent transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={goToToday}
                className="px-3 py-1.5 rounded-lg border border-[#D3D1C7] bg-white text-xs font-semibold text-gray-600 hover:border-accent hover:text-accent transition-colors"
              >
                Hoy
              </button>
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                className={`hidden md:flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors ${
                  calendarOpen ? 'text-accent bg-white' : 'text-gray-500 hover:text-accent hover:bg-white'
                }`}
              >
                <CalendarDays size={13} />
                {weekRangeLabel}
              </button>
              <span className="md:hidden flex-1 text-center text-xs font-medium text-gray-500">
                {weekRangeLabel}
              </span>
              <button
                onClick={goToNextWeek}
                className="p-1.5 rounded-lg border border-[#D3D1C7] bg-white hover:border-accent text-gray-500 hover:text-accent transition-colors"
              >
                <ChevronRight size={15} />
              </button>

              {calendarOpen && (
                <div className="absolute z-30 top-full mt-1.5 left-1/2 -translate-x-1/2">
                  <MiniCalendar
                    orders={orders}
                    startDate={startDate}
                    onSelectDay={(d) => { handleSelectDay(d); setCalendarOpen(false) }}
                  />
                </div>
              )}
            </div>

            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              {/* Desktop vs. mobile se elige con JS (useIsMobile), no solo con
                  CSS (hidden md:...): dos DayListColumn con el mismo id
                  montadas a la vez (una solo tapada por CSS) hacen que
                  dnd-kit registre dos useDraggable/useDroppable con el mismo
                  id y termine midiendo la copia oculta — el "fantasma" del
                  drag aparecía pegado arriba de la pantalla por esto. */}
              {isMobile ? (
                /* Mobile: un solo día/bandeja a la vez, elegido con chips —
                    no hay columnas vecinas visibles para arrastrar una
                    tarjeta hacia otro día, así que ahí se usa "Mover a..."
                    en el detalle. */
                <div className="flex flex-1 min-h-0 flex-col">
                  <div className="flex gap-1.5 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden">
                    {columns.map((col) => {
                      const count = ordersByColumn[col.id]?.length ?? 0
                      const selected = col.id === mobileCol
                      return (
                        <button
                          key={col.id}
                          onClick={() => setMobileCol(col.id)}
                          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            selected ? 'bg-accent text-white' : 'bg-white border border-[#D3D1C7] text-gray-600 hover:border-accent/50'
                          } ${col.id === todayStr && !selected ? 'ring-1 ring-accent/40' : ''}`}
                        >
                          {col.label}
                          {count > 0 && (
                            <span className={`ml-1 text-[10px] font-bold ${selected ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex-1 min-h-0">
                    {(() => {
                      const col = columns.find((c) => c.id === mobileCol) ?? columns[0]
                      return (
                        <DayListColumn
                          id={col.id}
                          label={col.label}
                          sublabel={col.sublabel}
                          orders={ordersByColumn[col.id] ?? []}
                          choferes={choferes}
                          codigoByClientId={codigoByClientId}
                          isToday={col.id === todayStr}
                          isBandeja={col.id === 'bandeja'}
                          highlightedOrderId={highlightedOrderId}
                          onOpenOrder={setQuickViewOrder}
                          fullWidth
                        />
                      )
                    })()}
                  </div>
                </div>
              ) : (
                /* Desktop: columnas anchas para que el nombre del cliente se
                    lea bien; Bandeja arranca la fila y el resto de la semana
                    se ve deslizando a la derecha (scroll horizontal). */
                <div className="relative flex-1 min-h-0">
                  <div
                    ref={dayRowRef}
                    className="h-full overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
                  >
                    <div className="flex gap-1.5 h-full" style={{ width: 'max-content' }}>
                      {columns.map((col) => (
                        <DayListColumn
                          key={col.id}
                          id={col.id}
                          label={col.label}
                          sublabel={col.sublabel}
                          orders={ordersByColumn[col.id] ?? []}
                          choferes={choferes}
                          codigoByClientId={codigoByClientId}
                          isToday={col.id === todayStr}
                          isBandeja={col.id === 'bandeja'}
                          highlightedOrderId={highlightedOrderId}
                          onOpenOrder={setQuickViewOrder}
                        />
                      ))}
                    </div>
                  </div>
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute top-0 right-0 h-full w-14 bg-gradient-to-l from-[#F1EFE8] to-transparent transition-opacity duration-200 ${
                      canScrollRight ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </div>
              )}

              <DragOverlay dropAnimation={null}>
                {activeOrder && (
                  <div className="bg-white border-2 border-accent rounded-xl p-3 shadow-2xl rotate-1 w-52 space-y-1.5">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{activeOrder.clientName}</p>
                    <p className="text-xs text-gray-500 truncate">{activeOrder.clientAddress}</p>
                    <p className="text-xs text-gray-600">{summarizeProducts(activeOrder.products)}</p>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        ))}
      </div>

      {importModal && (
        <Suspense fallback={null}>
          <ImportarPedidoModal open={importModal} onClose={() => setImportModal(false)} />
        </Suspense>
      )}
      {pedidosYaModal && (
        <Suspense fallback={null}>
          <ImportarPedidosYaModal open={pedidosYaModal} onClose={() => setPedidosYaModal(false)} />
        </Suspense>
      )}
      <PedidoManualModal     open={pedidoManual}   onClose={() => setPedidoManual(false)} defaultDate={dateToStr(startDate)} />

      {detailOrder && (
        <EditOrderModal order={detailOrder} onClose={() => setDetailOrder(null)} onSaved={() => {}} />
      )}

      {quickViewOrder && (
        <OrderQuickView
          order={quickViewOrder}
          choferes={choferes}
          codigoCliente={getCodigoCliente(codigoByClientId, quickViewOrder.clientId, quickViewOrder.clientAddress)}
          columns={columns}
          onClose={() => setQuickViewOrder(null)}
          onEdit={setDetailOrder}
          onCancel={setCancelOrder}
        />
      )}

      {cancelOrder && (
        <CancelOrderModal order={cancelOrder} onClose={() => setCancelOrder(null)} onCancelled={() => setCancelOrder(null)} />
      )}
    </div>
  )
}
