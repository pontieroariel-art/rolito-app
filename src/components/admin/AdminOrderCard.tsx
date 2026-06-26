import { useState, ChangeEvent } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { updateOrderStatus, assignDriver, updateOrderAddress, cancelOrder } from '../../services/orderService'
import { getPushSubscription, getPushSubscriptionByEmail } from '../../services/userService'
import { sendPush } from '../../services/notificationService'
import { useNotifyConfirmado, useNotifyEnCamino } from '../../hooks/useNotifications'
import { STATUS_FLOW, STATUS_LABELS } from '../../utils/constants'
import { formatShortDate, summarizeProducts, tsToDate } from '../../utils/helpers'
import { Order, OrderStatus, UserProfile, AccionHistorial } from '../../types'
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
  const [histOpen,       setHistOpen]       = useState(false)
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

  const handleDriverSelect = async (val: string) => {
    const driverId = val === '__none__' ? null : val
    await assignDriver(order.id, driverId)
    if (driverId) {
      getPushSubscriptionByEmail(driverId).then((sub) => {
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
      <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-gray-900">{order.clientName}</p>
              {order.esUrgente && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 font-bold animate-pulse">⚡ URGENTE</span>
              )}
              {order.origenPdf && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#E8F5F0] text-accent border border-[#B3DDD3] font-medium">OC</span>
              )}
              {order.origenRecurrente && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200 font-medium">↺ Recurrente</span>
              )}
            </div>
            <p className="text-gray-500 text-xs">
              {order.numeroOC ? `#${order.numeroOC}` : (order.clientPhone || 'Sin teléfono')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={order.status} variant="light" />
            <span className="text-xs text-gray-400">{formatShortDate(order.date)}</span>
          </div>
        </div>

        <div className="text-sm">
          {editingAddress ? (
            <div className="flex gap-2">
              <input
                value={newAddress}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewAddress(e.target.value)}
                aria-label="Nueva dirección"
                className="bg-white border border-[#D3D1C7] rounded px-2 py-1 text-gray-900 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button onClick={handleSaveAddress} className="text-accent text-xs hover:underline">Guardar</button>
              <button onClick={() => setEditingAddress(false)} className="text-gray-400 text-xs hover:underline">Cancelar</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-gray-500 text-xs">📍 {order.clientAddress}</p>
              <button onClick={() => setEditingAddress(true)} className="text-accent text-xs hover:underline">Editar</button>
            </div>
          )}
        </div>

        <p className="text-sm text-gray-900">{summarizeProducts(order.products)}</p>

        {order.horaEntrega && (
          <p className="text-xs text-gray-500">Entrega: <span className="text-gray-900">{order.horaEntrega}</span></p>
        )}
        {order.notes && <p className="text-xs text-gray-500 italic">"{order.notes}"</p>}

        <div className="pt-3 border-t border-gray-100 space-y-2">
          {['entregado', 'cancelado'].includes(order.status) ? (
            <span className="text-xs text-gray-500 block">
              Chofer: <span className="text-gray-900">{order.driverId ?? '—'}</span>
            </span>
          ) : (
            <Select value={order.driverId ?? '__none__'} onValueChange={handleDriverSelect}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin chofer asignado</SelectItem>
                {choferes.map((c) => (
                  <SelectItem key={c.uid} value={c.email}>{c.nombre || c.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!['cancelado', 'entregado'].includes(order.status) && (
            <div className="flex gap-2">
              {next && (
                <Button onClick={() => handleStatus(next)} loading={statusLoading} className="text-xs py-1.5 px-3 flex-1">
                  → {STATUS_LABELS[next]}
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => { setCancelMotivo(''); setCancelModal(true) }}
                disabled={statusLoading}
                className="text-xs py-1.5 px-3 flex-1"
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>

        {order.motivoCancelacion && (
          <p className="text-xs text-red-500 italic border-t border-gray-100 pt-2">
            Motivo: {order.motivoCancelacion}
          </p>
        )}

        {order.historialAcciones && order.historialAcciones.length > 0 && (
          <div className="border-t border-gray-100 pt-2">
            <button
              onClick={() => setHistOpen((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              Historial de cambios ({order.historialAcciones.length}) {histOpen ? '▲' : '▼'}
            </button>
            {histOpen && (
              <div className="mt-2 space-y-2">
                {[...order.historialAcciones].reverse().map((h: AccionHistorial, i: number) => {
                  const ts    = tsToDate(h.timestamp)
                  const fecha = ts.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
                  const hora  = ts.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                  const label = h.accion === 'cancelado' ? 'canceló el pedido' : h.accion === 'modificado' ? 'modificó el pedido' : h.accion
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
                      <span className="text-gray-400 shrink-0 tabular-nums">{fecha} {hora}</span>
                      <span className="text-accent font-semibold shrink-0">{h.usuarioNombre}</span>
                      <span className="text-gray-500">{label}{h.detalle && h.detalle !== 'null' ? ` — ${h.detalle}` : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {cancelModal && (
        <Modal open onClose={() => setCancelModal(false)} title="Cancelar pedido">
          <p className="text-sm text-gray-500 mb-4">
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
                      ? 'bg-red-50 border-red-300 text-red-600'
                      : 'border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500'
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
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
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
