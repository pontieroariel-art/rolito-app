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
  // Sin preselección (2026-09-13): con "Tiempo insuficiente" ya marcado, el
  // chofer confirmaba sin mirar y el motivo no decía nada. Ahora lo elige, y
  // con 'Otro' escribe qué pasó.
  const [motivo, setMotivo] = useState<string>('')
  const [nota,   setNota]   = useState('')
  const motivoFinal = motivo === 'Otro' ? `Otro: ${nota.trim()}` : motivo
  const listo = motivo !== '' && (motivo !== 'Otro' || nota.trim().length > 0)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const notifyReprogramadoMutation = useNotifyReprogramado()

  const handleConfirm = async () => {
    if (!listo) { setError(motivo === 'Otro' ? 'Escribí qué pasó.' : 'Elegí el motivo.'); return }
    setError('')
    setSaving(true)
    try {
      // Sin señal el write queda encolado; no clavar al chofer en el spinner.
      await esperarOEncolar(
        rescheduleOrder(order.id, tomorrow(), motivoFinal, {
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

      {/* 44 px de alto: se toca en la calle, con una mano. */}
      <select
        value={motivo}
        onChange={(e) => { setMotivo(e.target.value); setError('') }}
        className="w-full h-11 bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 text-base text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Elegí el motivo…</option>
        {MOTIVOS_INCIDENCIA.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      {motivo === 'Otro' && (
        <textarea
          value={nota} onChange={(e) => { setNota(e.target.value); setError('') }} rows={2} autoFocus
          placeholder="Qué pasó (obligatorio)"
          className="mt-3 w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
        />
      )}

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
          disabled={!listo}
          className="flex-1 bg-amber-600 hover:bg-amber-500 text-white"
        >
          Confirmar
        </Button>
      </div>
    </Modal>
  )
}
