import { useState } from 'react'
import { AlertTriangle, Eye, Package, ArrowRightLeft } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Camion, UserProfile } from '../../types'
import { DayItem } from '../../hooks/useDespachoBoard'
import { choferColor } from '../../utils/choferColor'

export default function TransferOrderModal({ fromDriver, fromDriverName, fromCamionLabel, items, destinos, onClose, onTransfer }: {
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
