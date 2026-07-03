import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { cancelOrder } from '../../services/orderService'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order } from '../../types'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Badge from '../ui/Badge'

const MOTIVOS_CANCEL = [
  'Ya no lo necesito',
  'Me equivoqué en el pedido',
  'Cambio de fecha',
  'Otro motivo',
]

export function OrderRow({ order }: { order: Order }) {
  const navigate               = useNavigate()
  const [modal,   setModal]   = useState(false)
  const [motivo,  setMotivo]  = useState('')
  const [loading, setLoading] = useState(false)

  const canCancel = order.status === 'pendiente'
  const canModify = order.status === 'pendiente'

  const handleCancel = useCallback(async () => {
    if (!motivo) return
    setLoading(true)
    try {
      await cancelOrder(order.id, motivo)
      setModal(false)
    } finally {
      setLoading(false)
    }
  }, [order.id, motivo])

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-gray-900 truncate">{summarizeProducts(order.products)}</p>
          <p className="text-gray-500 text-xs mt-1">Entrega: {formatShortDate(order.date)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canModify && (
            <button
              onClick={() => navigate('/nuevo-pedido', { state: { modifyOrder: order } })}
              className="text-xs text-accent hover:text-accent/80 border border-accent/30 hover:border-accent/50 px-2.5 py-1 rounded-lg transition-colors"
            >
              Modificar
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => { setMotivo(''); setModal(true) }}
              className="text-xs text-red-500 hover:text-red-600 border border-red-200 hover:border-red-300 px-2.5 py-1 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          )}
          <Badge status={order.status} variant="light" />
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Cancelar pedido">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">¿Por qué querés cancelar este pedido?</p>
          <div className="space-y-2">
            {MOTIVOS_CANCEL.map((m) => (
              <button
                key={m}
                onClick={() => setMotivo(m)}
                className={`w-full text-left text-sm px-4 py-3 rounded-xl border transition-colors ${
                  motivo === m
                    ? 'bg-red-50 border-red-300 text-red-600'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setModal(false)} className="flex-1 text-sm">Volver</Button>
            <Button
              onClick={handleCancel}
              loading={loading}
              disabled={!motivo}
              className="flex-1 text-sm !bg-red-600 hover:!bg-red-500"
            >
              Confirmar cancelación
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
