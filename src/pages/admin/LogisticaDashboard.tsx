import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Plus, MoreVertical, Pencil, XCircle, Minus } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import ImportarPedidoModal from '../../components/admin/ImportarPedidoModal'
import PedidoManualModal from '../../components/admin/PedidoManualModal'
import MapaPlanificacion from '../../components/admin/MapaPlanificacion'
import DespachoBoard from '../../components/admin/DespachoBoard'
import { useKanbanOrders } from '../../hooks/useOrders'
import { useChoferes } from '../../hooks/useChoferes'
import { useAuth } from '../../context/AuthContext'
import { moveOrderDate, moveOrderToBandeja, assignDriver, cancelOrderBy, editOrderBy, EditOrderParams } from '../../services/orderService'
import { summarizeProducts, tsToDate } from '../../utils/helpers'
import { PRODUCTS } from '../../utils/constants'
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

// ── EditOrderModal ────────────────────────────────────────────────────────────

function EditOrderModal({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const [products,    setProducts]    = useState<OrderProduct[]>(order.products.map((p) => ({ ...p })))
  const [date,        setDate]        = useState(order.date?.toDate ? order.date.toDate().toISOString().split('T')[0] : '')
  const [horaEntrega, setHoraEntrega] = useState(order.horaEntrega ?? '')
  const [notes,       setNotes]       = useState(order.notes ?? '')
  const [numeroOC,    setNumeroOC]    = useState(order.numeroOC ?? '')
  const [saving,      setSaving]      = useState(false)

  const updateQty = (name: string, qty: number) => {
    if (qty < 1) { removeProduct(name); return }
    setProducts((prev) => prev.map((p) => p.name === name ? { ...p, quantity: qty } : p))
  }

  const removeProduct = (name: string) => setProducts((prev) => prev.filter((p) => p.name !== name))

  const addProduct = (id: string) => {
    const cat = PRODUCTS.find((p) => p.id === id)
    if (!cat) return
    if (products.find((p) => p.name === cat.name)) {
      setProducts((prev) => prev.map((p) => p.name === cat.name ? { ...p, quantity: p.quantity + 1 } : p))
    } else {
      setProducts((prev) => [...prev, { name: cat.name, quantity: 1, productoId: cat.id }])
    }
  }

  const handleSave = async () => {
    if (!user || products.length === 0 || !date) return
    setSaving(true)
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    await editOrderBy(order.id, { products, date, horaEntrega, notes, numeroOC }, actor)
    setSaving(false)
    onSaved()
    onClose()
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
            {PRODUCTS.filter((p) => !products.find((pp) => pp.name === p.name)).map((p) => (
              <button key={p.id} onClick={() => addProduct(p.id)} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-accent hover:text-accent transition-colors">
                + {p.name}
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

  const handleCancel = async () => {
    if (!user) return
    setSaving(true)
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    await cancelOrderBy(order.id, motivo || 'Sin motivo', actor)
    setSaving(false)
    onCancelled()
    onClose()
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

// ── KanbanCard ────────────────────────────────────────────────────────────────

const KanbanCard = memo(function KanbanCard({ order, choferes }: { order: Order; choferes: UserProfile[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.id })
  const [assigning,     setAssigning]     = useState(false)
  const [loadingDriver, setLoadingDriver] = useState<string | null>(null)
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [editModal,     setEditModal]     = useState(false)
  const [cancelModal,   setCancelModal]   = useState(false)

  const driver = order.driverId ? choferes.find((c) => c.email === order.driverId) : null
  const color  = order.driverId ? driverColor(order.driverId, choferes) : null

  const handleAssign = async (email: string) => {
    setLoadingDriver(email)
    await assignDriver(order.id, email)
    setLoadingDriver(null)
    setAssigning(false)
  }

  const canEdit = !['entregado', 'cancelado'].includes(order.status)

  return (
    <>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 }}
        {...listeners}
        {...attributes}
        className="bg-white border border-[#D3D1C7] rounded-xl p-3 space-y-2 cursor-grab active:cursor-grabbing touch-none select-none hover:border-accent/50 hover:shadow-sm transition-all"
      >
        {/* Header: nombre + menú */}
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-semibold text-gray-900 leading-tight flex-1">{order.clientName}</p>
          {canEdit && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="shrink-0 p-0.5 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <MoreVertical size={14} />
            </button>
          )}
        </div>

        {/* Menú desplegable */}
        {menuOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50"
          >
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setEditModal(true) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={13} className="text-gray-400" /> Editar pedido
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setCancelModal(true) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <XCircle size={13} /> Cancelar pedido
            </button>
          </div>
        )}

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

      {editModal   && <EditOrderModal   order={order} onClose={() => setEditModal(false)}   onSaved={() => {}} />}
      {cancelModal && <CancelOrderModal order={order} onClose={() => setCancelModal(false)} onCancelled={() => {}} />}
    </>
  )
}, (prev, next) => {
  const o1 = prev.order, o2 = next.order
  return (
    o1.id          === o2.id          &&
    o1.status      === o2.status      &&
    o1.driverId    === o2.driverId    &&
    o1.horaEntrega === o2.horaEntrega &&
    o1.clientName  === o2.clientName  &&
    o1.date?.seconds === o2.date?.seconds &&
    o1.products.length === o2.products.length &&
    prev.choferes  === next.choferes
  )
})

// ── KanbanColumn ──────────────────────────────────────────────────────────────

const KanbanColumn = memo(function KanbanColumn({ id, label, sublabel, orders, choferes, isBandeja }: {
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
}, (prev, next) => {
  if (prev.id !== next.id || prev.choferes !== next.choferes) return false
  if (prev.orders.length !== next.orders.length) return false
  return prev.orders.every((o, i) => {
    const n = next.orders[i]
    return o.id === n.id && o.status === n.status && o.driverId === n.driverId
  })
})

// ── Página principal ──────────────────────────────────────────────────────────

export default function LogisticaDashboard() {
  const [mainTab,      setMainTab]      = useState<'despacho' | 'pedidos' | 'mapa'>('pedidos')
  const [importModal,  setImportModal]  = useState(false)
  const [pedidoManual, setPedidoManual] = useState(false)
  const [activeId,     setActiveId]     = useState<string | null>(null)
  const [allClients,   setAllClients]   = useState<UserProfile[]>([])
  const clientsLoadedRef = useRef(false)

  const { orders,   loading: loadO } = useKanbanOrders()
  const { choferes, loading: loadC } = useChoferes()
  const loading = loadO || loadC

  // Cargar clientes al abrir el tab mapa o despacho (una sola vez)
  useEffect(() => {
    if (!['mapa', 'despacho'].includes(mainTab) || clientsLoadedRef.current) return
    const load = async () => {
      const { getClientesActivos } = await import('../../services/userService')
      const data = await getClientesActivos()
      setAllClients(data)
      clientsLoadedRef.current = true
    }
    load()
  }, [mainTab])

  const sensors = useSensors(
    useSensor(MouseSensor,  { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const columns  = useMemo(() => buildColumns(), [])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return d
  }), [])
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
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const currentCol = getOrderColumn(order, dayIds)
    if (currentCol === targetCol) return
    if (targetCol === 'bandeja') {
      await moveOrderToBandeja(orderId)
    } else {
      await moveOrderDate(orderId, targetCol)
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

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#F1EFE8] text-gray-900">
      <Navbar />

      {/* Header + Tabs (altura fija) */}
      <div className="px-4 pt-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 mb-3 max-w-full">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Tablero</h1>
            <p className="text-xs text-gray-500 capitalize">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          {mainTab === 'pedidos' && (
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
          )}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="bg-white border border-[#D3D1C7] rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-gray-900">{kpis.total}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Hoy</p>
          </div>
          <div className={`border rounded-xl px-3 py-2 text-center ${kpis.sinAsignar > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#D3D1C7]'}`}>
            <p className={`text-lg font-bold ${kpis.sinAsignar > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{kpis.sinAsignar}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Sin asignar</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-accent">{kpis.enCamino}</p>
            <p className="text-[10px] text-gray-500 leading-tight">En camino</p>
          </div>
          <div className="bg-white border border-[#D3D1C7] rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-green-600">{kpis.entregados}</p>
            <p className="text-[10px] text-gray-500 leading-tight">Entregados</p>
          </div>
        </div>

        <div className="flex border-b border-gray-200 gap-1">
          {(['pedidos', 'despacho', 'mapa'] as const).map((t) => (
            <button key={t} onClick={() => setMainTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mainTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}>
              {t === 'despacho' ? 'Despacho' : t === 'pedidos' ? 'Pedidos' : 'Mapa'}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido (ocupa el resto de la pantalla) */}
      <div className={`flex-1 min-h-0 ${mainTab === 'mapa' || mainTab === 'despacho' ? 'overflow-hidden' : 'overflow-y-auto px-4 pb-6 pt-4'}`}>


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
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
        ))}
      </div>

      <ImportarPedidoModal open={importModal}  onClose={() => setImportModal(false)} />
      <PedidoManualModal   open={pedidoManual} onClose={() => setPedidoManual(false)} defaultDate={todayStr} />
    </div>
  )
}
