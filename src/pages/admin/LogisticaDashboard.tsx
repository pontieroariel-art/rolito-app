import { useState, useMemo, useCallback } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Plus } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import ImportarPedidoModal from '../../components/admin/ImportarPedidoModal'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import { useAllOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { moveOrderDate, assignDriver } from '../../services/orderService'
import { summarizeProducts } from '../../utils/helpers'
import { Order, UserProfile } from '../../types'

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

function buildColumns(): { id: string; label: string; sublabel?: string }[] {
  const cols: { id: string; label: string; sublabel?: string }[] = [
    { id: 'bandeja', label: 'Bandeja', sublabel: 'Sin fecha / Reprogramar' },
  ]
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + i)
    const label    = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : d.toLocaleDateString('es-AR', { weekday: 'short' })
    const sublabel = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
    cols.push({ id: dateToStr(d), label, sublabel })
  }
  return cols
}

function getOrderColumn(order: Order, dayIds: Set<string>): string {
  const dateStr = orderDateStr(order)
  const today   = dateToStr(new Date())
  if (!dateStr || dateStr < today || !dayIds.has(dateStr)) return 'bandeja'
  return dateStr
}

// ── KanbanCard ────────────────────────────────────────────────────────────────

function KanbanCard({ order, choferes }: { order: Order; choferes: UserProfile[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.id })
  const [assigning,    setAssigning]    = useState(false)
  const [loadingDriver, setLoadingDriver] = useState<string | null>(null)

  const driver = order.driverId ? choferes.find((c) => c.email === order.driverId) : null
  const color  = order.driverId ? driverColor(order.driverId, choferes) : null

  const handleAssign = async (email: string) => {
    setLoadingDriver(email)
    await assignDriver(order.id, email)
    setLoadingDriver(null)
    setAssigning(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 }}
      {...listeners}
      {...attributes}
      className="bg-white border border-[#D3D1C7] rounded-xl p-3 space-y-2 cursor-grab active:cursor-grabbing touch-none select-none hover:border-accent/50 hover:shadow-sm transition-all"
    >
      <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">{order.clientName}</p>
      {order.clientAddress && (
        <p className="text-xs text-gray-400 truncate">{order.clientAddress}</p>
      )}
      <p className="text-xs text-gray-600">{summarizeProducts(order.products)}</p>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        {driver ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setAssigning((v) => !v)}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: `${color}18`, color: color!, border: `1px solid ${color}40` }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color! }} />
            {driver.nombreContacto || driver.nombre}
          </button>
        ) : (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setAssigning((v) => !v)}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 transition-colors"
          >
            Sin asignar
          </button>
        )}
        {order.horaEntrega && (
          <span className="text-xs text-gray-400 shrink-0">{order.horaEntrega}</span>
        )}
      </div>

      {assigning && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="pt-2 border-t border-gray-100 flex flex-wrap gap-1.5"
        >
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
    </div>
  )
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({ id, label, sublabel, orders, choferes, isBandeja }: {
  id:        string
  label:     string
  sublabel?: string
  orders:    Order[]
  choferes:  UserProfile[]
  isBandeja: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const unassigned = orders.filter((o) => !o.driverId).length
  const colW = isBandeja ? 256 : 220

  return (
    <div className="flex flex-col" style={{ width: colW, minWidth: colW }}>
      {/* Header */}
      <div className={`px-3 py-2.5 rounded-t-xl border border-b-0 transition-colors ${
        isOver ? 'bg-accent/5 border-accent' : 'bg-white border-[#D3D1C7]'
      }`}>
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">{label}</p>
            {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
            {unassigned > 0 && (
              <span className="text-xs bg-amber-100 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full leading-none">
                {unassigned}⚠
              </span>
            )}
            {orders.length > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-semibold leading-none">
                {orders.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 rounded-b-xl border overflow-y-auto transition-colors ${
          isOver ? 'border-accent bg-accent/5' : 'border-[#D3D1C7] bg-[#F1EFE8]/60'
        }`}
        style={{ minHeight: 200 }}
      >
        {orders.map((order) => (
          <KanbanCard key={order.id} order={order} choferes={choferes} />
        ))}
        {orders.length === 0 && (
          <div className={`flex items-center justify-center rounded-lg border-2 border-dashed py-8 transition-colors ${
            isOver ? 'border-accent' : 'border-[#D3D1C7]'
          }`}>
            <p className="text-xs text-gray-400">{isOver ? '+ Soltar acá' : 'Sin pedidos'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function LogisticaDashboard() {
  const [importModal,  setImportModal]  = useState(false)
  const [pedidoManual, setPedidoManual] = useState(false)
  const [activeId,     setActiveId]     = useState<string | null>(null)

  const { orders,   loading: loadO } = useAllOrders()
  const { choferes, loading: loadC } = useChoferes()
  const loading = loadO || loadC

  const sensors = useSensors(
    useSensor(MouseSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const columns = useMemo(() => buildColumns(), [])
  const dayIds  = useMemo(() => new Set(columns.filter((c) => c.id !== 'bandeja').map((c) => c.id)), [columns])

  const ordersByColumn = useMemo(() => {
    const result: Record<string, Order[]> = {}
    columns.forEach((c) => { result[c.id] = [] })
    orders
      .filter((o) => !['entregado', 'cancelado'].includes(o.status))
      .forEach((o) => {
        const col = getOrderColumn(o, dayIds)
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
    if (targetCol === 'bandeja') return
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const currentCol = getOrderColumn(order, dayIds)
    if (currentCol === targetCol) return
    await moveOrderDate(orderId, targetCol)
  }, [orders, dayIds])

  const todayStr = dateToStr(new Date())

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />

      <div className="px-4 pt-4 pb-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4 max-w-full">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Planificación</h1>
            <p className="text-xs text-gray-500 capitalize">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setImportModal(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 bg-white border border-[#D3D1C7] rounded-xl hover:border-accent transition-colors text-gray-700"
            >
              <FileText size={14} />
              <span className="hidden sm:inline">Cargar PDF</span>
            </button>
            <button
              onClick={() => setPedidoManual(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 bg-accent text-white rounded-xl hover:bg-accent/90 transition-colors font-medium"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Pedido manual</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner /></div>
        ) : (
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            {/* Kanban */}
            <div className="overflow-x-auto pb-2 -mx-4 px-4">
              <div className="flex gap-3" style={{ width: 'max-content', height: 'calc(100vh - 140px)', minHeight: 400 }}>
                {columns.map((col) => (
                  <KanbanColumn
                    key={col.id}
                    id={col.id}
                    label={col.label}
                    sublabel={col.sublabel}
                    orders={ordersByColumn[col.id] ?? []}
                    choferes={choferes}
                    isBandeja={col.id === 'bandeja'}
                  />
                ))}
              </div>
            </div>

            {/* Floating card while dragging */}
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
        )}
      </div>

      <ImportarPedidoModal open={importModal}  onClose={() => setImportModal(false)} />
      <PedidoManualModal   open={pedidoManual} onClose={() => setPedidoManual(false)} defaultDate={todayStr} />
    </div>
  )
}
