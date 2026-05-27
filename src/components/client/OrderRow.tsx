import { useState, useCallback } from 'react'
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
  const [modal,   setModal]   = useState(false)
  const [motivo,  setMotivo]  = useState('')
  const [loading, setLoading] = useState(false)

  const canCancel = order.status === 'pendiente'

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
      <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{summarizeProducts(order.products)}</p>
          <p className="text-muted text-xs mt-1">Entrega: {formatShortDate(order.date)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canCancel && (
            <button
              onClick={() => { setMotivo(''); setModal(true) }}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 px-2.5 py-1 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          )}
          <Badge status={order.status} />
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Cancelar pedido">
        <div className="space-y-4">
          <p className="text-sm text-muted">¿Por qué querés cancelar este pedido?</p>
          <div className="space-y-2">
            {MOTIVOS_CANCEL.map((m) => (
              <button
                key={m}
                onClick={() => setMotivo(m)}
                className={`w-full text-left text-sm px-4 py-3 rounded-xl border transition-colors ${
                  motivo === m
                    ? 'bg-red-500/10 border-red-500/50 text-red-400'
                    : 'border-border text-muted hover:border-border/70 hover:text-white'
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
