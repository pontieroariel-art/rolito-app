import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { cancelOrderBy } from '@/services/orderService'
import { Order } from '@/types'

export default function CancelOrderModal({ order, onClose, onCancelled }: { order: Order; onClose: () => void; onCancelled: () => void }) {
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
