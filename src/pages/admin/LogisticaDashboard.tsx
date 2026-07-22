import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Plus, MoreVertical, Pencil, XCircle, Minus, GripVertical, ChevronLeft, ChevronRight, Clock, CalendarDays } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import ImportarPedidoModal from '../../components/admin/ImportarPedidoModal'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import MapaPlanificacion from '../../components/admin/MapaPlanificacion'
import DespachoBoard from '../../components/admin/DespachoBoard'
import PedidoSearchBar from '../../components/admin/PedidoSearchBar'
import { useKanbanOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAuth } from '../../context/AuthContext'
import { moveOrderDate, moveOrderToBandeja, assignDriver, cancelOrderBy, editOrderBy, EditOrderParams } from '../../services/orderService'
import { summarizeProducts, tsToDate } from '../../utils/helpers'
import { PRODUCTS } from '../../utils/constants'
import { useCatalogo } from '../../hooks/useCatalogo'
import { Order, OrderProduct, UserProfile, AccionHistorial } from '../../types'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIVER_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFE66D', '#C084FC', '#F97316', '#34D399']

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

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

// ── EditOrderModal ────────────────────────────────────────────────────────────

function EditOrderModal({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()
  // Catálogo completo desde Firestore. Si aún no cargó, cae a la lista base
  // hardcodeada (evita quedarse sin productos para agregar).
  const disponibles = catalogo.length > 0
    ? catalogo.map((c) => ({ id: c.id, nombre: c.nombre }))
    : PRODUCTS.map((p) => ({ id: p.id, nombre: p.name }))
  const [products,    setProducts]    = useState<OrderProduct[]>(order.products.map((p) => ({ ...p })))
  const [date,        setDate]        = useState(order.date?.toDate ? order.date.toDate().toISOString().split('T')[0] : '')
  const [horaEntrega, setHoraEntrega] = useState(order.horaEntrega ?? '')
  const [notes,       setNotes]       = useState(order.notes ?? '')
  const [numeroOC,    setNumeroOC]    = useState(order.numeroOC ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const updateQty = (name: string, qty: number) => {
    if (qty < 1) { removeProduct(name); return }
    setProducts((prev) => prev.map((p) => p.name === name ? { ...p, quantity: qty } : p))
  }

  const removeProduct = (name: string) => setProducts((prev) => prev.filter((p) => p.name !== name))

  const addProduct = (id: string) => {
    const cat = disponibles.find((p) => p.id === id)
    if (!cat) return
    if (products.find((p) => p.name === cat.nombre)) {
      setProducts((prev) => prev.map((p) => p.name === cat.nombre ? { ...p, quantity: p.quantity + 1 } : p))
    } else {
      setProducts((prev) => [...prev, { name: cat.nombre, quantity: 1, productoId: cat.id }])
    }
  }

  const handleSave = async () => {
    if (!user || products.length === 0 || !date) return
    setSaving(true)
    setError('')
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    try {
      await editOrderBy(order.id, { products, date, horaEntrega, notes, numeroOC }, actor)
      onSaved()
      onClose()
    } catch (err) {
      console.error(err)
      setError('No se pudieron guardar los cambios. Verificá tu conexión y permisos e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Editar pedido — ${order.clientName}`}>
      <div className="space-y-4">

        {/* Productos */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Productos</p>
          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                <div className="flex items-center gap-1">
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => updateQty(p.name, p.quantity - 1)} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                    <Minus size={12} />
                  </button>
                  <input
                    type="number" min={1} value={p.quantity}
                    onChange={(e) => updateQty(p.name, parseInt(e.target.value) || 1)}
                    className="w-12 text-center text-sm border border-gray-200 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => updateQty(p.name, p.quantity + 1)} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                    <Plus size={12} />
                  </button>
                  <button onClick={() => removeProduct(p.name)} className="ml-1 text-red-400 hover:text-red-600 transition-colors">
                    <XCircle size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Agregar producto */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {disponibles.filter((p) => !products.find((pp) => pp.name === p.nombre)).map((p) => (
              <button key={p.id} onClick={() => addProduct(p.id)} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-accent hover:text-accent transition-colors">
                + {p.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Fecha y hora */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Hora entrega</label>
            <input type="time" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        </div>

        {/* Orden de compra */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Orden de compra</label>
          <input type="text" value={numeroOC} onChange={(e) => setNumeroOC(e.target.value)}
            placeholder="N° OC (opcional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>

        {/* Notas */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notas</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || products.length === 0 || !date}
            className="flex-1 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>

        {order.historialAcciones && order.historialAcciones.length > 0 && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Historial de cambios</p>
            {[...order.historialAcciones].reverse().map((h: AccionHistorial, i: number) => {
              const ts    = tsToDate(h.timestamp)
              const fecha = ts.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
              const hora  = ts.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
              const label = h.accion === 'cancelado' ? 'canceló el pedido' : h.accion === 'modificado' ? 'modificó el pedido' : h.accion
              return (
                <div key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
                  <span className="text-gray-400 shrink-0 tabular-nums">{fecha} {hora}</span>
                  <span className="text-accent font-semibold shrink-0">{h.usuarioNombre}</span>
                  <span className="text-gray-500">{label}{h.detalle && h.detalle !== 'null' ? ` — ${h.detalle}` : ''}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── CancelOrderModal ──────────────────────────────────────────────────────────

function CancelOrderModal({ order, onClose, onCancelled }: { order: Order; onClose: () => void; onCancelled: () => void }) {
  const { user }   = useAuth()
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleCancel = async () => {
    if (!user) return
    setSaving(true)
    setError('')
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    try {
      await cancelOrderBy(order.id, motivo || 'Sin motivo', actor)
      onCancelled()
      onClose()
    } catch (err) {
      console.error(err)
      setError('No se pudo cancelar el pedido. Verificá tu conexión y permisos e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Cancelar pedido">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          ¿Cancelar el pedido de <span className="font-semibold text-gray-900">{order.clientName}</span>?
        </p>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Motivo (opcional)</label>
          <textarea
            value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            placeholder="Ej: cliente canceló, error de carga..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
          />
        </div>
        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            Volver
          </button>
          <button onClick={handleCancel} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors">
            {saving ? 'Cancelando...' : 'Sí, cancelar pedido'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

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
      console.error(err)
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
      console.error(err)
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

const OrderListRow = memo(function OrderListRow({ order, choferes, isHighlighted, onClick }: {
  order: Order; choferes: UserProfile[]; isHighlighted?: boolean; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.id })
  const color = order.driverId ? driverColor(order.driverId, choferes) : '#D97706'
  const totalUnits = order.products.reduce((sum, p) => sum + p.quantity, 0)

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
      }`}
    >
      <p className="text-xs font-semibold text-gray-900 truncate min-w-0 flex-1">{order.clientName}</p>
      <span className="text-[10px] text-gray-400 font-mono tabular-nums shrink-0">{totalUnits}u</span>
    </div>
  )
}, (prev, next) => {
  const o1 = prev.order, o2 = next.order
  return (
    o1.id === o2.id && o1.status === o2.status && o1.driverId === o2.driverId &&
    o1.clientName === o2.clientName && o1.products.length === o2.products.length &&
    prev.choferes === next.choferes && prev.isHighlighted === next.isHighlighted
  )
})

// ── DayListColumn (columna de día: cabecera + lista completa de pedidos) ───

const DayListColumn = memo(function DayListColumn({ id, label, sublabel, orders, choferes, isToday, isBandeja, highlightedOrderId, onOpenOrder, fullWidth }: {
  id:        string
  label:     string
  sublabel?: string
  orders:    Order[]
  choferes:  UserProfile[]
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
  if (prev.fullWidth !== next.fullWidth) return false
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
  const { user: currentUser } = useAuth()
  // El tab Despacho opera colecciones reservadas a operadores (despachos,
  // asignacionesDia): el gerente comercial no lo ve.
  const tabs = currentUser?.rol === 'gerente_comercial'
    ? (['pedidos', 'mapa'] as const)
    : (['pedidos', 'despacho', 'mapa'] as const)
  const [mainTab,      setMainTab]      = useState<'despacho' | 'pedidos' | 'mapa'>('pedidos')
  const [importModal,  setImportModal]  = useState(false)
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

  const codigoByClientId = useMemo(
    () => new Map(allClients.map((c) => [c.uid, c.codigoCliente])),
    [allClients],
  )

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
    orders
      .filter((o) => !['entregado', 'cancelado'].includes(o.status))
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
      console.error(err)
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
      <Navbar />

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
            <PedidoSearchBar onJumpAndHighlight={handleSearchJump} onOpenDetail={setDetailOrder} />
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

      <ImportarPedidoModal open={importModal}  onClose={() => setImportModal(false)} />
      <PedidoManualModal   open={pedidoManual} onClose={() => setPedidoManual(false)} defaultDate={dateToStr(startDate)} />

      {detailOrder && (
        <EditOrderModal order={detailOrder} onClose={() => setDetailOrder(null)} onSaved={() => {}} />
      )}

      {quickViewOrder && (
        <OrderQuickView
          order={quickViewOrder}
          choferes={choferes}
          codigoCliente={codigoByClientId.get(quickViewOrder.clientId)}
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
