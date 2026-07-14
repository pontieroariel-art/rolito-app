import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { DragStartEvent, DragEndEvent, MouseSensor, TouchSensor, useSensors, useSensor, PointerSensor } from '@dnd-kit/core'
import { Order, OrderProduct, UserProfile, Despacho, ProgramaVisita, VisitaPuntual, Camion, getPrimaryAddress, PLANTAS, PlantaId } from '../types'
import { useCatalogo } from './useCatalogo'
import { useAuth } from '../context/AuthContext'
import { useZonasProhibidas } from './useZonas'
import {
  despachoId, saveDespacho, updateDespacho, subscribeDespachosByFecha,
  optimizeStopOrder, formatDespachoFecha, todayStr,
} from '../services/despachoService'
import { assignDriver, updateOrdersStatusBatch, reassignOrder } from '../services/orderService'
import { updateVisitaPuntual, updatePrograma } from '../services/visitasService'
import { useProgramasVisita, useVisitasPuntuales, visitasParaFecha, programasParaFecha } from './useVisitas'
import { getPushSubscriptionByEmail } from '../services/userService'
import { sendPush } from '../services/notificationService'
import { subscribeCamiones } from '../services/flotaService'
import { getAsignacionesDia, setAsignacionChofer, AsignacionChofer, AsignacionesDia } from '../services/asignacionesDiaService'

// Orquestación completa del tablero de despacho diario (estado, suscripciones
// a Firestore, drag & drop, recálculo de rutas, confirmación/reapertura y
// transferencia de paradas) — separada del árbol de render de DespachoBoard.tsx.

// ── Tipos unificados ──────────────────────────────────────────────────────────

export type ItemKind = 'order' | 'visita' | 'programa'

export interface DayItem {
  kind:     ItemKind
  dndId:    string          // 'o:{id}' | 'v:{id}' | 'p:{id}'
  id:       string
  clientId: string
  label:    string
  sublabel: string
  driverId: string | null
  products?: OrderProduct[] // solo para kind === 'order'
}

function itemsFromOrder(o: Order): DayItem {
  return { kind: 'order', dndId: `o:${o.id}`, id: o.id, clientId: o.clientId, label: o.clientName, sublabel: o.clientAddress, driverId: o.driverId, products: o.products }
}
function itemsFromVisita(v: VisitaPuntual): DayItem {
  return { kind: 'visita', dndId: `v:${v.id}`, id: v.id, clientId: v.clientId, label: v.clientName, sublabel: v.clientAddress, driverId: v.driverId }
}
function itemsFromPrograma(p: ProgramaVisita): DayItem {
  return { kind: 'programa', dndId: `p:${p.id}`, id: p.id, clientId: p.clientId, label: p.clientName, sublabel: p.clientAddress, driverId: p.driverId }
}

function parseDndId(dndId: string): { kind: ItemKind; id: string } {
  const [prefix, ...rest] = dndId.split(':')
  const id = rest.join(':')
  const kind: ItemKind = prefix === 'o' ? 'order' : prefix === 'v' ? 'visita' : 'programa'
  return { kind, id }
}

// ── Helpers de fecha (también usados por el render de DespachoBoard.tsx) ────

export function dateStr(d: Date): string { return d.toISOString().split('T')[0] }

export function orderDateStr(o: Order): string {
  if (!o.date?.toDate) return ''
  return dateStr(o.date.toDate())
}

// PLANTA default (Torcuato) — se puede sobrescribir por despacho
export const PLANTA_DEFAULT: PlantaId = 'torcuato'

export interface DespachoBoardState {
  fecha:              string
  setFecha:           (f: string) => void
  weekDays:           string[]
  visitas:            VisitaPuntual[]
  programas:          ProgramaVisita[]
  camiones:           Camion[]
  choferesPrincipales: UserProfile[]
  asignacionesDia:    AsignacionesDia
  handleAsignacionChange: (choferEmail: string, patch: Partial<AsignacionChofer>) => Promise<void>
  despachoByDriver:   Record<string, Despacho>
  itemsByDriver:      Record<string, DayItem[]>
  routeOrder:         Record<string, string[]>
  routeArrivals:      Record<string, Record<string, string>>
  recalculating:      Record<string, boolean>
  orsStatus:          Record<string, { ok: boolean; error?: string }>
  plantaByDriver:     Record<string, PlantaId>
  horaSalidaByDriver: Record<string, string>
  catalogo:           ReturnType<typeof useCatalogo>['catalogo']
  manualOrder:        Record<string, boolean>
  handlePlantaChange:     (driverEmail: string, p: PlantaId) => void
  handleHoraSalidaChange: (driverEmail: string, h: string) => void
  handleConfirmClick:     (email: string) => void
  handleReopen:           (driverEmail: string) => Promise<void>
  handleTransferClick:    (email: string) => void
  handleManualReorder:    (driverEmail: string, newOrderIds: string[]) => Promise<void>
  handleRecalculate:      (driverEmail: string) => void
  sensors:            ReturnType<typeof useSensors>
  handleDragStart:    (e: DragStartEvent) => void
  handleDragEnd:      (e: DragEndEvent) => Promise<void>
  activeItem:         DayItem | null | undefined
  confirmingDriver:   string | null
  setConfirmingDriver: (email: string | null) => void
  confirmLoading:     boolean
  confirmingChofer:   UserProfile | null | undefined
  confirmingItems:    DayItem[]
  handleConfirm:      (driverEmail: string) => Promise<void>
  transferModal:      { fromDriver: string } | null
  setTransferModal:   (m: { fromDriver: string } | null) => void
  handleTransfer:     (selectedDndIds: string[], toDriver: string, motivo: string) => Promise<void>
  pendingMove:        { dndId: string; from: string; to: string } | null
  setPendingMove:     (m: { dndId: string; from: string; to: string } | null) => void
  doMove:             (dndId: string, from: string, to: string, flagModified?: boolean) => Promise<void>
}

export function useDespachoBoard(orders: Order[], choferes: UserProfile[], allClients: UserProfile[]): DespachoBoardState {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()

  // ── Camiones ──────────────────────────────────────────────────────────────
  const [camiones, setCamiones] = useState<Camion[]>([])
  useEffect(() => subscribeCamiones(setCamiones), [])

  // ── Zonas prohibidas (avoid_polygons para ORS Directions) ────────────────
  const { zonas } = useZonasProhibidas()

  // ── Fecha ─────────────────────────────────────────────────────────────────
  const [fecha, setFecha] = useState(todayStr())

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return dateStr(d)
  }), [])

  // ── Visitas del día ───────────────────────────────────────────────────────
  const { programas } = useProgramasVisita()
  const { visitas }   = useVisitasPuntuales()

  const fechaDate = useMemo(() => new Date(fecha + 'T12:00:00'), [fecha])

  const visitasHoy   = useMemo(() => visitasParaFecha(visitas, fechaDate),   [visitas, fechaDate])
  const programasHoy = useMemo(() => programasParaFecha(programas, fechaDate), [programas, fechaDate])

  // ── Pedidos del día ───────────────────────────────────────────────────────
  const dayOrders = useMemo(() =>
    orders.filter((o) => orderDateStr(o) === fecha && !['entregado', 'cancelado'].includes(o.status)),
  [orders, fecha])

  // ── Items unificados ──────────────────────────────────────────────────────
  const allItems: DayItem[] = useMemo(() => [
    ...dayOrders.map(itemsFromOrder),
    ...visitasHoy.map(itemsFromVisita),
    ...programasHoy.map(itemsFromPrograma),
  ], [dayOrders, visitasHoy, programasHoy])

  // ── Choferes vs ayudantes ─────────────────────────────────────────────────
  const choferesPrincipales = useMemo(() => choferes.filter((c) => c.subrol !== 'ayudante'), [choferes])
  // Ayudantes: todos los choferes — cada columna excluye al conductor propio en el render

  // ── Asignaciones del día ──────────────────────────────────────────────────
  const [asignacionesDia, setAsignacionesDia] = useState<AsignacionesDia>({})
  useEffect(() => { getAsignacionesDia(fecha).then(setAsignacionesDia) }, [fecha])

  const handleAsignacionChange = useCallback(async (choferEmail: string, patch: Partial<AsignacionChofer>) => {
    setAsignacionesDia((prev) => ({
      ...prev,
      [choferEmail]: { ...(prev[choferEmail] ?? { camionId: null, ayudanteEmail: null }), ...patch },
    }))
    await setAsignacionChofer(fecha, choferEmail, patch)
  }, [fecha])

  // ── Despachos Firestore ───────────────────────────────────────────────────
  const [despachos, setDespachos] = useState<Despacho[]>([])
  useEffect(() => subscribeDespachosByFecha(fecha, setDespachos), [fecha])

  const despachoByDriver = useMemo(() => {
    const m: Record<string, Despacho> = {}
    despachos.forEach((d) => { m[d.driverId] = d })
    return m
  }, [despachos])

  // ── DnD activeId — declarado aquí para que el effect de asignaciones pueda usarlo ──
  const [activeId, setActiveId] = useState<string | null>(null)

  // ── Asignaciones locales ──────────────────────────────────────────────────
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  useEffect(() => {
    if (activeId) return  // no resetear mientras hay un drag activo
    const m: Record<string, string> = {}
    allItems.forEach((item) => { m[item.dndId] = item.driverId || 'sin_asignar' })
    setAssignments(m)
  }, [allItems, activeId])

  // ── Coords para ORS ───────────────────────────────────────────────────────
  const coordsByClientId = useMemo(() => {
    const m: Record<string, { lat: number; lng: number }> = {}
    allClients.forEach((c) => {
      const addr = getPrimaryAddress(c)
      const lat  = addr?.lat ?? c.lat
      const lng  = addr?.lng ?? c.lng
      if (lat && lng) m[c.uid] = { lat, lng }
    })
    return m
  }, [allClients])

  // ── Planta y hora de salida por chofer ───────────────────────────────────
  const [plantaByDriver,    setPlantaByDriver]    = useState<Record<string, PlantaId>>({})
  const [horaSalidaByDriver, setHoraSalidaByDriver] = useState<Record<string, string>>({})

  // Inicializar desde los despachos ya guardados
  useEffect(() => {
    despachos.forEach((d) => {
      if (d.plantaId)   setPlantaByDriver((p)    => ({ ...p, [d.driverId]: d.plantaId! }))
      if (d.horaSalida) setHoraSalidaByDriver((p) => ({ ...p, [d.driverId]: d.horaSalida! }))
    })
  }, [despachos])

  // ── Estado de rutas ───────────────────────────────────────────────────────
  const [routeOrder,    setRouteOrder]    = useState<Record<string, string[]>>({})
  const [routeArrivals, setRouteArrivals] = useState<Record<string, Record<string, string>>>({})
  const [recalculating, setRecalculating] = useState<Record<string, boolean>>({})
  const [orsStatus,     setOrsStatus]     = useState<Record<string, { ok: boolean; error?: string }>>({})
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => { Object.values(debounceRefs.current).forEach(clearTimeout) }, [])

  // Choferes con orden reordenado a mano — se congela el recálculo automático
  // hasta que el usuario pida explícitamente "Recalcular ruta automática"
  const [manualOrder, setManualOrder] = useState<Record<string, boolean>>({})
  useEffect(() => { setManualOrder({}) }, [fecha])

  const handleManualReorder = useCallback(async (driverEmail: string, newOrderIds: string[]) => {
    clearTimeout(debounceRefs.current[driverEmail])
    setManualOrder((prev) => ({ ...prev, [driverEmail]: true }))
    setRouteOrder((prev) => ({ ...prev, [driverEmail]: newOrderIds }))
    // Los horarios de llegada estimados quedaban calculados para el orden
    // anterior — se limpian para no mostrar un dato que ya no es correcto.
    setRouteArrivals((prev) => ({ ...prev, [driverEmail]: {} }))

    const desp = despachoByDriver[driverEmail]
    if (desp) {
      await updateDespacho(despachoId(fecha, driverEmail), (current) => ({
        orderIds: newOrderIds,
        ...(current.status === 'confirmado' ? { modifiedAfterConfirm: true } : {}),
      }))
    }
  }, [despachoByDriver, fecha])

  const scheduleRecalc = useCallback((driverEmail: string, dndIds: string[]) => {
    clearTimeout(debounceRefs.current[driverEmail])
    setRecalculating((prev) => ({ ...prev, [driverEmail]: true }))

    debounceRefs.current[driverEmail] = setTimeout(async () => {
      if (dndIds.length === 0) {
        setRecalculating((prev) => ({ ...prev, [driverEmail]: false }))
        setRouteOrder((prev) => ({ ...prev, [driverEmail]: [] }))
        return
      }

      const orsKey = import.meta.env.VITE_ORS_KEY ?? ''

      const coords: Record<string, { lat: number; lng: number }> = {}
      dndIds.forEach((dndId) => {
        const item = allItems.find((i) => i.dndId === dndId)
        if (!item) return
        const c = coordsByClientId[item.clientId]
        if (c) coords[dndId] = c
      })

      const plantaId = plantaByDriver[driverEmail] ?? PLANTA_DEFAULT
      const planta   = PLANTAS[plantaId]
      const departure = horaSalidaByDriver[driverEmail] ?? '07:00'
      const zonasActivas = zonas.filter((z) => z.activa)

      const { orderedIds, arrivals, orsOk, orsError } = await optimizeStopOrder({
        stopIds: dndIds, coords,
        fecha, departure, planta, orsKey,
        zonasProhibidas: zonasActivas,
      })

      setRouteOrder((prev)    => ({ ...prev, [driverEmail]: orderedIds }))
      setRouteArrivals((prev) => ({ ...prev, [driverEmail]: arrivals }))
      setOrsStatus((prev)     => ({ ...prev, [driverEmail]: { ok: orsOk, error: orsError } }))
      setRecalculating((prev) => ({ ...prev, [driverEmail]: false }))

      const desp = despachoByDriver[driverEmail]
      if (desp) {
        await updateDespacho(despachoId(fecha, driverEmail), (current) => ({
          orderIds: orderedIds,
          ...(current.status === 'confirmado' ? { modifiedAfterConfirm: true } : {}),
        }))
      }
    }, 1500)
  }, [allItems, coordsByClientId, zonas, fecha, despachoByDriver, plantaByDriver, horaSalidaByDriver])

  const handleRecalculate = useCallback((driverEmail: string) => {
    setManualOrder((prev) => { const n = { ...prev }; delete n[driverEmail]; return n })
    const ids = Object.entries(assignments).filter(([, d]) => d === driverEmail).map(([id]) => id)
    scheduleRecalc(driverEmail, ids)
  }, [assignments, scheduleRecalc])

  // Referencias estables (useCallback) para que ChoferColumn — envuelto en
  // React.memo — pueda saltear el re-render de columnas no relacionadas ante
  // cualquier cambio de estado del tablero (ej. activeId durante un drag).
  const handlePlantaChange = useCallback((driverEmail: string, p: PlantaId) => {
    setPlantaByDriver((prev) => ({ ...prev, [driverEmail]: p }))
    const ids = Object.entries(assignments).filter(([, d]) => d === driverEmail).map(([id]) => id)
    scheduleRecalc(driverEmail, ids)
  }, [assignments, scheduleRecalc])

  const handleHoraSalidaChange = useCallback((driverEmail: string, h: string) => {
    setHoraSalidaByDriver((prev) => ({ ...prev, [driverEmail]: h }))
    const ids = Object.entries(assignments).filter(([, d]) => d === driverEmail).map(([id]) => id)
    scheduleRecalc(driverEmail, ids)
  }, [assignments, scheduleRecalc])

  // Detectar cambios en asignaciones y disparar recalc — salvo en choferes
  // con orden manual, para no pisar un reordenamiento hecho a mano
  const prevAssignments = useRef<Record<string, string>>({})
  useEffect(() => {
    const affected = new Set<string>()
    Object.entries(assignments).forEach(([dndId, driver]) => {
      if (prevAssignments.current[dndId] !== driver) {
        if (prevAssignments.current[dndId] && prevAssignments.current[dndId] !== 'sin_asignar')
          affected.add(prevAssignments.current[dndId])
        if (driver !== 'sin_asignar') affected.add(driver)
      }
    })
    prevAssignments.current = { ...assignments }
    affected.forEach((email) => {
      if (manualOrder[email]) return
      const ids = Object.entries(assignments).filter(([, d]) => d === email).map(([id]) => id)
      scheduleRecalc(email, ids)
    })
  }, [assignments, scheduleRecalc, manualOrder])

  // Recalc inicial al cambiar de día
  useEffect(() => {
    const t = setTimeout(() => {
      choferesPrincipales.forEach((c) => {
        const ids = allItems.filter((i) => (i.driverId || 'sin_asignar') === c.email).map((i) => i.dndId)
        if (ids.length > 0) scheduleRecalc(c.email, ids)
      })
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, choferesPrincipales.length, allItems.length])

  // ── DnD ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor,   { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string)

  const doMove = useCallback(async (dndId: string, from: string, to: string, flagModified = false) => {
    setAssignments((prev) => ({ ...prev, [dndId]: to }))
    const { kind, id } = parseDndId(dndId)
    const newDriverId  = to === 'sin_asignar' ? null : to

    if (kind === 'order')    await assignDriver(id, newDriverId)
    else if (kind === 'visita')   await updateVisitaPuntual(id, { driverId: newDriverId })
    else if (kind === 'programa') await updatePrograma(id, { driverId: newDriverId })

    if (from !== 'sin_asignar' && despachoByDriver[from]?.status === 'confirmado') {
      await updateDespacho(despachoId(fecha, from), (current) => ({
        orderIds: current.orderIds.filter((x) => x !== dndId),
        modifiedAfterConfirm: true,
      }))
    }
    if (flagModified && to !== 'sin_asignar' && despachoByDriver[to]?.status === 'confirmado') {
      await updateDespacho(despachoId(fecha, to), () => ({ modifiedAfterConfirm: true }))
    }
  }, [despachoByDriver, fecha])

  const handleDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over) return
    const dndId    = active.id as string
    const targetCol = over.id as string
    const currentCol = assignments[dndId] ?? 'sin_asignar'
    if (currentCol === targetCol) return

    const targetDesp = targetCol !== 'sin_asignar' ? despachoByDriver[targetCol] : undefined
    if (targetDesp?.status === 'confirmado') {
      setPendingMove({ dndId, from: currentCol, to: targetCol })
      return
    }
    await doMove(dndId, currentCol, targetCol)
  }, [assignments, despachoByDriver, doMove])

  const [pendingMove, setPendingMove] = useState<{ dndId: string; from: string; to: string } | null>(null)

  // ── Transferir paradas ────────────────────────────────────────────────────
  const [transferModal, setTransferModal] = useState<{ fromDriver: string } | null>(null)
  const handleTransferClick = useCallback((email: string) => setTransferModal({ fromDriver: email }), [])

  const handleTransfer = useCallback(async (selectedDndIds: string[], toDriver: string, motivo: string) => {
    const fromDriver = transferModal?.fromDriver
    if (!fromDriver) return
    await Promise.all(selectedDndIds.map(async (dndId) => {
      const { kind, id } = parseDndId(dndId)
      if (kind === 'order') {
        await reassignOrder(id, toDriver, motivo || 'Reasignación operativa', fromDriver)
      } else if (kind === 'visita') {
        await updateVisitaPuntual(id, { driverId: toDriver })
      } else {
        await updatePrograma(id, { driverId: toDriver })
      }
      setAssignments((prev) => ({ ...prev, [dndId]: toDriver }))
    }))

    // Actualizar despacho origen (quitar ítems transferidos)
    if (despachoByDriver[fromDriver]) {
      await updateDespacho(despachoId(fecha, fromDriver), (current) => ({
        orderIds: current.orderIds.filter((x) => !selectedDndIds.includes(x)),
        modifiedAfterConfirm: true,
      }))
    }

    // Notificar al chofer receptor
    const toChofer = choferes.find((c) => c.email === toDriver)
    if (toChofer) {
      try {
        const sub = await getPushSubscriptionByEmail(toDriver)
        if (sub) await sendPush({
          subscription: sub,
          title: '🔄 Nueva asignación',
          body: `Te reasignaron ${selectedDndIds.length} parada${selectedDndIds.length !== 1 ? 's' : ''} para ${formatDespachoFecha(fecha)}.`,
        })
      } catch { /* push no crítico */ }
    }
  }, [transferModal, despachoByDriver, choferes, fecha])

  // ── Confirmar despacho ────────────────────────────────────────────────────
  const [confirmingDriver, setConfirmingDriver] = useState<string | null>(null)
  const [confirmLoading,   setConfirmLoading]   = useState(false)
  const handleConfirmClick = useCallback((email: string) => setConfirmingDriver(email), [])

  const handleConfirm = useCallback(async (driverEmail: string) => {
    const chofer = choferes.find((c) => c.email === driverEmail)
    if (!chofer) return

    const driverItems = Object.entries(assignments)
      .filter(([, d]) => d === driverEmail)
      .map(([dndId]) => dndId)
    const ordered = (routeOrder[driverEmail]?.filter((id) => driverItems.includes(id)) ?? []).length > 0
      ? routeOrder[driverEmail].filter((id) => driverItems.includes(id))
      : driverItems

    setConfirmLoading(true)
    try {
      const id      = despachoId(fecha, driverEmail)
      const nombre  = chofer.nombreContacto || chofer.nombre || chofer.email
      const asig    = asignacionesDia[driverEmail]
      const camion  = asig?.camionId ? camiones.find((cam) => cam.id === asig.camionId) : null
      const ayudante = asig?.ayudanteEmail ? choferes.find((c) => c.email === asig.ayudanteEmail) : null
      const desp: Despacho = {
        id, fecha, driverId: driverEmail, driverName: nombre,
        camionId:     camion?.id    ?? null,
        camionLabel:  camion ? `${camion.patente} — ${camion.modelo}` : null,
        ayudanteEmail: asig?.ayudanteEmail ?? null,
        ayudanteName:  ayudante ? (ayudante.nombreContacto || ayudante.nombre || ayudante.email) : null,
        status:       'confirmado', orderIds: ordered,
        plantaId:     plantaByDriver[driverEmail]    ?? PLANTA_DEFAULT,
        horaSalida:   horaSalidaByDriver[driverEmail] ?? '07:00',
        confirmedAt:  null, confirmedBy: user?.uid ?? null, modifiedAfterConfirm: false,
      }
      await saveDespacho(desp)

      // Pedidos → confirmado (visitas no cambian estado) — una sola operación
      // atómica en vez de N escrituras individuales en paralelo.
      const orderDndIds = ordered.filter((x) => x.startsWith('o:'))
      await updateOrdersStatusBatch(orderDndIds.map((x) => x.slice(2)), 'confirmado')

      // Push al chofer
      try {
        const sub = await getPushSubscriptionByEmail(driverEmail)
        if (sub) await sendPush({
          subscription: sub,
          title: '🚛 Despacho confirmado',
          body: `Tenés ${ordered.length} parada${ordered.length !== 1 ? 's' : ''} asignadas para ${formatDespachoFecha(fecha)}.`,
        })
      } catch { /* push no crítico */ }

      setConfirmingDriver(null)
    } finally {
      setConfirmLoading(false)
    }
  }, [choferes, assignments, routeOrder, fecha, asignacionesDia, camiones, plantaByDriver, horaSalidaByDriver, user])

  const handleReopen = useCallback(async (driverEmail: string) => {
    const desp = despachoByDriver[driverEmail]
    if (!desp) return
    await updateDespacho(despachoId(fecha, driverEmail), () => ({ status: 'borrador', modifiedAfterConfirm: false }))
    await updateOrdersStatusBatch(
      desp.orderIds.filter((x) => x.startsWith('o:')).map((x) => x.slice(2)),
      'pendiente',
    )
  }, [despachoByDriver, fecha])

  // ── Items por columna ─────────────────────────────────────────────────────
  const itemsByDriver = useMemo(() => {
    const m: Record<string, DayItem[]> = { sin_asignar: [] }
    choferesPrincipales.forEach((c) => { m[c.email] = [] })
    allItems.forEach((item) => {
      const col = assignments[item.dndId] ?? item.driverId ?? 'sin_asignar'
      if (m[col] !== undefined) m[col].push(item)
      else m['sin_asignar'].push(item)
    })
    return m
  }, [allItems, assignments, choferesPrincipales])

  const activeItem = activeId ? allItems.find((i) => i.dndId === activeId) : null
  const confirmingChofer = confirmingDriver ? choferes.find((c) => c.email === confirmingDriver) : null
  const confirmingItems  = confirmingDriver ? (itemsByDriver[confirmingDriver] ?? []) : []

  return {
    fecha, setFecha, weekDays,
    visitas, programas,
    camiones,
    choferesPrincipales,
    asignacionesDia, handleAsignacionChange,
    despachoByDriver,
    itemsByDriver,
    routeOrder, routeArrivals, recalculating, orsStatus,
    plantaByDriver, horaSalidaByDriver,
    catalogo,
    manualOrder,
    handlePlantaChange, handleHoraSalidaChange, handleConfirmClick, handleReopen,
    handleTransferClick, handleManualReorder, handleRecalculate,
    sensors, handleDragStart, handleDragEnd,
    activeItem,
    confirmingDriver, setConfirmingDriver, confirmLoading, confirmingChofer, confirmingItems, handleConfirm,
    transferModal, setTransferModal, handleTransfer,
    pendingMove, setPendingMove, doMove,
  }
}
