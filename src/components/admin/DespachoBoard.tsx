import { useState, useMemo, memo } from 'react'
import {
  DndContext, DragOverlay,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { Truck, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Lock, CheckCircle, RotateCcw, Eye, Package, ArrowRightLeft, AlertTriangle } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import LoadingSpinner from '../ui/LoadingSpinner'
import { Order, CatalogProducto, UserProfile, Despacho, Camion, PLANTAS, PlantaId } from '../../types'
import { calcPallets } from '../../utils/helpers'
import { formatDespachoFecha, todayStr } from '../../services/despachoService'
import { visitasParaFecha, programasParaFecha } from '../../hooks/useVisitas'
import { AsignacionChofer } from '../../services/asignacionesDiaService'
import { useDespachoBoard, DayItem, dateStr, orderDateStr, PLANTA_DEFAULT } from '../../hooks/useDespachoBoard'

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

// ── DraggableCard ─────────────────────────────────────────────────────────────

const DraggableCard = memo(function DraggableCard({ item, routeNum, arrival, color, locked, onMoveUp, onMoveDown }: {
  item:      DayItem
  routeNum?: number
  arrival?:  string
  color?:    string
  locked?:   boolean
  onMoveUp?:   () => void
  onMoveDown?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.dndId })
  const isVisit = item.kind !== 'order'
  const showReorder = !locked && (onMoveUp || onMoveDown)

  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`border rounded-xl p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? 'opacity-30' : 'hover:shadow-md hover:-translate-y-0.5'
      } ${locked ? 'border-green-200 bg-green-50/40' : isVisit ? 'bg-violet-50 border-violet-200' : 'bg-white border-[#D3D1C7]'}`}
      style={{ touchAction: 'none' }}
    >
      <div className="flex items-start gap-2">
        {routeNum != null ? (
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold mt-0.5"
            style={{ backgroundColor: color ?? '#6b7280' }}
          >
            {routeNum}
          </span>
        ) : (
          <span className={`shrink-0 mt-0.5 ${isVisit ? 'text-violet-400' : 'text-gray-300'}`}>
            {isVisit ? <Eye size={14} /> : <Package size={14} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{item.label}</p>
            {locked && <Lock size={10} className="text-green-500 shrink-0" />}
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">{item.sublabel}</p>
          {item.kind === 'order' && (
            <p className="text-xs text-gray-600 mt-1">
              {/* products summary only available for orders */}
            </p>
          )}
          {item.kind === 'programa' && (
            <p className="text-[10px] text-violet-400 mt-0.5">↺ Visita recurrente</p>
          )}
          {arrival && <p className="text-[10px] text-accent font-medium mt-1">⏱ {arrival}</p>}
        </div>
        {showReorder && (
          <div className="flex flex-col shrink-0 -mt-1 -mr-1">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onMoveUp}
              disabled={!onMoveUp}
              title="Subir"
              className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-0 disabled:pointer-events-none transition-colors"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onMoveDown}
              disabled={!onMoveDown}
              title="Bajar"
              className="p-0.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-0 disabled:pointer-events-none transition-colors"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

// ── GhostCard ─────────────────────────────────────────────────────────────────

function GhostCard({ item }: { item: DayItem }) {
  return (
    <div className={`border-2 border-accent rounded-xl p-3 shadow-2xl rotate-1 w-52 ${
      item.kind !== 'order' ? 'bg-violet-50' : 'bg-white'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {item.kind !== 'order' ? <Eye size={13} className="text-violet-400" /> : <Package size={13} className="text-gray-400" />}
        <p className="text-sm font-semibold text-gray-900 leading-tight">{item.label}</p>
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

function SinAsignarColumn({ items }: { items: DayItem[] }) {
  const orders  = items.filter((i) => i.kind === 'order')
  const visitas = items.filter((i) => i.kind !== 'order')
  return (
    <div className="flex flex-col w-56 shrink-0 h-full">
      <div className="bg-[#F1EFE8] border border-[#D3D1C7] rounded-t-xl px-3 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-gray-700">Sin asignar</p>
        <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <DroppableZone id="sin_asignar" className="bg-[#F8F7F2] border border-t-0 border-[#D3D1C7] rounded-b-xl p-2 space-y-2 overflow-y-auto flex-1">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">Todo asignado ✓</p>
        ) : (
          <>
            {orders.length > 0 && orders.map((i) => <DraggableCard key={i.dndId} item={i} />)}
            {visitas.length > 0 && (
              <>
                {orders.length > 0 && <div className="border-t border-[#D3D1C7] my-1" />}
                {visitas.map((i) => <DraggableCard key={i.dndId} item={i} />)}
              </>
            )}
          </>
        )}
      </DroppableZone>
    </div>
  )
}

// ── ChoferColumn ──────────────────────────────────────────────────────────────

const ChoferColumn = memo(function ChoferColumn({ chofer, camiones, ayudantes, asignacion, onAsignacionChange, items, routeOrder, arrivals, recalculating, orsStatus, despacho, colorIdx, plantaId, horaSalida, catalogo, manualOrder, onPlantaChange, onHoraSalidaChange, onConfirm, onReopen, onTransfer, onManualReorder, onRecalculate }: {
  chofer:               UserProfile
  camiones:             Camion[]
  ayudantes:            UserProfile[]
  asignacion:           AsignacionChofer
  onAsignacionChange:   (email: string, patch: Partial<AsignacionChofer>) => void
  items:                DayItem[]
  routeOrder:           string[]
  arrivals:             Record<string, string>
  recalculating:        boolean
  orsStatus?:           { ok: boolean; error?: string }
  despacho?:            Despacho
  colorIdx:             number
  plantaId:             PlantaId
  horaSalida:           string
  catalogo:             CatalogProducto[]
  manualOrder:          boolean
  onPlantaChange:       (email: string, p: PlantaId) => void
  onHoraSalidaChange:   (email: string, h: string) => void
  onConfirm:            (email: string) => void
  onReopen:             (email: string) => void
  onTransfer:           (email: string) => void
  onManualReorder:      (email: string, newOrderIds: string[]) => void
  onRecalculate:        (email: string) => void
}) {
  const confirmed = despacho?.status === 'confirmado'
  const color     = choferColor(colorIdx)
  const nombre    = chofer.nombreContacto || chofer.nombre || chofer.email

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
    onManualReorder(chofer.email, reordered.map((i) => i.dndId))
  }

  const orderCount  = items.filter((i) => i.kind === 'order').length
  const visitCount  = items.filter((i) => i.kind !== 'order').length

  // ── Pallets ────────────────────────────────────────────────────────────────
  const selectedCamion = useMemo(() =>
    camiones.find((cam) => cam.id === asignacion.camionId),
  [camiones, asignacion.camionId])

  const capacidad = selectedCamion?.capacidadPallets ?? null

  const totalPallets = useMemo(() =>
    items
      .filter((i) => i.kind === 'order' && i.products)
      .reduce((sum, i) => sum + calcPallets(i.products ?? [], catalogo), 0),
  [items, catalogo])

  const palletsRatio  = capacidad ? totalPallets / capacidad : null
  const overloaded    = palletsRatio !== null && palletsRatio > 1
  const barColor      = overloaded ? '#ef4444' : (palletsRatio ?? 0) > 0.8 ? '#f97316' : '#22c55e'

  return (
    <div className="flex flex-col w-56 shrink-0 h-full">
      {/* Header */}
      <div className={`border rounded-t-xl px-3 py-2.5 ${confirmed ? 'bg-green-50 border-green-300' : 'bg-white border-[#D3D1C7]'}`}>
        <div className="flex items-center gap-2 mb-0.5">
          <Truck size={14} style={{ color }} className="shrink-0" />
          <p className="text-sm font-semibold text-gray-900 truncate flex-1">{nombre}</p>
          <div className="flex items-center gap-1 shrink-0">
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
          </div>
        </div>
        {/* Camión */}
        <select
          value={asignacion.camionId ?? ''}
          onChange={(e) => onAsignacionChange(chofer.email, { camionId: e.target.value || null })}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={confirmed}
          className="mt-1 w-full text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400 truncate"
        >
          <option value="">Sin camión</option>
          {camiones.filter((cam) => cam.activo).map((cam) => (
            <option key={cam.id} value={cam.id}>{cam.patente} — {cam.modelo}{cam.capacidadPallets ? ` (${cam.capacidadPallets}p)` : ''}</option>
          ))}
        </select>

        {/* Barra de pallets */}
        {(orderCount > 0 || capacidad !== null) && items.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
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

        {/* Ayudante */}
        <select
          value={asignacion.ayudanteEmail ?? ''}
          onChange={(e) => onAsignacionChange(chofer.email, { ayudanteEmail: e.target.value || null })}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={confirmed}
          className="mt-1 w-full text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400 truncate"
        >
          <option value="">Sin ayudante</option>
          {ayudantes.filter((a) => a.email !== chofer.email).map((a) => (
            <option key={a.email} value={a.email}>{a.nombreContacto || a.nombre || a.email}</option>
          ))}
        </select>

        {/* Planta y hora de salida */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <select
            value={plantaId}
            onChange={(e) => onPlantaChange(chofer.email, e.target.value as PlantaId)}
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
            onChange={(e) => onHoraSalidaChange(chofer.email, e.target.value)}
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
            onClick={() => onRecalculate(chofer.email)}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 hover:text-accent transition-colors"
          >
            <RotateCcw size={10} /> Recalcular ruta automática
          </button>
        )}
      </div>

      {/* Cards */}
      <DroppableZone
        id={chofer.email}
        className={`border border-t-0 p-2 space-y-2 overflow-y-auto flex-1 ${confirmed ? 'bg-green-50/40 border-green-200' : 'bg-white border-[#D3D1C7]'}`}
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
              onMoveUp={!confirmed && sortedItems.length > 1 && i > 0 ? () => moveItem(i, -1) : undefined}
              onMoveDown={!confirmed && sortedItems.length > 1 && i < sortedItems.length - 1 ? () => moveItem(i, 1) : undefined}
            />
          ))
        )}
      </DroppableZone>

      {/* Footer */}
      <div className={`border border-t-0 rounded-b-xl px-2 py-2 space-y-1.5 ${confirmed ? 'bg-green-50 border-green-200' : 'bg-white border-[#D3D1C7]'}`}>
        {confirmed ? (
          <button onClick={() => onReopen(chofer.email)} className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 py-1 transition-colors">
            <RotateCcw size={11} /> Reabrir despacho
          </button>
        ) : (
          <button
            onClick={() => onConfirm(chofer.email)}
            disabled={items.length === 0}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-accent text-white rounded-lg py-2 hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Lock size={11} /> Confirmar despacho
          </button>
        )}
        {items.length > 0 && (
          <button
            onClick={() => onTransfer(chofer.email)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 rounded-lg py-1.5 bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            <ArrowRightLeft size={11} /> Transferir paradas
          </button>
        )}
      </div>
    </div>
  )
})

// ── TransferModal ─────────────────────────────────────────────────────────────

function TransferModal({ fromDriver, fromDriverName, items, choferes, onClose, onTransfer }: {
  fromDriver:     string
  fromDriverName: string
  items:          DayItem[]
  choferes:       UserProfile[]
  onClose:        () => void
  onTransfer:     (selectedDndIds: string[], toDriver: string, motivo: string) => Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toDriver, setToDriver] = useState('')
  const [motivo,   setMotivo]   = useState('')
  const [loading,  setLoading]  = useState(false)

  const destChoferes = choferes.filter((c) => c.email !== fromDriver)

  const toggle = (dndId: string) =>
    setSelected((prev) => { const s = new Set(prev); if (s.has(dndId)) s.delete(dndId); else s.add(dndId); return s })

  const toggleAll = () =>
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.dndId)))

  const handleConfirm = async () => {
    if (selected.size === 0 || !toDriver) return
    setLoading(true)
    await onTransfer(Array.from(selected), toDriver, motivo)
    setLoading(false)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Transferir paradas" variant="light">
      <div className="space-y-4">

        {/* Origen */}
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          Reasignando desde <span className="font-semibold text-gray-900">{fromDriverName}</span>
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
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Chofer destino</label>
          <div className="grid grid-cols-2 gap-2">
            {destChoferes.map((c, idx) => {
              const nombre = c.nombreContacto || c.nombre || c.email
              const color  = choferColor(choferes.findIndex((ch) => ch.email === c.email))
              return (
                <button key={c.email} onClick={() => setToDriver(c.email)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                    toDriver === c.email ? 'border-accent bg-accent/5 font-semibold' : 'border-[#D3D1C7] bg-white hover:border-accent/40'
                  }`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="truncate">{nombre}</span>
                </button>
              )
            })}
          </div>
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
              {(() => { const c = choferes.find((ch) => ch.email === toDriver); return c?.nombreContacto || c?.nombre || toDriver })()}
            </span>
          </div>
        )}

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

      {/* Tablero */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 h-full p-4" style={{ minWidth: 'max-content' }}>

            <SinAsignarColumn items={itemsByDriver['sin_asignar'] ?? []} />

            {choferesPrincipales.map((c, idx) => (
              <ChoferColumn
                key={c.email}
                chofer={c}
                camiones={camiones}
                ayudantes={choferes}
                asignacion={asignacionesDia[c.email] ?? EMPTY_ASIGNACION}
                onAsignacionChange={handleAsignacionChange}
                items={itemsByDriver[c.email] ?? EMPTY_ITEMS}
                routeOrder={routeOrder[c.email] ?? EMPTY_ROUTE}
                arrivals={routeArrivals[c.email] ?? EMPTY_ARRIVALS}
                recalculating={!!recalculating[c.email]}
                orsStatus={orsStatus[c.email]}
                despacho={despachoByDriver[c.email]}
                colorIdx={idx}
                plantaId={plantaByDriver[c.email] ?? PLANTA_DEFAULT}
                horaSalida={horaSalidaByDriver[c.email] ?? '07:00'}
                catalogo={catalogo}
                manualOrder={!!manualOrder[c.email]}
                onPlantaChange={handlePlantaChange}
                onHoraSalidaChange={handleHoraSalidaChange}
                onConfirm={handleConfirmClick}
                onReopen={handleReopen}
                onTransfer={handleTransferClick}
                onManualReorder={handleManualReorder}
                onRecalculate={handleRecalculate}
              />
            ))}

            <DragOverlay dropAnimation={null}>
              {activeItem && <GhostCard item={activeItem} />}
            </DragOverlay>
          </div>
        </DndContext>
      </div>

      {/* Modal confirmar */}
      <Modal open={!!confirmingDriver} onClose={() => { if (!confirmLoading) setConfirmingDriver(null) }} title="Confirmar despacho" variant="light">
        {confirmingChofer && (
          <div className="space-y-4">
            <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-xl p-4 text-sm space-y-1.5">
              <p className="font-medium text-accent">{confirmingChofer.nombreContacto || confirmingChofer.nombre}</p>
              <p className="text-gray-600">{confirmingItems.length} parada{confirmingItems.length !== 1 ? 's' : ''} — {formatDespachoFecha(fecha)}</p>
              {(() => {
                const asig   = confirmingDriver ? asignacionesDia[confirmingDriver] : null
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
              ).map((item, i) => (
                <li key={item.dndId} className="flex items-center gap-2 text-sm">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: choferColor(choferes.findIndex((c) => c.email === confirmingDriver)) }}>
                    {i + 1}
                  </span>
                  {item.kind !== 'order' ? <Eye size={11} className="text-violet-400 shrink-0" /> : <Package size={11} className="text-gray-400 shrink-0" />}
                  <span className="text-gray-700 truncate">{item.label}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmingDriver(null)} className="flex-1 text-sm" disabled={confirmLoading}>Cancelar</Button>
              <Button onClick={() => handleConfirm(confirmingDriver!)} loading={confirmLoading} className="flex-1 text-sm">Confirmar y notificar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal transferir paradas */}
      {transferModal && (
        <TransferModal
          fromDriver={transferModal.fromDriver}
          fromDriverName={(() => { const c = choferes.find((ch) => ch.email === transferModal.fromDriver); return c?.nombreContacto || c?.nombre || transferModal.fromDriver })()}
          items={itemsByDriver[transferModal.fromDriver] ?? []}
          choferes={choferesPrincipales}
          onClose={() => setTransferModal(null)}
          onTransfer={handleTransfer}
        />
      )}

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
