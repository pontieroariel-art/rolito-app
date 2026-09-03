import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { rescheduleOrder } from '../../services/orderService'
import { useNotifyReprogramado } from '../../hooks/useNotifications'
import { esperarOEncolar } from '@/services/observability'
import { Order, MOTIVOS_INCIDENCIA } from '../../types'
import { todayString, addDaysStr } from '../../utils/helpers'

interface Props {
  order:   Order
  onDone:  () => void
  onClose: () => void
}

function tomorrow(): string {
  return addDaysStr(todayString(), 1)
}

export default function NoEntregadoModal({ order, onDone, onClose }: Props) {
  const [motivo, setMotivo] = useState<string>(MOTIVOS_INCIDENCIA[0])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const notifyReprogramadoMutation = useNotifyReprogramado()

  const handleConfirm = async () => {
    setError('')
    setSaving(true)
    try {
      // Sin señal el write queda encolado; no clavar al chofer en el spinner.
      await esperarOEncolar(
        rescheduleOrder(order.id, tomorrow(), motivo, {
          fechaOriginal:  order.date,
          choferOriginal: order.driverId ?? undefined,
        }),
        { origen: 'NoEntregadoModal', accion: 'rescheduleOrder', orderId: order.id },
      )
      if (order.clientEmail) {
        notifyReprogramadoMutation.mutate({ orderId: order.id })
      }
      onDone()
    } catch {
      setError('No se pudo reprogramar el pedido. Revisá tu conexión y reintentá.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`No entregado — ${order.clientName}`}>
      <p className="text-sm text-gray-600 mb-4">
        El pedido pasa automáticamente a mañana y queda disponible para reasignar. Elegí el motivo:
      </p>

      <select
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {MOTIVOS_INCIDENCIA.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button
          onClick={handleConfirm}
          loading={saving}
          className="flex-1 bg-amber-600 hover:bg-amber-500 text-white"
        >
          Confirmar
        </Button>
      </div>
    </Modal>
  )
}
