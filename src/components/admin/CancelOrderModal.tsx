import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { cancelOrderBy } from '@/services/orderService'
import { MOTIVOS_CANCELACION, Order } from '@/types'
import { reportError } from '@/services/observability'

export default function CancelOrderModal({ order, onClose, onCancelled }: { order: Order; onClose: () => void; onCancelled: () => void }) {
  const { user }   = useAuth()
  const [motivo, setMotivo] = useState('')
  const [nota,   setNota]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  // Motivo obligatorio (2026-09-13): antes "Sin motivo" era el default y
  // terminó siendo el 100 % de los cancelados. 'Otro' exige decir qué pasó.
  const motivoFinal = motivo === 'Otro' ? nota.trim() : motivo
  const listo = motivo !== '' && (motivo !== 'Otro' || nota.trim().length > 0)

  const handleCancel = async () => {
    if (!user || !listo) return
    setSaving(true)
    setError('')
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    try {
      await cancelOrderBy(order.id, motivoFinal, actor)
      onCancelled()
      onClose()
    } catch (err) {
      reportError(err, { origen: 'CancelOrderModal' })
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
        <div className="space-y-2">
          <label className="text-xs font-semibold text-secundario uppercase tracking-wide block">Motivo</label>
          <select
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
            className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Elegí por qué se cancela…</option>
            {MOTIVOS_CANCELACION.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {motivo === 'Otro' && (
            <textarea
              value={nota} onChange={(e) => setNota(e.target.value)} rows={2} autoFocus
              placeholder="Qué pasó (obligatorio)"
              className="w-full border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          )}
        </div>
        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-secundario hover:bg-gray-50 transition-colors">
            Volver
          </button>
          <button onClick={handleCancel} disabled={saving || !listo}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors">
            {saving ? 'Cancelando...' : 'Sí, cancelar pedido'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
