import { useState, useMemo, useEffect, useCallback, memo } from 'react'
import {
  DndContext, DragOverlay,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Truck, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Lock, CheckCircle, RotateCcw, Eye, Package, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import LoadingSpinner from '../ui/LoadingSpinner'
import { Order, CatalogProducto, UserProfile, Despacho, Camion, PLANTAS, PlantaId } from '../../types'
import { calcPallets, getCodigoCliente, buildCodigoByClientId, initials } from '../../utils/helpers'
import { resolveClientDisplay } from '../../utils/constants'
import { formatDespachoFecha, todayStr } from '../../services/despachoService'
import { visitasParaFecha, programasParaFecha } from '../../hooks/useVisitas'
import { AsignacionChofer } from '../../services/asignacionesDiaService'
import { useDespachoBoard, DayItem, dateStr, orderDateStr, PLANTA_DEFAULT, slotKey, parseSlotKey } from '../../hooks/useDespachoBoard'
import { useIsMobile } from '../../hooks/useIsMobile'

// Tipos (DayItem/ItemKind) y helpers de fecha (dateStr/orderDateStr) ahora
// viven en useDespachoBoard.ts junto con el resto de la lógica del tablero.

const COL_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#C084FC', '#F97316', '#34D399', '#FB923C']
function choferColor(idx: number) { return COL_COLORS[idx % COL_COLORS.length] }

// Referencias estables para los fallbacks "sin datos todavía" de cada chofer.
// Si se usara `?? []`/`?? {}` inline, cada render crearía una instancia nueva
// y rompería la comparación superficial de props de React.memo para columnas
// sin cambios reales (la mayoría, en cualquier re-render no relacionado).
const EMPTY_ITEMS:     DayItem[] = []
const EMPTY_ROUTE:     string[] = []
const EMPTY_ARRIVALS:  Record<string, string> = {}
const EMPTY_ASIGNACION: AsignacionChofer = { camionId: null, ayudanteEmail: null }

// Lee un valor keyed-by-chofer solo si hay chofer asignado a la columna;
// si no, devuelve el fallback estable (evita crear objetos/arrays nuevos).
function porChofer<T>(map: Record<string, T>, chofer: UserProfile | null, fallback: T): T {
  return chofer ? (map[chofer.email] ?? fallback) : fallback
}

// ── DraggableCard ─────────────────────────────────────────────────────────────

const DraggableCard = memo(function DraggableCard({ item, routeNum, arrival, color, locked, codigoByClientId, onMoveUp, onMoveDown }: {
  item:      DayItem
  routeNum?: number
  arrival?:  string
  color?:    string
  locked?:   boolean
  codigoByClientId?: Map<string, string | undefined>
  onMoveUp?:   () => void
  onMoveDown?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.dndId })
  const isVisit = item.kind !== 'order'
  const showReorder = !locked && (onMoveUp || onMoveDown)
  // Mismo tratamiento visual que las tarjetas de Pedidos (OrderListRow en
  // LogisticaDashboard): logo de PedidosYa/Rappi en vez del nombre completo
  // truncado, sucursal separada de la razón social, código de cliente y N°
  // de OC — compacto, se agrega a la misma línea del nombre en vez de sumar
  // altura a la tarjeta.
  const { logo: clientLogo, empresa, sucursal } = resolveClientDisplay(item.clientId, item.label)
  const codigoCliente = codigoByClientId ? getCodigoCliente(codigoByClientId, item.clientId, item.sublabel) : undefined
  const totalUnits    = item.products?.reduce((sum, p) => sum + p.quantity, 0)
  // Mismo ancho de columna y misma "píldora" con borde de color que las
  // tarjetas de Pedidos (OrderListRow): identifica de un vistazo a qué
  // chofer está asignada (o ámbar si sigue sin asignar, igual que en
  // Pedidos). Se mantienen dirección y hora estimada — a diferencia de
  // Pedidos, acá sí hacen falta para armar la ruta.
  const borderColor = color ?? (isVisit ? '#a78bfa' : '#D97706')

  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'none', borderLeftColor: borderColor }}
      className={`flex items-center gap-1.5 pl-1.5 pr-1 py-1.5 rounded-r-lg overflow-hidden border border-l-[3px] cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? '' : 'hover:shadow-sm hover:border-accent/60'
      } ${locked ? 'border-green-200 bg-green-50/40' : isVisit ? 'border-violet-200 bg-violet-50' : 'border-[#E4E1D6] bg-white'}`}
    >
      {routeNum != null ? (
        <span
          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
          style={{ backgroundColor: color ?? '#6b7280' }}
        >
          {routeNum}
        </span>
      ) : (
        <span className={`shrink-0 ${isVisit ? 'text-violet-400' : 'text-gray-300'}`}>
          {isVisit ? <Eye size={12} /> : <Package size={12} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {clientLogo && (
            <span className="shrink-0 w-3.5 h-3.5 rounded bg-[#F8F7F2] ring-1 ring-[#E4E1D6] flex items-center justify-center overflow-hidden">
              <img src={clientLogo.src} alt="" title={clientLogo.alt} className="w-full h-full object-contain" />
            </span>
          )}
          <p className="text-xs font-semibold text-gray-900 truncate">
            {!clientLogo && empresa && (
              <span className="text-gray-400 font-normal">{empresa} · </span>
            )}
            {sucursal}
          </p>
          {codigoCliente && (
            <span className="text-[9px] text-gray-400 font-mono shrink-0">{codigoCliente}</span>
          )}
          {item.numeroOC && (
            <span className="text-[9px] text-gray-400 font-mono shrink-0">OC {item.numeroOC}</span>
          )}
          {locked && <Lock size={9} className="text-green-500 shrink-0" />}
          {item.kind === 'programa' && (
            <span className="text-violet-400 shrink-0" title="Visita recurrente">↺</span>
          )}
          {item.reprogramado && (
            <span className="text-amber-500 shrink-0" title={`Reprogramado${item.motivoReprogramacion ? `: ${item.motivoReprogramacion}` : ''}`}>↻</span>
          )}
          {!!totalUnits && (
            <span className="ml-auto text-[9px] text-gray-400 font-mono tabular-nums shrink-0">{totalUnits}u</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-gray-400 truncate leading-tight flex-1">{item.sublabel}</p>
          {arrival && <span className="text-[9px] text-accent font-medium shrink-0">⏱{arrival}</span>}
        </div>
      </div>
      {showReorder && (
        <div className="flex flex-col shrink-0">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveUp}
            disabled={!onMoveUp}
            title="Subir"
            className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-0 disabled:pointer-events-none transition-colors"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onMoveDown}
            disabled={!onMoveDown}
            title="Bajar"
            className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-0 disabled:pointer-events-none transition-colors"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      )}
    </div>
  )
})

// ── GhostCard ─────────────────────────────────────────────────────────────────

function GhostCard({ item }: { item: DayItem }) {
  const { logo: clientLogo, empresa, sucursal } = resolveClientDisplay(item.clientId, item.label)
  return (
    <div className={`border-2 border-accent rounded-xl p-3 shadow-2xl rotate-1 w-52 ${
      item.kind !== 'order' ? 'bg-violet-50' : 'bg-white'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {clientLogo ? (
          <span className="shrink-0 w-4 h-4 rounded bg-[#F8F7F2] ring-1 ring-[#E4E1D6] flex items-center justify-center overflow-hidden">
            <img src={clientLogo.src} alt="" title={clientLogo.alt} className="w-full h-full object-contain" />
          </span>
        ) : (
          item.kind !== 'order' ? <Eye size={13} className="text-violet-400" /> : <Package size={13} className="text-gray-400" />
        )}
        <p className="text-sm font-semibold text-gray-900 leading-tight truncate">
          {!clientLogo && empresa && <span className="text-gray-400 font-normal">{empresa} · </span>}
          {sucursal}
        </p>
      </div>
      <p className="text-xs text-gray-400 truncate">{item.sublabel}</p>
    </div>
  )
}

// ── DroppableZone ─────────────────────────────────────────────────────────────

function DroppableZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`flex-1 min-h-[80px] rounded-xl transition-colors ${
      isOver ? 'bg-accent/10 border-2 border-accent border-dashed' : ''
    } ${className ?? ''}`}>
      {children}
    </div>
  )
}

// ── SinAsignarColumn ──────────────────────────────────────────────────────────

function SinAsignarColumn({ items, codigoByClientId, fullWidth }: { items: DayItem[]; codigoByClientId: Map<string, string | undefined>; fullWidth?: boolean }) {
  const orders  = items.filter((i) => i.kind === 'order')
  const visitas = items.filter((i) => i.kind !== 'order')
  return (
    <div className={`flex flex-col h-full ${fullWidth ? 'w-full' : 'w-[340px] shrink-0'}`}>
      <div className="bg-[#F1EFE8] border border-[#D3D1C7] rounded-t-xl px-3 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-gray-700">Sin asignar</p>
        <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <DroppableZone id="sin_asignar" className="bg-[#F8F7F2] border border-t-0 border-[#D3D1C7] rounded-b-xl p-2 space-y-1 overflow-y-auto flex-1">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Todo asignado ✓</p>
        ) : (
          <>
            {orders.length > 0 && orders.map((i) => <DraggableCard key={i.dndId} item={i} codigoByClientId={codigoByClientId} />)}
            {visitas.length > 0 && (
              <>
                {orders.length > 0 && <div className="border-t border-[#D3D1C7] my-1" />}
                {visitas.map((i) => <DraggableCard key={i.dndId} item={i} codigoByClientId={codigoByClientId} />)}
              </>
            )}
          </>
        )}
      </DroppableZone>
    </div>
  )
}

// ── VueltaSection (un despacho del camión — puede haber más de uno el mismo
// día, "vuelta 2": el camión sale, entrega, vuelve a planta y carga de
// nuevo) ─────────────────────────────────────────────────────────────────────

export interface VueltaData {
  slot:          string
  vuelta:        number
  items:         DayItem[]
  routeOrder:    string[]
  arrivals:      Record<string, string>
  recalculating: boolean
  orsStatus?:    { ok: boolean; error?: string }
  despacho?:     Despacho
  plantaId:      PlantaId
  horaSalida:    string
  manualOrder:   boolean
}

const VueltaSection = memo(function VueltaSection({
  data, showLabel, color, camion, catalogo, codigoByClientId,
  onPlantaChange, onHoraSalidaChange, onConfirm, onReopen, onTransfer, onManualReorder, onRecalculate,
}: {
  data:             VueltaData
  showLabel:        boolean
  color:            string
  camion:           Camion
  catalogo:         CatalogProducto[]
  codigoByClientId: Map<string, string | undefined>
  onPlantaChange:       (slot: string, p: PlantaId) => void
  onHoraSalidaChange:   (slot: string, h: string) => void
  onConfirm:            (slot: string) => void
  onReopen:             (slot: string) => void
  onTransfer:           (slot: string) => void
  onManualReorder:      (slot: string, newOrderIds: string[]) => void
  onRecalculate:        (slot: string) => void
}) {
  const { slot, vuelta, items, routeOrder, arrivals, recalculating, orsStatus, despacho, plantaId, horaSalida, manualOrder } = data
  const confirmed = despacho?.status === 'confirmado'

  const sortedItems = useMemo(() => {
    if (routeOrder.length === 0) return items
    const idx: Record<string, number> = {}
    routeOrder.forEach((id, i) => { idx[id] = i })
    return [...items].sort((a, b) => (idx[a.dndId] ?? 999) - (idx[b.dndId] ?? 999))
  }, [items, routeOrder])

  const moveItem = (index: number, dir: -1 | 1) => {
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= sortedItems.length) return
    const reordered = [...sortedItems]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(newIndex, 0, moved)
    onManualReorder(slot, reordered.map((i) => i.dndId))
  }

  const orderCount = items.filter((i) => i.kind === 'order').length
  const visitCount = items.filter((i) => i.kind !== 'order').length

  // ── Pallets ────────────────────────────────────────────────────────────────
  const capacidad = camion.capacidadPallets ?? null

  const totalPallets = useMemo(() =>
    items
      .filter((i) => i.kind === 'order' && i.products)
      .reduce((sum, i) => sum + calcPallets(i.products ?? [], catalogo), 0),
  [items, catalogo])

  const palletsRatio = capacidad ? totalPallets / capacidad : null
  const overloaded   = palletsRatio !== null && palletsRatio > 1
  const barColor      = overloaded ? '#ef4444' : (palletsRatio ?? 0) > 0.8 ? '#f97316' : '#22c55e'

  return (
    <div className={showLabel ? 'mt-2 border border-[#D3D1C7] rounded-xl overflow-hidden' : 'contents'}>
      {showLabel && (
        <div className={`px-3 py-1.5 flex items-center gap-2 ${confirmed ? 'bg-green-50 border-b border-green-200' : 'bg-[#F1EFE8] border-b border-[#D3D1C7]'}`}>
          <p className="text-xs font-semibold text-gray-600">Vuelta {vuelta}</p>
          {orderCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
              {orderCount}📦
            </span>
          )}
          {visitCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
              {visitCount}👁
            </span>
          )}
          {confirmed && <CheckCircle size={11} className="text-green-500 ml-auto shrink-0" />}
        </div>
      )}

      <div className={`px-3 py-2 ${showLabel ? '' : `border rounded-t-xl ${confirmed ? 'bg-green-50 border-green-300' : 'bg-white border-[#D3D1C7]'}`}`}>
        {/* Barra de pallets */}
        {(orderCount > 0 || capacidad !== null) && items.length > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className={overloaded ? 'text-red-600 font-bold' : 'text-gray-500'}>
                {overloaded && '⚠️ '}
                📦 {totalPallets % 1 === 0 ? totalPallets : totalPallets.toFixed(1)} pallets
              </span>
              {capacidad ? (
                <span className={overloaded ? 'text-red-500 font-bold' : 'text-gray-400'}>
                  / {capacidad}
                </span>
              ) : (
                <span className="text-gray-300">sin límite</span>
              )}
            </div>
            {capacidad && (
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${overloaded ? 'animate-pulse' : ''}`}
                  style={{ width: `${Math.min((palletsRatio ?? 0) * 100, 100)}%`, backgroundColor: barColor }}
                />
              </div>
            )}
            {overloaded && (
              <p className="text-[10px] text-red-500 font-bold animate-pulse">
                ⚠️ Sobrecarga: +{((totalPallets - (capacidad ?? 0)) % 1 === 0 ? (totalPallets - (capacidad ?? 0)) : (totalPallets - (capacidad ?? 0)).toFixed(1))} pallets extra
              </p>
            )}
          </div>
        )}

        {/* Planta y hora de salida */}
        <div className={`flex items-center gap-1.5 ${(orderCount > 0 || capacidad !== null) && items.length > 0 ? 'mt-1.5' : ''}`}>
          <select
            value={plantaId}
            onChange={(e) => onPlantaChange(slot, e.target.value as PlantaId)}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={confirmed}
            className="flex-1 text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400 truncate"
          >
            {(Object.entries(PLANTAS) as [PlantaId, typeof PLANTAS[PlantaId]][]).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
          <input
            type="time" value={horaSalida}
            onChange={(e) => onHoraSalidaChange(slot, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={confirmed}
            className="w-16 text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>

        {/* Estado ruta */}
        <div className="mt-1.5 flex items-center gap-1.5">
          {recalculating ? (
            <><div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin shrink-0" /><span className="text-[10px] text-gray-400">Calculando ruta...</span></>
          ) : confirmed ? (
            <><CheckCircle size={11} className="text-green-500 shrink-0" /><span className="text-[10px] text-green-600 font-medium">DESPACHADO{despacho?.modifiedAfterConfirm ? ' (+cambios)' : ''}</span></>
          ) : manualOrder ? (
            <><Lock size={11} className="text-amber-500 shrink-0" /><span className="text-[10px] text-amber-600 font-medium">Orden manual</span></>
          ) : orsStatus && routeOrder.length > 0 ? (
            orsStatus.ok ? (
              <><CheckCircle size={11} className="text-accent shrink-0" /><span className="text-[10px] text-accent font-medium">Ruta optimizada (ORS)</span></>
            ) : (
              <><CheckCircle size={11} className="text-gray-400 shrink-0" /><span className="text-[10px] text-gray-500 font-medium">Ruta estimada (local)</span></>
            )
          ) : items.length > 0 ? (
            <span className="text-[10px] text-gray-400">Sin optimizar aún...</span>
          ) : null}
        </div>
        {manualOrder && !confirmed && (
          <button
            onClick={() => onRecalculate(slot)}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 hover:text-accent transition-colors"
          >
            <RotateCcw size={10} /> Recalcular ruta automática
          </button>
        )}
      </div>

      {/* Cards */}
      <DroppableZone
        id={slot}
        className={`border border-t-0 p-2 space-y-1 overflow-y-auto ${showLabel ? 'max-h-72' : 'flex-1'} ${confirmed ? 'bg-green-50/40 border-green-200' : 'bg-white border-[#D3D1C7]'}`}
      >
        {sortedItems.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Arrastrar pedidos o visitas acá</p>
        ) : (
          sortedItems.map((item, i) => (
            <DraggableCard
              key={item.dndId}
              item={item}
              routeNum={routeOrder.includes(item.dndId) ? routeOrder.indexOf(item.dndId) + 1 : i + 1}
              arrival={arrivals[item.dndId]}
              color={color}
              locked={confirmed}
              codigoByClientId={codigoByClientId}
              onMoveUp={!confirmed && sortedItems.length > 1 && i > 0 ? () => moveItem(i, -1) : undefined}
              onMoveDown={!confirmed && sortedItems.length > 1 && i < sortedItems.length - 1 ? () => moveItem(i, 1) : undefined}
            />
          ))
        )}
      </DroppableZone>

      {/* Footer */}
      <div className={`border border-t-0 px-2 py-2 space-y-1.5 ${showLabel ? '' : 'rounded-b-xl'} ${confirmed ? 'bg-green-50 border-green-200' : 'bg-white border-[#D3D1C7]'}`}>
        {confirmed ? (
          <button onClick={() => onReopen(slot)} className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 py-1 transition-colors">
            <RotateCcw size={11} /> Reabrir despacho
          </button>
        ) : (
          <button
            onClick={() => onConfirm(slot)}
            disabled={items.length === 0}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-accent text-white rounded-lg py-2 hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Lock size={11} /> Confirmar despacho
          </button>
        )}
        {items.length > 0 && (
          <button
            onClick={() => onTransfer(slot)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 rounded-lg py-1.5 bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            <ArrowRightLeft size={11} /> Transferir paradas
          </button>
        )}
      </div>
    </div>
  )
})

// ── CamionColumn (columna = camión; adentro se elige chofer y ayudante, y se
// apilan 1..N vueltas — ver VueltaSection) ─────────────────────────────────

const CamionColumn = memo(function CamionColumn({
  camion, chofer, choferesPrincipales, assignedChoferEmails, onChoferChange,
  ayudantes, asignacion, onAsignacionChange,
  vueltas, colorIdx, catalogo, codigoByClientId,
  onPlantaChange, onHoraSalidaChange, onConfirm, onReopen, onTransfer, onManualReorder, onRecalculate,
  onAddVuelta,
  fullWidth,
}: {
  camion:               Camion
  chofer:               UserProfile | null
  choferesPrincipales:  UserProfile[]
  assignedChoferEmails: Set<string>
  onChoferChange:       (camionId: string, email: string) => void
  ayudantes:            UserProfile[]
  asignacion:           AsignacionChofer
  onAsignacionChange:   (email: string, patch: Partial<AsignacionChofer>) => void
  vueltas:              VueltaData[]
  colorIdx:             number
  catalogo:             CatalogProducto[]
  codigoByClientId:     Map<string, string | undefined>
  onPlantaChange:       (slot: string, p: PlantaId) => void
  onHoraSalidaChange:   (slot: string, h: string) => void
  onConfirm:            (slot: string) => void
  onReopen:             (slot: string) => void
  onTransfer:           (slot: string) => void
  onManualReorder:      (slot: string, newOrderIds: string[]) => void
  onRecalculate:        (slot: string) => void
  onAddVuelta:          (driverEmail: string) => void
  fullWidth?:           boolean
}) {
  const color = choferColor(colorIdx)
  const anyConfirmed = vueltas.some((v) => v.despacho?.status === 'confirmado')

  // Choferes elegibles para este camión: el que ya lo maneja (si hay) + los
  // que hoy no están manejando ningún otro camión activo (evita duplicarlos).
  const choferesDisponibles = useMemo(
    () => choferesPrincipales.filter((c) => c.email === chofer?.email || !assignedChoferEmails.has(c.email)),
    [choferesPrincipales, assignedChoferEmails, chofer],
  )

  const totalOrderCount = vueltas.reduce((sum, v) => sum + v.items.filter((i) => i.kind === 'order').length, 0)
  const totalVisitCount = vueltas.reduce((sum, v) => sum + v.items.filter((i) => i.kind !== 'order').length, 0)
  const showLabel = vueltas.length > 1

  const lastVuelta = vueltas[vueltas.length - 1]
  const canAddVuelta = !!chofer && (!lastVuelta || lastVuelta.despacho?.status === 'confirmado')

  return (
    <div className={`flex flex-col h-full ${fullWidth ? 'w-full' : 'w-[340px] shrink-0'} ${showLabel ? 'overflow-y-auto' : ''}`}>
      {/* Header */}
      <div className="border rounded-t-xl px-3 py-2.5 bg-white border-[#D3D1C7]">
        <div className="flex items-center gap-2">
          <Truck size={14} style={{ color }} className="shrink-0" />
          {/* Patente en su propia línea (nunca trunca, son cortas) — el
              modelo va abajo en gris, así puede truncar sin esconder la
              patente (antes "patente — modelo" en una sola línea perdía el
              modelo entero con nombres largos). */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate leading-tight">{camion.patente}</p>
            <p className="text-[10px] text-gray-400 truncate leading-tight">{camion.modelo}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {totalOrderCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
                {totalOrderCount}📦
              </span>
            )}
            {totalVisitCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                {totalVisitCount}👁
              </span>
            )}
          </div>
        </div>

        {/* Chofer — avatar con iniciales coloreado igual que los círculos de
            orden de ruta, para identificar la columna de un vistazo sin
            tener que leer el nombre completo. */}
        <div className="mt-1 flex items-center gap-1.5">
          {chofer && (
            <span
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
              style={{ backgroundColor: color }}
              title={chofer.nombreContacto || chofer.nombre || chofer.email}
            >
              {initials(chofer.nombreContacto || chofer.nombre || chofer.email)}
            </span>
          )}
          <select
            value={chofer?.email ?? ''}
            onChange={(e) => onChoferChange(camion.id, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={anyConfirmed}
            className="flex-1 min-w-0 text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400 truncate"
          >
            <option value="">Sin chofer</option>
            {choferesDisponibles.map((c) => (
              <option key={c.email} value={c.email}>{c.nombreContacto || c.nombre || c.email}</option>
            ))}
          </select>
        </div>

        {!chofer ? (
          <p className="mt-2 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-2 text-center leading-tight">
            ⚠️ Asigná un chofer para poder cargar pedidos acá
          </p>
        ) : (
          <select
            value={asignacion.ayudanteEmail ?? ''}
            onChange={(e) => onAsignacionChange(chofer.email, { ayudanteEmail: e.target.value || null })}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={anyConfirmed}
            className="mt-1 w-full text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400 truncate"
          >
            <option value="">Sin ayudante</option>
            {ayudantes.filter((a) => a.email !== chofer.email).map((a) => (
              <option key={a.email} value={a.email}>{a.nombreContacto || a.nombre || a.email}</option>
            ))}
          </select>
        )}
      </div>

      {chofer ? (
        <>
          {vueltas.map((v) => (
            <VueltaSection
              key={v.slot}
              data={v}
              showLabel={showLabel}
              color={color}
              camion={camion}
              catalogo={catalogo}
              codigoByClientId={codigoByClientId}
              onPlantaChange={onPlantaChange}
              onHoraSalidaChange={onHoraSalidaChange}
              onConfirm={onConfirm}
              onReopen={onReopen}
              onTransfer={onTransfer}
              onManualReorder={onManualReorder}
              onRecalculate={onRecalculate}
            />
          ))}
          <button
            onClick={() => onAddVuelta(chofer.email)}
            disabled={!canAddVuelta}
            title={canAddVuelta ? undefined : 'Confirmá la vuelta actual para poder agregar otra'}
            className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 border border-dashed border-[#D3D1C7] rounded-xl py-2 hover:text-accent hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            + Agregar vuelta
          </button>
        </>
      ) : (
        <div className="flex-1 border border-t-0 border-[#D3D1C7] rounded-b-xl bg-gray-50/50" />
      )}
    </div>
  )
})

// ── TransferModal ─────────────────────────────────────────────────────────────

function TransferModal({ fromDriver, fromDriverName, fromCamionLabel, items, destinos, onClose, onTransfer }: {
  fromDriver:      string
  fromDriverName:  string
  fromCamionLabel?: string
  items:           DayItem[]
  destinos:        { camion: Camion; chofer: UserProfile; colorIdx: number }[]
  onClose:         () => void
  onTransfer:      (selectedDndIds: string[], toDriver: string, motivo: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toDriver, setToDriver] = useState('')
  const [motivo,   setMotivo]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const destinosFiltrados = destinos.filter((d) => d.chofer.email !== fromDriver)

  const toggle = (dndId: string) =>
    setSelected((prev) => { const s = new Set(prev); if (s.has(dndId)) s.delete(dndId); else s.add(dndId); return s })

  const toggleAll = () =>
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.dndId)))

  const handleConfirm = async () => {
    if (selected.size === 0 || !toDriver) return
    setLoading(true)
    setError('')
    try {
      await onTransfer(Array.from(selected), toDriver, motivo)
      onClose()
    } catch (err) {
      // Antes, si esto fallaba, el modal quedaba trabado para siempre (el
      // "Cancelar" se deshabilita mientras loading es true, y loading nunca
      // volvía a false porque no había catch/finally).
      console.error(err)
      setError('No se pudo transferir. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Transferir paradas" variant="light">
      <div className="space-y-4">

        {/* Origen */}
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          Reasignando desde <span className="font-semibold text-gray-900">{fromCamionLabel ? `${fromCamionLabel} — ${fromDriverName}` : fromDriverName}</span>
        </div>

        {/* Lista de ítems */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seleccionar paradas</p>
            <button onClick={toggleAll} className="text-xs text-accent hover:underline">
              {selected.size === items.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {items.map((item) => (
              <label key={item.dndId}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                  selected.has(item.dndId)
                    ? 'border-accent bg-accent/5'
                    : item.kind !== 'order' ? 'border-violet-200 bg-violet-50/50' : 'border-[#D3D1C7] bg-white hover:border-accent/40'
                }`}>
                <input
                  type="checkbox" checked={selected.has(item.dndId)} onChange={() => toggle(item.dndId)}
                  className="w-4 h-4 rounded accent-[#00C2FF] shrink-0"
                />
                {item.kind !== 'order' ? <Eye size={13} className="text-violet-400 shrink-0" /> : <Package size={13} className="text-gray-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                  <p className="text-xs text-gray-400 truncate">{item.sublabel}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Destino */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Camión destino</label>
          {destinosFiltrados.length === 0 ? (
            <p className="text-xs text-gray-400">No hay otros camiones con chofer asignado hoy.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {destinosFiltrados.map(({ camion, chofer, colorIdx }) => {
                const nombre = chofer.nombreContacto || chofer.nombre || chofer.email
                const color  = choferColor(colorIdx)
                return (
                  <button key={camion.id} onClick={() => setToDriver(chofer.email)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm text-left transition-all ${
                      toDriver === chofer.email ? 'border-accent bg-accent/5 font-semibold' : 'border-[#D3D1C7] bg-white hover:border-accent/40'
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{camion.patente}</p>
                      <p className="truncate text-[11px] text-gray-400 font-normal">{nombre}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Motivo */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Motivo (opcional)</label>
          <textarea
            value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            placeholder="Ej: problema mecánico, tiempo insuficiente..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
          />
        </div>

        {/* Resumen */}
        {selected.size > 0 && toDriver && (
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
            <ArrowRightLeft size={12} className="text-accent shrink-0" />
            Transferir <span className="font-semibold text-gray-900">{selected.size} parada{selected.size !== 1 ? 's' : ''}</span> a{' '}
            <span className="font-semibold text-gray-900">
              {(() => { const d = destinosFiltrados.find((x) => x.chofer.email === toDriver); return d ? `${d.camion.patente} — ${d.chofer.nombreContacto || d.chofer.nombre}` : toDriver })()}
            </span>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 text-sm" disabled={loading}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            loading={loading}
            disabled={selected.size === 0 || !toDriver}
            className="flex-1 text-sm"
          >
            Transferir
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  orders:     Order[]
  choferes:   UserProfile[]
  allClients: UserProfile[]
  loading:    boolean
}

export default function DespachoBoard({ orders, choferes, allClients, loading }: Props) {
  const {
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
  } = useDespachoBoard(orders, choferes, allClients)

  // ── Camiones activos = columnas del tablero ───────────────────────────────
  // Adentro de cada camión se elige chofer y ayudante (al revés de antes,
  // donde la columna era el chofer y adentro se elegía el camión). El chofer
  // asignado a cada camión hoy sale de una búsqueda inversa sobre
  // `asignacionesDia` (que sigue guardando, por chofer, {camionId, ayudanteEmail}
  // — no hace falta tocar el hook ni el modelo persistido).
  const activeCamiones = useMemo(() => camiones.filter((c) => c.activo), [camiones])

  // Para el logo/código de cliente en las tarjetas de parada (mismo patrón
  // que las tarjetas de Pedidos en LogisticaDashboard).
  const codigoByClientId = useMemo(() => buildCodigoByClientId(allClients), [allClients])

  const choferByCamionId = useMemo(() => {
    const m: Record<string, UserProfile> = {}
    choferesPrincipales.forEach((c) => {
      const camionId = asignacionesDia[c.email]?.camionId
      if (camionId) m[camionId] = c
    })
    return m
  }, [choferesPrincipales, asignacionesDia])

  const assignedChoferEmails = useMemo(
    () => new Set(Object.values(choferByCamionId).map((c) => c.email)),
    [choferByCamionId],
  )

  const handleChoferChange = useCallback((camionId: string, newEmail: string) => {
    const prev = choferByCamionId[camionId]
    if (prev) handleAsignacionChange(prev.email, { camionId: null })
    if (newEmail) handleAsignacionChange(newEmail, { camionId })
  }, [choferByCamionId, handleAsignacionChange])

  const camionColumnProps = useCallback((camion: Camion, idx: number) => {
    const chofer = choferByCamionId[camion.id] ?? null
    const vueltas = chofer
      ? (vueltasByDriver[chofer.email] ?? [1]).map((vuelta) => {
          const slot = slotKey(chofer.email, vuelta)
          return {
            slot, vuelta,
            items:         itemsByDriver[slot] ?? EMPTY_ITEMS,
            routeOrder:    routeOrder[slot] ?? EMPTY_ROUTE,
            arrivals:      routeArrivals[slot] ?? EMPTY_ARRIVALS,
            recalculating: !!recalculating[slot],
            orsStatus:     orsStatus[slot],
            despacho:      despachoByDriver[slot],
            plantaId:      plantaByDriver[slot] ?? PLANTA_DEFAULT,
            horaSalida:    horaSalidaByDriver[slot] ?? '07:00',
            manualOrder:   !!manualOrder[slot],
          }
        })
      : []
    return {
      camion, chofer,
      choferesPrincipales, assignedChoferEmails,
      onChoferChange: handleChoferChange,
      ayudantes: choferes,
      asignacion: porChofer(asignacionesDia, chofer, EMPTY_ASIGNACION),
      onAsignacionChange: handleAsignacionChange,
      vueltas,
      colorIdx: idx,
      catalogo,
      codigoByClientId,
      onPlantaChange: handlePlantaChange,
      onHoraSalidaChange: handleHoraSalidaChange,
      onConfirm: handleConfirmClick,
      onReopen: handleReopen,
      onTransfer: handleTransferClick,
      onManualReorder: handleManualReorder,
      onRecalculate: handleRecalculate,
      onAddVuelta: handleAddVuelta,
    }
  }, [
    choferByCamionId, choferesPrincipales, assignedChoferEmails, handleChoferChange, choferes,
    asignacionesDia, handleAsignacionChange, vueltasByDriver, handleAddVuelta, itemsByDriver, routeOrder, routeArrivals, recalculating,
    orsStatus, despachoByDriver, plantaByDriver, horaSalidaByDriver, catalogo, manualOrder, codigoByClientId,
    handlePlantaChange, handleHoraSalidaChange, handleConfirmClick, handleReopen, handleTransferClick,
    handleManualReorder, handleRecalculate,
  ])

  // Mobile: un camión (o "sin asignar") a la vez, elegido con chips — no hay
  // columnas vecinas visibles para arrastrar una parada entre camiones, ahí
  // se usa el botón "Transferir paradas" ya existente.
  const isMobile = useIsMobile()
  const [mobileBucket, setMobileBucket] = useState('sin_asignar')
  useEffect(() => {
    if (mobileBucket === 'sin_asignar' || activeCamiones.some((c) => c.id === mobileBucket)) return
    setMobileBucket('sin_asignar')
  }, [activeCamiones, mobileBucket])

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner /></div>

  return (
    <div className="flex flex-col h-full">

      {/* Selector de fecha */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-gray-100 bg-white">
        <button
          onClick={() => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() - 1); setFecha(dateStr(d)) }}
          className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center hover:border-accent transition-colors shrink-0"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex gap-1.5 overflow-x-auto flex-1">
          {weekDays.map((d) => {
            const dt    = new Date(d + 'T12:00:00')
            const label = dt.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' })
            const oCount = orders.filter((o) => orderDateStr(o) === d && !['entregado', 'cancelado'].includes(o.status)).length
            const vCount = visitasParaFecha(visitas, dt).length + programasParaFecha(programas, dt).length
            return (
              <button key={d} onClick={() => setFecha(d)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  d === fecha ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-600 hover:bg-[#E8E6DF]'
                } ${d === todayStr() && d !== fecha ? 'ring-1 ring-accent/40' : ''}`}
              >
                {label}
                {(oCount + vCount) > 0 && (
                  <span className={`ml-1 text-[10px] font-bold ${d === fecha ? 'text-white/80' : 'text-gray-400'}`}>
                    {oCount + vCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + 1); setFecha(dateStr(d)) }}
          className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center hover:border-accent transition-colors shrink-0"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 px-4 py-1.5 bg-white border-b border-gray-100 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><Package size={10} /> Pedido</span>
        <span className="flex items-center gap-1"><Eye size={10} className="text-violet-400" /> <span className="text-violet-400">Visita</span></span>
        <span className="flex items-center gap-1 text-violet-300">↺ Recurrente</span>
      </div>

      {activeCamiones.length === 0 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
          No hay camiones activos — activalos desde <span className="font-semibold">Flota</span> para poder despachar.
        </div>
      )}

      {/* Tablero */}
      <div className="flex-1 min-h-0">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {/* Desktop vs. mobile se elige con JS (useIsMobile), no con CSS
              (hidden md:...): dos columnas con el mismo id montadas a la vez
              (una solo tapada por CSS) hacen que dnd-kit registre dos
              useDraggable/useDroppable con el mismo id y mida la copia
              oculta — el "fantasma" del drag aparecía pegado arriba de la
              pantalla por esto. */}
          {isMobile ? (
            /* Mobile: un camión (o "sin asignar") a la vez, elegido con chips */
            <div className="flex flex-col h-full p-3 gap-2">
              <div className="flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => setMobileBucket('sin_asignar')}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    mobileBucket === 'sin_asignar' ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-600 hover:bg-[#E8E6DF]'
                  }`}
                >
                  Sin asignar
                  {(itemsByDriver['sin_asignar']?.length ?? 0) > 0 && (
                    <span className={`ml-1 text-[10px] font-bold ${mobileBucket === 'sin_asignar' ? 'text-white/80' : 'text-gray-400'}`}>
                      {itemsByDriver['sin_asignar']!.length}
                    </span>
                  )}
                </button>
                {activeCamiones.map((camion) => {
                  const chofer = choferByCamionId[camion.id] ?? null
                  const count  = chofer
                    ? (vueltasByDriver[chofer.email] ?? [1]).reduce((sum, v) => sum + (itemsByDriver[slotKey(chofer.email, v)]?.length ?? 0), 0)
                    : 0
                  const selected = mobileBucket === camion.id
                  return (
                    <button
                      key={camion.id}
                      onClick={() => setMobileBucket(camion.id)}
                      className={`shrink-0 flex flex-col items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        selected ? 'bg-accent text-white' : 'bg-[#F1EFE8] text-gray-600 hover:bg-[#E8E6DF]'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {camion.patente}
                        {count > 0 && (
                          <span className={`text-[10px] font-bold ${selected ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
                        )}
                      </span>
                      <span className={`text-[9px] ${selected ? 'text-white/70' : chofer ? 'text-gray-400' : 'text-amber-500'}`}>
                        {chofer ? (chofer.nombreContacto || chofer.nombre || chofer.email) : 'Sin chofer'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex-1 min-h-0">
                {mobileBucket === 'sin_asignar' ? (
                  <SinAsignarColumn items={itemsByDriver['sin_asignar'] ?? []} codigoByClientId={codigoByClientId} fullWidth />
                ) : (() => {
                  const idx    = activeCamiones.findIndex((c) => c.id === mobileBucket)
                  const camion = activeCamiones[idx]
                  if (!camion) return null
                  return <CamionColumn {...camionColumnProps(camion, idx)} fullWidth />
                })()}
              </div>
            </div>
          ) : (
            /* Desktop: columnas lado a lado. El scroll horizontal va en un
                contenedor DENTRO del DndContext (no envolviéndolo) — el
                DragOverlay queda afuera de esa zona con scroll, igual que en
                la pestaña Pedidos. */
            <div className="h-full overflow-x-auto overflow-y-hidden">
              <div className="flex gap-3 h-full p-4" style={{ minWidth: 'max-content' }}>

                <SinAsignarColumn items={itemsByDriver['sin_asignar'] ?? []} codigoByClientId={codigoByClientId} />

                {activeCamiones.map((camion, idx) => (
                  <CamionColumn key={camion.id} {...camionColumnProps(camion, idx)} />
                ))}
              </div>
            </div>
          )}

          <DragOverlay dropAnimation={null}>
            {activeItem && <GhostCard item={activeItem} />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Modal confirmar */}
      <Modal open={!!confirmingDriver} onClose={() => { if (!confirmLoading) setConfirmingDriver(null) }} title="Confirmar despacho" variant="light">
        {confirmingChofer && (
          <div className="space-y-4">
            <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl p-4 text-sm space-y-1.5">
              <p className="font-medium text-accent">{confirmingChofer.nombreContacto || confirmingChofer.nombre}</p>
              <p className="text-gray-600">
                {confirmingItems.length} parada{confirmingItems.length !== 1 ? 's' : ''} — {formatDespachoFecha(fecha)}
                {confirmingDriver && parseSlotKey(confirmingDriver).vuelta > 1 && ` · Vuelta ${parseSlotKey(confirmingDriver).vuelta}`}
              </p>
              {(() => {
                const asig   = confirmingDriver ? asignacionesDia[parseSlotKey(confirmingDriver).email] : null
                const camion = asig?.camionId ? camiones.find((cam) => cam.id === asig.camionId) : null
                const label  = camion ? `${camion.patente} — ${camion.modelo}` : null
                const ayud   = asig?.ayudanteEmail ? choferes.find((c) => c.email === asig.ayudanteEmail) : null
                const pallets = confirmingItems
                  .filter((i) => i.kind === 'order' && i.products)
                  .reduce((s, i) => s + calcPallets(i.products ?? [], catalogo), 0)
                const cap = camion?.capacidadPallets ?? null
                const over = cap !== null && pallets > cap
                return (<>
                  {label && <p className="text-xs text-gray-400">🚛 {label}</p>}
                  {ayud  && <p className="text-xs text-gray-400">👤 Ayudante: {ayud.nombreContacto || ayud.nombre || ayud.email}</p>}
                  {pallets > 0 && (
                    <p className={`text-xs font-semibold ${over ? 'text-red-600' : 'text-gray-500'}`}>
                      📦 {pallets % 1 === 0 ? pallets : pallets.toFixed(1)} pallets{cap ? ` / ${cap}` : ''}{over ? ' — ⚠️ SOBRECARGA' : ''}
                    </p>
                  )}
                </>)
              })()}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Los pedidos pasan a "Confirmado" y se envía push al chofer.
            </div>
            <ul className="space-y-1 max-h-44 overflow-y-auto">
              {(routeOrder[confirmingDriver!]?.length > 0
                ? routeOrder[confirmingDriver!].map((id) => confirmingItems.find((i) => i.dndId === id)).filter(Boolean) as DayItem[]
                : confirmingItems
              ).map((item, i) => {
                const camionIdx = activeCamiones.findIndex((c) => choferByCamionId[c.id]?.email === (confirmingDriver ? parseSlotKey(confirmingDriver).email : null))
                return (
                  <li key={item.dndId} className="flex items-center gap-2 text-sm">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: choferColor(camionIdx) }}>
                      {i + 1}
                    </span>
                    {item.kind !== 'order' ? <Eye size={11} className="text-violet-400 shrink-0" /> : <Package size={11} className="text-gray-400 shrink-0" />}
                    <span className="text-gray-700 truncate">{item.label}</span>
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmingDriver(null)} className="flex-1 text-sm" disabled={confirmLoading}>Cancelar</Button>
              <Button onClick={() => handleConfirm(confirmingDriver!)} loading={confirmLoading} className="flex-1 text-sm">Confirmar y notificar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal transferir paradas */}
      {transferModal && (() => {
        const fromEmail = parseSlotKey(transferModal.fromDriver).email
        const fromCamion = camiones.find((c) => c.id === asignacionesDia[fromEmail]?.camionId)
        const fromChoferName = (() => { const c = choferes.find((ch) => ch.email === fromEmail); return c?.nombreContacto || c?.nombre || fromEmail })()
        const destinos = activeCamiones
          .map((camion, idx) => ({ camion, chofer: choferByCamionId[camion.id] ?? null, colorIdx: idx }))
          .filter((d): d is { camion: Camion; chofer: UserProfile; colorIdx: number } => !!d.chofer)
        return (
          <TransferModal
            fromDriver={fromEmail}
            fromDriverName={fromChoferName}
            fromCamionLabel={fromCamion ? `${fromCamion.patente} — ${fromCamion.modelo}` : undefined}
            items={itemsByDriver[transferModal.fromDriver] ?? []}
            destinos={destinos}
            onClose={() => setTransferModal(null)}
            onTransfer={handleTransfer}
          />
        )
      })()}

      {/* Modal mover a despacho confirmado */}
      <Modal open={!!pendingMove} onClose={() => setPendingMove(null)} title="Despacho ya confirmado" variant="light">
        {pendingMove && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Este chofer ya tiene su despacho confirmado. ¿Querés agregar esta parada de todas formas?</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPendingMove(null)} className="flex-1 text-sm">Cancelar</Button>
              <Button onClick={async () => { await doMove(pendingMove.dndId, pendingMove.from, pendingMove.to, true); setPendingMove(null) }} className="flex-1 text-sm">Agregar igual</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
