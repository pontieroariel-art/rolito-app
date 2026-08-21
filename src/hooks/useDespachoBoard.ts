import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { DragStartEvent, DragEndEvent, MouseSensor, TouchSensor, useSensors, useSensor, PointerSensor } from '@dnd-kit/core'
import { Order, OrderProduct, UserProfile, Despacho, ProgramaVisita, VisitaPuntual, Camion, getPrimaryAddress, PLANTAS, PlantaId } from '../types'
import { useCatalogo } from './useCatalogo'
import { useAuth } from '../context/AuthContext'
import { useZonasProhibidas } from './useZonas'
import {
  despachoId, saveDespacho, updateDespacho, subscribeDespachosByFecha,
  optimizeStopOrder, formatDespachoFecha, todayStr,
  moveItemAtomic, transferItemsAtomic,
} from '../services/despachoService'
import { updateOrdersStatusBatch } from '../services/orderService'
import { useProgramasVisita, useVisitasPuntuales, visitasParaFecha, programasParaFecha } from './useVisitas'
import { getPushSubscriptionByEmail } from '../services/userService'
import { sendPush } from '../services/notificationService'
import { subscribeCamiones } from '../services/flotaService'
import { subscribeAsignacionesDia, setAsignacionChofer, AsignacionChofer, AsignacionesDia } from '../services/asignacionesDiaService'

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
  vuelta:   number          // vuelta del despacho a la que pertenece (1 si no tiene)
  products?: OrderProduct[] // solo para kind === 'order'
  numeroOC?:             string // solo para kind === 'order'
  reprogramado?:         boolean
  motivoReprogramacion?: string
}

function itemsFromOrder(o: Order): DayItem {
  return {
    kind: 'order', dndId: `o:${o.id}`, id: o.id, clientId: o.clientId, label: o.clientName, sublabel: o.clientAddress,
    driverId: o.driverId, vuelta: o.vuelta ?? 1, products: o.products, numeroOC: o.numeroOC,
    reprogramado: o.reprogramado, motivoReprogramacion: o.motivoReprogramacion,
  }
}
function itemsFromVisita(v: VisitaPuntual): DayItem {
  return { kind: 'visita', dndId: `v:${v.id}`, id: v.id, clientId: v.clientId, label: v.clientName, sublabel: v.clientAddress, driverId: v.driverId, vuelta: v.vuelta ?? 1 }
}
function itemsFromPrograma(p: ProgramaVisita): DayItem {
  return { kind: 'programa', dndId: `p:${p.id}`, id: p.id, clientId: p.clientId, label: p.clientName, sublabel: p.clientAddress, driverId: p.driverId, vuelta: p.vuelta ?? 1 }
}

function parseDndId(dndId: string): { kind: ItemKind; id: string } {
  const [prefix, ...rest] = dndId.split(':')
  const id = rest.join(':')
  const kind: ItemKind = prefix === 'o' ? 'order' : prefix === 'v' ? 'visita' : 'programa'
  return { kind, id }
}

// ── Slots (chofer + vuelta) ──────────────────────────────────────────────────
// Cada columna de camión puede tener más de un despacho el mismo día ("vuelta
// 2" — el camión vuelve a planta y carga de nuevo). Puertas adentro del
// tablero, cada combinación chofer+vuelta se identifica con un "slot": para
// la vuelta 1 el slot es directamente el email del chofer (idéntico al
// comportamiento histórico, sin cambios visibles si nadie usa vueltas
// extra); de la vuelta 2 en adelante el slot suma un sufijo `#N`.
export function slotKey(driverEmail: string, vuelta = 1): string {
  return vuelta > 1 ? `${driverEmail}#${vuelta}` : driverEmail
}

export function parseSlotKey(slot: string): { email: string; vuelta: number } {
  const i = slot.indexOf('#')
  if (i === -1) return { email: slot, vuelta: 1 }
  return { email: slot.slice(0, i), vuelta: Number(slot.slice(i + 1)) || 1 }
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
  // Todos los Record<string, ...> de acá para abajo están keyeados por "slot"
  // (ver slotKey/parseSlotKey): el email del chofer para su vuelta 1, o
  // `email#N` para la vuelta N — no por email de chofer a secas.
  vueltasByDriver:    Record<string, number[]>
  handleAddVuelta:    (driverEmail: string) => void
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
  handlePlantaChange:     (slot: string, p: PlantaId) => void
  handleHoraSalidaChange: (slot: string, h: string) => void
  handleConfirmClick:     (slot: string) => void
  handleReopen:           (slot: string) => Promise<void>
  handleTransferClick:    (slot: string) => void
  handleManualReorder:    (slot: string, newOrderIds: string[]) => Promise<void>
  handleRecalculate:      (slot: string) => void
  sensors:            ReturnType<typeof useSensors>
  handleDragStart:    (e: DragStartEvent) => void
  handleDragEnd:      (e: DragEndEvent) => Promise<void>
  activeItem:         DayItem | null | undefined
  confirmingDriver:   string | null
  setConfirmingDriver: (slot: string | null) => void
  confirmLoading:     boolean
  confirmingChofer:   UserProfile | null | undefined
  confirmingItems:    DayItem[]
  handleConfirm:      (slot: string) => Promise<void>
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
  // En vivo (onSnapshot): si otro admin cambia el camión/ayudante de un
  // chofer con el tablero abierto el mismo día, se refleja acá sin recargar.
  const [asignacionesDia, setAsignacionesDia] = useState<AsignacionesDia>({})
  useEffect(() => subscribeAsignacionesDia(fecha, setAsignacionesDia), [fecha])

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
    despachos.forEach((d) => { m[slotKey(d.driverId, d.vuelta ?? 1)] = d })
    return m
  }, [despachos])

  // ── Vueltas abiertas por chofer ────────────────────────────────────────────
  // Vuelta 2+ que el admin abrió a mano esta sesión ("+ Agregar vuelta") pero
  // todavía no tiene despacho guardado (recién se crea al confirmar, como la
  // vuelta 1 hoy). Se resetea al cambiar de día.
  const [openVueltas, setOpenVueltas] = useState<Record<string, number>>({})
  useEffect(() => { setOpenVueltas({}) }, [fecha])

  const handleAddVuelta = useCallback((driverEmail: string) => {
    setOpenVueltas((prev) => ({ ...prev, [driverEmail]: (prev[driverEmail] ?? 1) + 1 }))
  }, [])

  // Vueltas visibles por chofer: unión de lo abierto a mano, lo que ya tiene
  // despacho guardado, y lo que ya viene asignado en algún pedido/visita
  // (para que una vuelta 2 en borrador sobreviva a un refresh de página, aun
  // sin despacho todavía confirmado).
  const vueltasByDriver = useMemo(() => {
    const m: Record<string, number[]> = {}
    choferesPrincipales.forEach((c) => {
      const fromDespachos = despachos.filter((d) => d.driverId === c.email).map((d) => d.vuelta ?? 1)
      const fromItems     = allItems.filter((i) => i.driverId === c.email).map((i) => i.vuelta)
      const maxVuelta = Math.max(1, openVueltas[c.email] ?? 1, ...fromDespachos, ...fromItems, 0)
      m[c.email] = Array.from({ length: maxVuelta }, (_, i) => i + 1)
    })
    return m
  }, [choferesPrincipales, despachos, allItems, openVueltas])

  // ── DnD activeId — declarado aquí para que el effect de asignaciones pueda usarlo ──
  const [activeId, setActiveId] = useState<string | null>(null)

  // ── Asignaciones locales ──────────────────────────────────────────────────
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  useEffect(() => {
    if (activeId) return  // no resetear mientras hay un drag activo
    const m: Record<string, string> = {}
    allItems.forEach((item) => { m[item.dndId] = item.driverId ? slotKey(item.driverId, item.vuelta) : 'sin_asignar' })
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
      const slot = slotKey(d.driverId, d.vuelta ?? 1)
      if (d.plantaId)   setPlantaByDriver((p)    => ({ ...p, [slot]: d.plantaId! }))
      if (d.horaSalida) setHoraSalidaByDriver((p) => ({ ...p, [slot]: d.horaSalida! }))
    })
  }, [despachos])

  // ── Estado de rutas ───────────────────────────────────────────────────────
  const [routeOrder,    setRouteOrder]    = useState<Record<string, string[]>>({})
  const [routeArrivals, setRouteArrivals] = useState<Record<string, Record<string, string>>>({})
  const [recalculating, setRecalculating] = useState<Record<string, boolean>>({})
  const [orsStatus,     setOrsStatus]     = useState<Record<string, { ok: boolean; error?: string }>>({})
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => () => {
    Object.values(debounceRefs.current).forEach(clearTimeout)
    debounceRefs.current = {}
  }, [fecha])

  // Choferes con orden reordenado a mano — se congela el recálculo automático
  // hasta que el usuario pida explícitamente "Recalcular ruta automática"
  const [manualOrder, setManualOrder] = useState<Record<string, boolean>>({})
  useEffect(() => { setManualOrder({}) }, [fecha])

  const handleManualReorder = useCallback(async (slot: string, newOrderIds: string[]) => {
    clearTimeout(debounceRefs.current[slot])
    setManualOrder((prev) => ({ ...prev, [slot]: true }))
    setRouteOrder((prev) => ({ ...prev, [slot]: newOrderIds }))
    // Los horarios de llegada estimados quedaban calculados para el orden
    // anterior — se limpian para no mostrar un dato que ya no es correcto.
    setRouteArrivals((prev) => ({ ...prev, [slot]: {} }))

    const desp = despachoByDriver[slot]
    if (desp) {
      const { email, vuelta } = parseSlotKey(slot)
      await updateDespacho(despachoId(fecha, email, vuelta), (current) => ({
        orderIds: newOrderIds,
        ...(current.status === 'confirmado' ? { modifiedAfterConfirm: true } : {}),
      }))
    }
  }, [despachoByDriver, fecha])

  const scheduleRecalc = useCallback((slot: string, dndIds: string[]) => {
    clearTimeout(debounceRefs.current[slot])
    setRecalculating((prev) => ({ ...prev, [slot]: true }))

    debounceRefs.current[slot] = setTimeout(async () => {
      if (dndIds.length === 0) {
        setRecalculating((prev) => ({ ...prev, [slot]: false }))
        setRouteOrder((prev) => ({ ...prev, [slot]: [] }))
        return
      }

      const coords: Record<string, { lat: number; lng: number }> = {}
      dndIds.forEach((dndId) => {
        const item = allItems.find((i) => i.dndId === dndId)
        if (!item) return
        const c = coordsByClientId[item.clientId]
        if (c) coords[dndId] = c
      })

      const plantaId = plantaByDriver[slot] ?? PLANTA_DEFAULT
      const planta   = PLANTAS[plantaId]
      const departure = horaSalidaByDriver[slot] ?? '07:00'
      const zonasActivas = zonas.filter((z) => z.activa)

      const { orderedIds, arrivals, orsOk, orsError } = await optimizeStopOrder({
        stopIds: dndIds, coords,
        fecha, departure, planta,
        zonasProhibidas: zonasActivas,
      })

      setRouteOrder((prev)    => ({ ...prev, [slot]: orderedIds }))
      setRouteArrivals((prev) => ({ ...prev, [slot]: arrivals }))
      setOrsStatus((prev)     => ({ ...prev, [slot]: { ok: orsOk, error: orsError } }))
      setRecalculating((prev) => ({ ...prev, [slot]: false }))

      const desp = despachoByDriver[slot]
      if (desp) {
        const { email, vuelta } = parseSlotKey(slot)
        await updateDespacho(despachoId(fecha, email, vuelta), (current) => ({
          orderIds: orderedIds,
          ...(current.status === 'confirmado' ? { modifiedAfterConfirm: true } : {}),
        }))
      }
    }, 1500)
  }, [allItems, coordsByClientId, zonas, fecha, despachoByDriver, plantaByDriver, horaSalidaByDriver])

  const handleRecalculate = useCallback((slot: string) => {
    setManualOrder((prev) => { const n = { ...prev }; delete n[slot]; return n })
    const ids = Object.entries(assignments).filter(([, s]) => s === slot).map(([id]) => id)
    scheduleRecalc(slot, ids)
  }, [assignments, scheduleRecalc])

  // Referencias estables (useCallback) para que CamionColumn — envuelto en
  // React.memo — pueda saltear el re-render de columnas no relacionadas ante
  // cualquier cambio de estado del tablero (ej. activeId durante un drag).
  const handlePlantaChange = useCallback((slot: string, p: PlantaId) => {
    setPlantaByDriver((prev) => ({ ...prev, [slot]: p }))
    const ids = Object.entries(assignments).filter(([, s]) => s === slot).map(([id]) => id)
    scheduleRecalc(slot, ids)
  }, [assignments, scheduleRecalc])

  const handleHoraSalidaChange = useCallback((slot: string, h: string) => {
    setHoraSalidaByDriver((prev) => ({ ...prev, [slot]: h }))
    const ids = Object.entries(assignments).filter(([, s]) => s === slot).map(([id]) => id)
    scheduleRecalc(slot, ids)
  }, [assignments, scheduleRecalc])

  // Detectar cambios en asignaciones y disparar recalc — salvo en slots
  // (chofer+vuelta) con orden manual, para no pisar un reordenamiento hecho a mano
  const prevAssignments = useRef<Record<string, string>>({})
  useEffect(() => {
    const affected = new Set<string>()
    Object.entries(assignments).forEach(([dndId, slot]) => {
      if (prevAssignments.current[dndId] !== slot) {
        if (prevAssignments.current[dndId] && prevAssignments.current[dndId] !== 'sin_asignar')
          affected.add(prevAssignments.current[dndId])
        if (slot !== 'sin_asignar') affected.add(slot)
      }
    })
    prevAssignments.current = { ...assignments }
    affected.forEach((slot) => {
      if (manualOrder[slot]) return
      const ids = Object.entries(assignments).filter(([, s]) => s === slot).map(([id]) => id)
      scheduleRecalc(slot, ids)
    })
  }, [assignments, scheduleRecalc, manualOrder])

  // Recalc inicial al cambiar de día — salvo en despachos ya confirmados: antes
  // esto se disparaba para TODOS los choferes con ítems asignados cada vez que
  // se abría la pestaña o cambiaba el día, sobreescribiendo en Firestore el
  // orden ya confirmado y marcando "modifiedAfterConfirm" sin que nadie
  // hubiera tocado nada. Recorre TODAS las vueltas abiertas de cada chofer,
  // no solo la 1.
  useEffect(() => {
    const t = setTimeout(() => {
      choferesPrincipales.forEach((c) => {
        (vueltasByDriver[c.email] ?? [1]).forEach((vuelta) => {
          const slot = slotKey(c.email, vuelta)
          if (despachoByDriver[slot]?.status === 'confirmado') return
          const ids = allItems.filter((i) => i.driverId === c.email && i.vuelta === vuelta).map((i) => i.dndId)
          if (ids.length > 0) scheduleRecalc(slot, ids)
        })
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
    const fromP = from !== 'sin_asignar' ? parseSlotKey(from) : null
    const toP   = to   !== 'sin_asignar' ? parseSlotKey(to)   : null
    try {
      // El movimiento del ítem + la actualización del despacho de origen (y el
      // flag del destino) se hacen en una única transacción atómica, que lee los
      // despachos frescos del servidor y decide por su status confirmado.
      await moveItemAtomic({
        fecha, dndId,
        item: { kind, id },
        from: fromP ? fromP.email : 'sin_asignar',
        to:   toP   ? toP.email   : 'sin_asignar',
        fromVuelta: fromP?.vuelta ?? 1,
        toVuelta:   toP?.vuelta   ?? 1,
        flagModifiedTo: flagModified,
      })
    } catch (err) {
      // Sin este catch, si la transacción fallaba (permisos, red) la tarjeta
      // quedaba movida visualmente hasta que algún cambio no relacionado en
      // allItems forzara un reset — acá se revierte de inmediato.
      console.error('No se pudo mover la parada:', err)
      setAssignments((prev) => ({ ...prev, [dndId]: from }))
    }
  }, [fecha])

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
  // `fromDriver` guarda un slot (chofer o chofer#vuelta) — el nombre del
  // campo se mantiene por compatibilidad con el resto del componente.
  const [transferModal, setTransferModal] = useState<{ fromDriver: string } | null>(null)
  const handleTransferClick = useCallback((slot: string) => setTransferModal({ fromDriver: slot }), [])

  const handleTransfer = useCallback(async (selectedDndIds: string[], toDriver: string, motivo: string) => {
    const fromSlot = transferModal?.fromDriver
    if (!fromSlot) return
    const { email: fromDriver, vuelta: fromVuelta } = parseSlotKey(fromSlot)

    // Reasignación de todas las paradas + limpieza del despacho de origen en una
    // sola transacción atómica (antes eran N escrituras sueltas + la del
    // despacho, sin garantía de que se aplicaran todas). Siempre transfiere a
    // la vuelta 1 del camión destino.
    const items = selectedDndIds.map((dndId) => {
      const { kind, id } = parseDndId(dndId)
      return { kind, id, dndId }
    })
    await transferItemsAtomic({ fecha, fromDriver, toDriver, motivo, items, fromVuelta, toVuelta: 1 })
    setAssignments((prev) => {
      const next = { ...prev }
      selectedDndIds.forEach((dndId) => { next[dndId] = toDriver })
      return next
    })

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
  }, [transferModal, choferes, fecha])

  // ── Confirmar despacho ────────────────────────────────────────────────────
  // `confirmingDriver` guarda un slot (chofer o chofer#vuelta) — el nombre se
  // mantiene por compatibilidad con el resto del componente.
  const [confirmingDriver, setConfirmingDriver] = useState<string | null>(null)
  const [confirmLoading,   setConfirmLoading]   = useState(false)
  const handleConfirmClick = useCallback((slot: string) => setConfirmingDriver(slot), [])

  const handleConfirm = useCallback(async (slot: string) => {
    const { email: driverEmail, vuelta } = parseSlotKey(slot)
    const chofer = choferes.find((c) => c.email === driverEmail)
    if (!chofer) return

    const driverItems = Object.entries(assignments)
      .filter(([, s]) => s === slot)
      .map(([dndId]) => dndId)
    const ordered = (routeOrder[slot]?.filter((id) => driverItems.includes(id)) ?? []).length > 0
      ? routeOrder[slot].filter((id) => driverItems.includes(id))
      : driverItems

    setConfirmLoading(true)
    try {
      const id      = despachoId(fecha, driverEmail, vuelta)
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
        plantaId:     plantaByDriver[slot]    ?? PLANTA_DEFAULT,
        horaSalida:   horaSalidaByDriver[slot] ?? '07:00',
        confirmedAt:  null, confirmedBy: user?.uid ?? null, modifiedAfterConfirm: false,
        vuelta,
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
          body: `Tenés ${ordered.length} parada${ordered.length !== 1 ? 's' : ''} asignadas para ${formatDespachoFecha(fecha)}${vuelta > 1 ? ` (vuelta ${vuelta})` : ''}.`,
        })
      } catch { /* push no crítico */ }

      setConfirmingDriver(null)
    } finally {
      setConfirmLoading(false)
    }
  }, [choferes, assignments, routeOrder, fecha, asignacionesDia, camiones, plantaByDriver, horaSalidaByDriver, user])

  const handleReopen = useCallback(async (slot: string) => {
    const desp = despachoByDriver[slot]
    if (!desp) return
    const { email, vuelta } = parseSlotKey(slot)
    await updateDespacho(despachoId(fecha, email, vuelta), () => ({ status: 'borrador', modifiedAfterConfirm: false }))
    await updateOrdersStatusBatch(
      desp.orderIds.filter((x) => x.startsWith('o:')).map((x) => x.slice(2)),
      'pendiente',
    )
  }, [despachoByDriver, fecha])

  // ── Items por columna ─────────────────────────────────────────────────────
  const itemsByDriver = useMemo(() => {
    const m: Record<string, DayItem[]> = { sin_asignar: [] }
    choferesPrincipales.forEach((c) => {
      (vueltasByDriver[c.email] ?? [1]).forEach((v) => { m[slotKey(c.email, v)] = [] })
    })
    allItems.forEach((item) => {
      const col = assignments[item.dndId] ?? (item.driverId ? slotKey(item.driverId, item.vuelta) : 'sin_asignar')
      if (m[col] !== undefined) m[col].push(item)
      else m['sin_asignar'].push(item)
    })
    return m
  }, [allItems, assignments, choferesPrincipales, vueltasByDriver])

  const activeItem = activeId ? allItems.find((i) => i.dndId === activeId) : null
  const confirmingChofer = confirmingDriver ? choferes.find((c) => c.email === parseSlotKey(confirmingDriver).email) : null
  const confirmingItems  = confirmingDriver ? (itemsByDriver[confirmingDriver] ?? []) : []

  return {
    fecha, setFecha, weekDays,
    visitas, programas,
    camiones,
    choferesPrincipales,
    asignacionesDia, handleAsignacionChange,
    vueltasByDriver, handleAddVuelta,
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
