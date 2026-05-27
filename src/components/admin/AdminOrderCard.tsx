import { useState, ChangeEvent } from 'react'
import { updateOrderStatus, assignDriver, updateOrderAddress, cancelOrder } from '../../services/orderService'
import { getPushSubscription, getPushSubscriptionByEmail } from '../../services/userService'
import { sendPush } from '../../services/notificationService'
import { useNotifyConfirmado, useNotifyEnCamino } from '../../hooks/useNotifications'
import { STATUS_FLOW, STATUS_LABELS } from '../../utils/constants'
import { formatShortDate, summarizeProducts } from '../../utils/helpers'
import { Order, OrderStatus, UserProfile } from '../../types'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Badge from '../ui/Badge'

const MOTIVOS_CANCELACION = [
  'Solicitud del cliente',
  'Error en el pedido',
  'Producto no disponible',
  'Cliente no disponible',
  'Fuera de zona',
]

interface AdminOrderCardProps {
  order:    Order
  choferes: UserProfile[]
}

export function AdminOrderCard({ order, choferes }: AdminOrderCardProps) {
  const [statusLoading,  setStatusLoading]  = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [newAddress,     setNewAddress]     = useState(order.clientAddress)
  const [cancelModal,    setCancelModal]    = useState(false)
  const [cancelMotivo,   setCancelMotivo]   = useState('')
  const [cancelLoading,  setCancelLoading]  = useState(false)
  const notifyConfirmadoMutation = useNotifyConfirmado()
  const notifyEnCaminoMutation   = useNotifyEnCamino()

  const getNextStatus = (): OrderStatus | null => {
    const idx = STATUS_FLOW.indexOf(order.status)
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null
  }

  const handleStatus = async (newStatus: string) => {
    setStatusLoading(true)
    await updateOrderStatus(order.id, newStatus)
    const nombre = (order.clientName || '').split(' ')[0] || 'Cliente'
    if (newStatus === 'confirmado' && order.clientEmail) {
      const dateStr = order.date?.toDate ? order.date.toDate().toISOString().split('T')[0] : ''
      notifyConfirmadoMutation.mutate({ email: order.clientEmail, nombre, products: order.products, date: dateStr })
      if (order.clientId) {
        getPushSubscription(order.clientId).then((sub) => {
          if (sub) sendPush({ subscription: sub, title: 'Tu pedido fue confirmado ✅', body: summarizeProducts(order.products) })
        }).catch(console.error)
      }
    }
    if (newStatus === 'en_camino' && order.clientEmail) {
      notifyEnCaminoMutation.mutate({ email: order.clientEmail, nombre, products: order.products })
      if (order.clientId) {
        getPushSubscription(order.clientId).then((sub) => {
          if (sub) sendPush({ subscription: sub, title: 'Tu pedido está en camino 🚛', body: summarizeProducts(order.products) })
        }).catch(console.error)
      }
    }
    setStatusLoading(false)
  }

  const handleDriver = async (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || null
    await assignDriver(order.id, val)
    if (val) {
      getPushSubscriptionByEmail(val).then((sub) => {
        if (sub) sendPush({ subscription: sub, title: 'Nuevo pedido asignado', body: `${order.clientName} — ${formatShortDate(order.date)}` })
      }).catch(console.error)
    }
  }

  const handleSaveAddress = async () => {
    await updateOrderAddress(order.id, newAddress)
    setEditingAddress(false)
  }

  const next = getNextStatus()

  return (
    <>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{order.clientName}</p>
              {order.origenPdf && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 font-medium">OC</span>
              )}
              {order.origenRecurrente && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium">↺ Recurrente</span>
              )}
            </div>
            <p className="text-muted text-xs">
              {order.numeroOC ? `#${order.numeroOC}` : (order.clientPhone || 'Sin teléfono')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={order.status} />
            <span className="text-xs text-muted">{formatShortDate(order.date)}</span>
          </div>
        </div>

        <div className="text-sm">
          {editingAddress ? (
            <div className="flex gap-2">
              <input
                value={newAddress}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewAddress(e.target.value)}
                aria-label="Nueva dirección"
                className="bg-bg border border-border rounded px-2 py-1 text-white text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button onClick={handleSaveAddress} className="text-success text-xs hover:underline">Guardar</button>
              <button onClick={() => setEditingAddress(false)} className="text-muted text-xs hover:underline">Cancelar</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-muted text-xs">📍 {order.clientAddress}</p>
              <button onClick={() => setEditingAddress(true)} className="text-accent text-xs hover:underline">Editar</button>
            </div>
          )}
        </div>

        <p className="text-sm text-white">{summarizeProducts(order.products)}</p>

        {order.horaEntrega && (
          <p className="text-xs text-muted">Entrega: <span className="text-white">{order.horaEntrega}</span></p>
        )}
        {order.notes && <p className="text-xs text-muted italic">"{order.notes}"</p>}

        <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-border">
          {['entregado', 'cancelado'].includes(order.status) ? (
            <span className="text-xs text-muted flex-1 min-w-40">
              Chofer: <span className="text-white">{order.driverId ?? '—'}</span>
            </span>
          ) : (
            <select
              value={order.driverId ?? ''}
              onChange={handleDriver}
              aria-label="Asignar chofer"
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
            >
              <option value="">Sin chofer asignado</option>
              {choferes.map((c) => (
                <option key={c.uid} value={c.email}>{c.nombre || c.email}</option>
              ))}
            </select>
          )}

          {next && (
            <Button onClick={() => handleStatus(next)} loading={statusLoading} className="text-xs py-1.5 px-3">
              → {STATUS_LABELS[next]}
            </Button>
          )}

          {!['cancelado', 'entregado'].includes(order.status) && (
            <Button
              variant="danger"
              onClick={() => { setCancelMotivo(''); setCancelModal(true) }}
              disabled={statusLoading}
              className="text-xs py-1.5 px-3"
            >
              Cancelar
            </Button>
          )}
        </div>

        {order.motivoCancelacion && (
          <p className="text-xs text-red-400 italic border-t border-border pt-2">
            Motivo: {order.motivoCancelacion}
          </p>
        )}
      </div>

      {cancelModal && (
        <Modal open onClose={() => setCancelModal(false)} title="Cancelar pedido">
          <p className="text-sm text-muted mb-4">
            {order.clientName} — {summarizeProducts(order.products)}
          </p>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_CANCELACION.map((m) => (
                <button
                  key={m}
                  onClick={() => setCancelMotivo(m)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    cancelMotivo === m
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : 'border-border text-muted hover:border-red-500/40 hover:text-red-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <textarea
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
              rows={2}
              placeholder="O escribí el motivo..."
              aria-label="Motivo de cancelación"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          <div className="flex gap-3 mt-5">
            <Button variant="outline" onClick={() => setCancelModal(false)} className="flex-1">Volver</Button>
            <Button
              variant="danger"
              loading={cancelLoading}
              disabled={!cancelMotivo.trim()}
              className="flex-1"
              onClick={async () => {
                setCancelLoading(true)
                await cancelOrder(order.id, cancelMotivo.trim())
                setCancelLoading(false)
                setCancelModal(false)
              }}
            >
              Confirmar cancelación
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
