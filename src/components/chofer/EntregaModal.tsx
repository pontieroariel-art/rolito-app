import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { Order, OrderProduct } from '../../types'

interface Props {
  order:     Order
  onConfirm: (entregados: OrderProduct[], parcial: boolean, nota: string) => Promise<void>
  onClose:   () => void
}

export default function EntregaModal({ order, onConfirm, onClose }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(order.products.map((p) => [p.name, p.quantity])),
  )
  const [nota,    setNota]    = useState('')
  const [saving,  setSaving]  = useState(false)

  const entregados: OrderProduct[] = order.products.map((p) => ({
    ...p,
    quantity: quantities[p.name] ?? p.quantity,
  }))

  const parcial = entregados.some((p) => {
    const original = order.products.find((o) => o.name === p.name)
    return original && p.quantity < original.quantity
  })

  const canConfirm = !parcial || nota.trim().length > 0

  const handleConfirm = async () => {
    setSaving(true)
    await onConfirm(entregados, parcial, nota.trim())
    setSaving(false)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Confirmar entrega — ${order.clientName}`}
    >
      <p className="text-xs text-gray-500 mb-4 truncate">{order.clientAddress}</p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {order.products.map((p) => {
          const qty      = quantities[p.name] ?? p.quantity
          const menos    = qty < p.quantity
          return (
            <div
              key={p.name}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border ${
                menos ? 'bg-orange-500/5 border-orange-500/30' : 'bg-[#F8F7F2] border-[#D3D1C7]'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                {menos && (
                  <p className="text-xs text-orange-400 mt-0.5">
                    Pedido: {p.quantity} — faltan {p.quantity - qty}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.name]: Math.max(0, (q[p.name] ?? p.quantity) - 1) }))}
                  disabled={qty === 0}
                  className="w-9 h-9 rounded-full border border-[#D3D1C7] text-xl hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-gray-600"
                >−</button>
                <input
                  type="number"
                  min={0}
                  max={p.quantity}
                  value={qty}
                  onChange={(e) => {
                    const v = Math.min(p.quantity, Math.max(0, parseInt(e.target.value) || 0))
                    setQuantities((q) => ({ ...q, [p.name]: v }))
                  }}
                  className={`w-12 text-center font-bold text-base rounded-lg border px-1 py-1 focus:outline-none focus:ring-1 focus:ring-accent ${
                    menos
                      ? 'text-orange-500 border-orange-300 bg-white'
                      : 'text-gray-900 border-[#D3D1C7] bg-white'
                  }`}
                />
                <button
                  onClick={() => setQuantities((q) => ({ ...q, [p.name]: Math.min(p.quantity, (q[p.name] ?? p.quantity) + 1) }))}
                  disabled={qty >= p.quantity}
                  className="w-9 h-9 rounded-full border border-[#D3D1C7] text-xl hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-gray-600"
                >+</button>
              </div>
            </div>
          )
        })}
      </div>

      {parcial && (
        <div className="mt-4 space-y-1.5">
          <label className="text-xs font-medium text-orange-400">
            Motivo de entrega parcial <span className="text-red-400">*</span>
          </label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder="Ej: Faltaban unidades en el camión, cliente rechazó parte..."
            className="w-full bg-[#F8F7F2] border border-orange-500/40 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button
          onClick={handleConfirm}
          loading={saving}
          disabled={!canConfirm}
          variant={parcial ? undefined : 'success'}
          className={`flex-1 ${parcial ? 'bg-orange-500 hover:bg-orange-400 text-white' : ''}`}
        >
          {parcial ? 'Entrega parcial' : '✓ Entregado'}
        </Button>
      </div>
    </Modal>
  )
}
