import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  DndContext, DragOverlay, DragStartEvent, DragEndEvent,
  useDroppable, useDraggable,
  MouseSensor, TouchSensor, useSensors, useSensor,
  PointerSensor,
} from '@dnd-kit/core'
import { Truck, ChevronLeft, ChevronRight, Lock, CheckCircle, RotateCcw, Plus } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import LoadingSpinner from '../ui/LoadingSpinner'
import { Order, UserProfile, Despacho, getPrimaryAddress } from '../../types'
import {
  despachoId, saveDespacho, subscribeDespachosByFecha,
  optimizeStopOrder, formatDespachoFecha, todayStr,
} from '../../services/despachoService'
import { assignDriver } from '../../services/orderService'
import { updateOrderStatus } from '../../services/orderService'
import { getPushSubscriptionByEmail } from '../../services/userService'
import { sendPush } from '../../services/notificationService'
import { useAuth } from '../../context/AuthContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateStr(o.date.toDate())
}

function summarize(products: Order['products']): string {
  return products.map((p) => `${p.quantity}x ${p.name}`).join(', ')
}

const PLANTA = { lat: -34.484942373454, lng: -58.608981028836155 }

const COL_COLORS = [
  '#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D',
  '#C084FC', '#F97316', '#34D399', '#FB923C',
]

function choferColor(idx: number): string {
  return COL_COLORS[idx % COL_COLORS.length]
}

// ── DraggableCard ─────────────────────────────────────────────────────────────

function DraggableCard({
  order, routeNum, arrival, color, locked,
}: {
  order:    Order
  routeNum?: number
  arrival?:  string
  color?:    string
  locked?:   boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`bg-white border rounded-xl p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? 'opacity-30' : 'hover:shadow-md hover:-translate-y-0.5'
      } ${locked ? 'border-green-200' : 'border-[#D3D1C7]'}`}
      style={{ touchAction: 'none' }}
    >
      <div className="flex items-start gap-2">
        {routeNum != null && (
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold mt-0.5"
            style={{ backgroundColor: color ?? '#6b7280' }}
          >
            {routeNum}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{order.clientName}</p>
            {locked && <Lock size={10} className="text-green-500 shrink-0" />}
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">{order.clientAddress}</p>
          <p className="text-xs text-gray-600 mt-1">{summarize(order.products)}</p>
          {arrival && (
            <p className="text-[10px] text-accent font-medium mt-1">⏱ {arrival}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── GhostCard (DragOverlay) ───────────────────────────────────────────────────

function GhostCard({ order }: { order: Order }) {
  return (
    <div className="bg-white border-2 border-accent rounded-xl p-3 shadow-2xl rotate-1 w-52 space-y-1">
      <p className="text-sm font-semibold text-gray-900 leading-tight">{order.clientName}</p>
      <p className="text-xs text-gray-400 truncate">{order.clientAddress}</p>
      <p className="text-xs text-gray-600">{summarize(order.products)}</p>
    </div>
  )
}

// ── DroppableColumn ───────────────────────────────────────────────────────────

function DroppableColumn({
  id, children, className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-[120px] rounded-xl transition-colors ${
        isOver ? 'bg-accent/10 border-2 border-accent border-dashed' : ''
      } ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

// ── SinAsignarColumn ──────────────────────────────────────────────────────────

function SinAsignarColumn({ orders }: { orders: Order[] }) {
  return (
    <div className="flex flex-col w-56 shrink-0">
      <div className="bg-[#F1EFE8] border border-[#D3D1C7] rounded-t-xl px-3 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-gray-700">Sin asignar</p>
        <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {orders.length}
        </span>
      </div>
      <DroppableColumn id="sin_asignar" className="bg-[#F8F7F2] border border-t-0 border-[#D3D1C7] rounded-b-xl p-2 space-y-2">
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Todo asignado ✓</p>
        ) : (
          orders.map((o) => <DraggableCard key={o.id} order={o} />)
        )}
      </DroppableColumn>
    </div>
  )
}

// ── ChoferColumn ──────────────────────────────────────────────────────────────

function ChoferColumn({
  chofer, camionLabel, orders, routeOrder, arrivals,
  recalculating, despacho, colorIdx,
  onConfirm, onReopen,
}: {
  chofer:        UserProfile
  camionLabel:   string | null
  orders:        Order[]
  routeOrder:    string[]
  arrivals:      Record<string, string>
  recalculating: boolean
  despacho?:     Despacho
  colorIdx:      number
  onConfirm:     () => void
  onReopen:      () => void
}) {
  const confirmed = despacho?.status === 'confirmado'
  const color = choferColor(colorIdx)
  const nombre = chofer.nombreContacto || chofer.nombre || chofer.email

  const sortedOrders = useMemo(() => {
    if (routeOrder.length === 0) return orders
    const idx: Record<string, number> = {}
    routeOrder.forEach((id, i) => { idx[id] = i })
    return [...orders].sort((a, b) => (idx[a.id] ?? 999) - (idx[b.id] ?? 999))
  }, [orders, routeOrder])

  return (
    <div className="flex flex-col w-56 shrink-0">
      {/* Header */}
      <div
        className={`border rounded-t-xl px-3 py-2.5 ${
          confirmed
            ? 'bg-green-50 border-green-300'
            : 'bg-white border-[#D3D1C7]'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Truck size={14} style={{ color }} className="shrink-0" />
          <p className="text-sm font-semibold text-gray-900 truncate flex-1">{nombre}</p>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white shrink-0"
            style={{ backgroundColor: color }}
          >
            {orders.length}
          </span>
        </div>
        {camionLabel && (
          <p className="text-[10px] text-gray-400 truncate">{camionLabel}</p>
        )}
        {/* Estado ruta */}
        <div className="mt-1.5 flex items-center gap-1.5">
          {recalculating ? (
            <>
              <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-[10px] text-gray-400">Recalculando ruta...</span>
            </>
          ) : confirmed ? (
            <>
              <CheckCircle size={11} className="text-green-500 shrink-0" />
              <span className="text-[10px] text-green-600 font-medium">
                DESPACHADO{despacho?.modifiedAfterConfirm ? ' (+cambios)' : ''}
              </span>
            </>
          ) : routeOrder.length > 0 ? (
            <>
              <CheckCircle size={11} className="text-accent shrink-0" />
              <span className="text-[10px] text-accent">Ruta optimizada</span>
            </>
          ) : orders.length > 0 ? (
            <span className="text-[10px] text-gray-400">Esperando optimización...</span>
          ) : null}
        </div>
      </div>

      {/* Cards */}
      <DroppableColumn
        id={chofer.email}
        className={`border border-t-0 p-2 space-y-2 flex-1 ${
          confirmed ? 'bg-green-50/50 border-green-200' : 'bg-white border-[#D3D1C7]'
        }`}
      >
        {sortedOrders.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Arrastrar pedidos acá</p>
        ) : (
          sortedOrders.map((o, i) => (
            <DraggableCard
              key={o.id}
              order={o}
              routeNum={routeOrder.includes(o.id) ? routeOrder.indexOf(o.id) + 1 : i + 1}
              arrival={arrivals[o.id]}
              color={color}
              locked={confirmed}
            />
          ))
        )}
      </DroppableColumn>

      {/* Footer action */}
      <div
        className={`border border-t-0 rounded-b-xl px-2 py-2 ${
          confirmed ? 'bg-green-50 border-green-200' : 'bg-white border-[#D3D1C7]'
        }`}
      >
        {confirmed ? (
          <button
            onClick={onReopen}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 py-1 transition-colors"
          >
            <RotateCcw size={11} /> Reabrir despacho
          </button>
        ) : (
          <button
            onClick={onConfirm}
            disabled={orders.length === 0}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-accent text-white rounded-lg py-2 hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Lock size={11} /> Confirmar despacho
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  orders:     Order[]
  choferes:   UserProfile[]
  allClients: UserProfile[]
  loading:    boolean
}

export default function DespachoBoard({ orders, choferes, allClients, loading }: Props) {
  const { user } = useAuth()

  // ── Fecha seleccionada ────────────────────────────────────────────────────
  const [fecha, setFecha] = useState(todayStr())

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return dateStr(d)
  }), [])

  // ── Despachos del día (Firestore real-time) ───────────────────────────────
  const [despachos, setDespachos] = useState<Despacho[]>([])
  useEffect(() => {
    return subscribeDespachosByFecha(fecha, setDespachos)
  }, [fecha])

  const despachoByDriver = useMemo(() => {
    const m: Record<string, Despacho> = {}
    despachos.forEach((d) => { m[d.driverId] = d })
    return m
  }, [despachos])

  // ── Pedidos del día ───────────────────────────────────────────────────────
  const dayOrders = useMemo(() =>
    orders.filter((o) =>
      orderDateStr(o) === fecha &&
      !['entregado', 'cancelado'].includes(o.status),
    ),
  [orders, fecha])

  // ── Asignaciones locales (driverId por pedido) ────────────────────────────
  // Se inicializan desde Firestore y se actualizan optimísticamente al arrastrar
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  useEffect(() => {
    const m: Record<string, string> = {}
    dayOrders.forEach((o) => { m[o.id] = o.driverId || 'sin_asignar' })
    setAssignments(m)
  }, [dayOrders])

  // ── Coordenadas de clientes (para ORS) ───────────────────────────────────
  const coordsByClientId = useMemo(() => {
    const m: Record<string, { lat: number; lng: number }> = {}
    allClients.forEach((c) => {
      const addr = getPrimaryAddress(c) ?? null
      const lat  = addr?.lat ?? c.lat
      const lng  = addr?.lng ?? c.lng
      if (lat && lng) m[c.uid] = { lat, lng }
    })
    return m
  }, [allClients])

  // ── Estado de rutas ───────────────────────────────────────────────────────
  const [routeOrder,    setRouteOrder]    = useState<Record<string, string[]>>({})
  const [routeArrivals, setRouteArrivals] = useState<Record<string, Record<string, string>>>({})
  const [recalculating, setRecalculating] = useState<Record<string, boolean>>({})

  // Debounce timers por chofer
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const scheduleRecalc = useCallback((driverEmail: string, orderIds: string[]) => {
    clearTimeout(debounceRefs.current[driverEmail])
    setRecalculating((prev) => ({ ...prev, [driverEmail]: true }))
    debounceRefs.current[driverEmail] = setTimeout(async () => {
      if (orderIds.length === 0) {
        setRecalculating((prev) => ({ ...prev, [driverEmail]: false }))
        setRouteOrder((prev)    => ({ ...prev, [driverEmail]: [] }))
        return
      }
      const orsKey = import.meta.env.VITE_ORS_KEY
      if (!orsKey) {
        setRecalculating((prev) => ({ ...prev, [driverEmail]: false }))
        return
      }

      // Mapear orderId → clientId → coords
      const stopIds  = orderIds
      const coords: Record<string, { lat: number; lng: number }> = {}
      const openTimes:  Record<string, string> = {}
      const closeTimes: Record<string, string> = {}

      stopIds.forEach((oid) => {
        const order = orders.find((o) => o.id === oid)
        if (!order) return
        const clientCoords = coordsByClientId[order.clientId]
        if (clientCoords) coords[oid] = clientCoords
        const client = allClients.find((c) => c.uid === order.clientId)
        const addr   = client ? (getPrimaryAddress(client) ?? null) : null
        if (addr?.horarioApertura) openTimes[oid]  = addr.horarioApertura
        if (addr?.horarioCierre)   closeTimes[oid] = addr.horarioCierre
      })

      const { orderedIds, arrivals } = await optimizeStopOrder({
        stopIds,
        coords,
        arrivals:   openTimes,
        closeTimes,
        fecha,
        departure:  '07:00',
        planta:     PLANTA,
        orsKey,
      })

      setRouteOrder((prev)    => ({ ...prev, [driverEmail]: orderedIds }))
      setRouteArrivals((prev) => ({ ...prev, [driverEmail]: arrivals }))
      setRecalculating((prev) => ({ ...prev, [driverEmail]: false }))

      // Persistir orden en el despacho (si existe)
      const desp = despachoByDriver[driverEmail]
      if (desp) {
        await saveDespacho({ ...desp, orderIds: orderedIds })
      }
    }, 1500)
  }, [orders, coordsByClientId, allClients, fecha, despachoByDriver])

  // Trigger recalc cuando cambia la asignación de un chofer
  const prevAssignments = useRef<Record<string, string>>({})
  useEffect(() => {
    const affected = new Set<string>()
    Object.entries(assignments).forEach(([oid, driver]) => {
      if (prevAssignments.current[oid] !== driver) {
        if (prevAssignments.current[oid] && prevAssignments.current[oid] !== 'sin_asignar')
          affected.add(prevAssignments.current[oid])
        if (driver !== 'sin_asignar')
          affected.add(driver)
      }
    })
    prevAssignments.current = { ...assignments }
    affected.forEach((driverEmail) => {
      const driverOrderIds = Object.entries(assignments)
        .filter(([, d]) => d === driverEmail)
        .map(([oid]) => oid)
      scheduleRecalc(driverEmail, driverOrderIds)
    })
  }, [assignments, scheduleRecalc])

  // ── Recalc inicial al cargar el día ──────────────────────────────────────
  useEffect(() => {
    // Pequeño delay para que coordsByClientId esté disponible
    const t = setTimeout(() => {
      choferes.forEach((c) => {
        const driverOrderIds = dayOrders
          .filter((o) => (o.driverId || 'sin_asignar') === c.email)
          .map((o) => o.id)
        if (driverOrderIds.length > 0) scheduleRecalc(c.email, driverOrderIds)
      })
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, choferes.length])

  // ── DnD ──────────────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor,   { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string)

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over) return
    const orderId    = active.id as string
    const targetCol  = over.id as string
    const currentCol = assignments[orderId] ?? 'sin_asignar'
    if (currentCol === targetCol) return

    // Si el destino es un despacho confirmado, pedir confirmación
    const targetDesp = targetCol !== 'sin_asignar' ? despachoByDriver[targetCol] : undefined
    if (targetDesp?.status === 'confirmado') {
      setPendingMove({ orderId, from: currentCol, to: targetCol })
      return
    }

    await doMove(orderId, currentCol, targetCol)
  }, [assignments, despachoByDriver])

  async function doMove(orderId: string, from: string, to: string, flagModified = false) {
    setAssignments((prev) => ({ ...prev, [orderId]: to }))
    const newDriverId = to === 'sin_asignar' ? null : to
    await assignDriver(orderId, newDriverId)

    // Si lo movemos a 'sin_asignar' desde un despacho confirmado, marcar como modificado
    if (from !== 'sin_asignar' && despachoByDriver[from]?.status === 'confirmado') {
      const desp = despachoByDriver[from]
      if (desp) {
        const newIds = desp.orderIds.filter((id) => id !== orderId)
        await saveDespacho({ ...desp, orderIds: newIds, modifiedAfterConfirm: true })
      }
    }

    if (flagModified && to !== 'sin_asignar' && despachoByDriver[to]?.status === 'confirmado') {
      const desp = despachoByDriver[to]
      if (desp) {
        await saveDespacho({ ...desp, modifiedAfterConfirm: true })
      }
    }
  }

  // ── Confirmación de mover a despacho cerrado ──────────────────────────────
  const [pendingMove, setPendingMove] = useState<{ orderId: string; from: string; to: string } | null>(null)

  // ── Confirmar despacho ────────────────────────────────────────────────────
  const [confirmingDriver, setConfirmingDriver] = useState<string | null>(null)
  const [confirmLoading,   setConfirmLoading]   = useState(false)

  async function handleConfirm(driverEmail: string) {
    const chofer   = choferes.find((c) => c.email === driverEmail)
    if (!chofer) return
    const orderIds = Object.entries(assignments)
      .filter(([, d]) => d === driverEmail)
      .map(([oid]) => oid)
    const ordered  = routeOrder[driverEmail]?.length > 0
      ? routeOrder[driverEmail].filter((id) => orderIds.includes(id))
      : orderIds

    setConfirmLoading(true)
    try {
      // 1. Guardar despacho en Firestore
      const id   = despachoId(fecha, driverEmail)
      const nombre = chofer.nombreContacto || chofer.nombre || chofer.email
      const desp: Despacho = {
        id,
        fecha,
        driverId:     driverEmail,
        driverName:   nombre,
        camionId:     chofer.camionId ?? null,
        camionLabel:  chofer.camionModelo ? `${chofer.camionPatente ?? ''} ${chofer.camionModelo}`.trim() : null,
        status:       'confirmado',
        orderIds:     ordered,
        confirmedAt:  null,
        confirmedBy:  user?.uid ?? null,
        modifiedAfterConfirm: false,
      }
      await saveDespacho(desp)

      // 2. Pasar pedidos a "confirmado"
      await Promise.all(ordered.map((oid) => updateOrderStatus(oid, 'confirmado')))

      // 3. Notificar al chofer via push
      try {
        const sub = await getPushSubscriptionByEmail(driverEmail)
        if (sub) {
          await sendPush({
            subscription: sub,
            title: '🚛 Despacho confirmado',
            body:  `Tenés ${ordered.length} pedido${ordered.length !== 1 ? 's' : ''} asignados para ${formatDespachoFecha(fecha)}. Abrí Rolito para ver tu ruta.`,
          })
        }
      } catch { /* push no crítico */ }

      setConfirmingDriver(null)
    } finally {
      setConfirmLoading(false)
    }
  }

  async function handleReopen(driverEmail: string) {
    const desp = despachoByDriver[driverEmail]
    if (!desp) return
    await saveDespacho({ ...desp, status: 'borrador', modifiedAfterConfirm: false })
    // Volver pedidos a pendiente
    await Promise.all(desp.orderIds.map((oid) => updateOrderStatus(oid, 'pendiente')))
  }

  // ── Grupos de órdenes por columna ─────────────────────────────────────────
  const ordersByDriver = useMemo(() => {
    const m: Record<string, Order[]> = { sin_asignar: [] }
    choferes.forEach((c) => { m[c.email] = [] })
    dayOrders.forEach((o) => {
      const col = assignments[o.id] ?? (o.driverId || 'sin_asignar')
      if (m[col] !== undefined) m[col].push(o)
      else m['sin_asignar'].push(o)
    })
    return m
  }, [dayOrders, assignments, choferes])

  const activeOrder = activeId ? dayOrders.find((o) => o.id === activeId) : null

  const confirmingChofer = confirmingDriver ? choferes.find((c) => c.email === confirmingDriver) : null
  const confirmingOrders = confirmingDriver
    ? (ordersByDriver[confirmingDriver] ?? [])
    : []

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner /></div>

  return (
    <div className="flex flex-col h-full">

      {/* Selector de fecha */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-100 bg-white">
        <button
          onClick={() => {
            const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() - 1)
            setFecha(dateStr(d))
          }}
          className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center hover:border-accent transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex gap-1.5 overflow-x-auto flex-1">
          {weekDays.map((d) => {
            const dt   = new Date(d + 'T12:00:00')
            const label = dt.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })
            const count = orders.filter((o) => orderDateStr(o) === d && !['entregado', 'cancelado'].includes(o.status)).length
            return (
              <button
                key={d}
                onClick={() => setFecha(d)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors relative ${
                  d === fecha
                    ? 'bg-accent text-white'
                    : 'bg-[#F1EFE8] text-gray-600 hover:bg-[#E8E6DF]'
                } ${d === todayStr() && d !== fecha ? 'ring-1 ring-accent/40' : ''}`}
              >
                {label}
                {count > 0 && (
                  <span className={`ml-1 text-[10px] font-bold ${d === fecha ? 'text-white/80' : 'text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => {
            const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + 1)
            setFecha(dateStr(d))
          }}
          className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center hover:border-accent transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Tablero */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full p-4" style={{ minWidth: 'max-content' }}>
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

            {/* Columna sin asignar */}
            <SinAsignarColumn orders={ordersByDriver['sin_asignar'] ?? []} />

            {/* Columna por chofer */}
            {choferes.map((c, idx) => (
              <ChoferColumn
                key={c.email}
                chofer={c}
                camionLabel={c.camionModelo ? `${c.camionPatente ?? ''} ${c.camionModelo}`.trim() : null}
                orders={ordersByDriver[c.email] ?? []}
                routeOrder={routeOrder[c.email] ?? []}
                arrivals={routeArrivals[c.email] ?? {}}
                recalculating={!!recalculating[c.email]}
                despacho={despachoByDriver[c.email]}
                colorIdx={idx}
                onConfirm={() => setConfirmingDriver(c.email)}
                onReopen={() => handleReopen(c.email)}
              />
            ))}

            <DragOverlay dropAnimation={null}>
              {activeOrder && <GhostCard order={activeOrder} />}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Modal confirmar despacho */}
      <Modal
        open={!!confirmingDriver}
        onClose={() => { if (!confirmLoading) setConfirmingDriver(null) }}
        title="Confirmar despacho"
        variant="light"
      >
        {confirmingChofer && (
          <div className="space-y-4">
            <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl p-4 space-y-2 text-sm">
              <p className="font-medium text-accent">
                {confirmingChofer.nombreContacto || confirmingChofer.nombre}
              </p>
              <p className="text-gray-600">
                {confirmingOrders.length} pedido{confirmingOrders.length !== 1 ? 's' : ''} para{' '}
                <span className="font-medium">{formatDespachoFecha(fecha)}</span>
              </p>
              {confirmingChofer.camionModelo && (
                <p className="text-gray-500 text-xs">
                  🚛 {confirmingChofer.camionPatente} — {confirmingChofer.camionModelo}
                </p>
              )}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Al confirmar, los pedidos pasan a estado "Confirmado" y se envía una notificación push al chofer.
            </div>
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {(routeOrder[confirmingDriver!]?.length > 0
                ? routeOrder[confirmingDriver!]
                    .map((id) => confirmingOrders.find((o) => o.id === id))
                    .filter(Boolean) as Order[]
                : confirmingOrders
              ).map((o, i) => (
                <li key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: choferColor(choferes.findIndex((c) => c.email === confirmingDriver)) }}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{o.clientName}</span>
                  <span className="text-xs text-gray-400 truncate">{o.clientAddress}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmingDriver(null)} className="flex-1 text-sm" disabled={confirmLoading}>
                Cancelar
              </Button>
              <Button onClick={() => handleConfirm(confirmingDriver!)} loading={confirmLoading} className="flex-1 text-sm">
                Confirmar y notificar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal confirmar mover a despacho cerrado */}
      <Modal
        open={!!pendingMove}
        onClose={() => setPendingMove(null)}
        title="Despacho ya confirmado"
        variant="light"
      >
        {pendingMove && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Este chofer ya tiene su despacho confirmado. ¿Querés agregar este pedido de todas formas?
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPendingMove(null)} className="flex-1 text-sm">Cancelar</Button>
              <Button
                onClick={async () => {
                  if (!pendingMove) return
                  await doMove(pendingMove.orderId, pendingMove.from, pendingMove.to, true)
                  setPendingMove(null)
                }}
                className="flex-1 text-sm"
              >
                Agregar igual
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
