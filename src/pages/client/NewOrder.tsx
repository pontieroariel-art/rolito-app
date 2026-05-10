import { useState, ChangeEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { PRODUCTS } from '../../utils/constants'
import { summarizeProducts } from '../../utils/helpers'
import { useAuth } from '../../context/AuthContext'
import { createOrder } from '../../services/orderService'
import { Product } from '../../types'

export default function NewOrder() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const today     = new Date().toISOString().split('T')[0]

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [date, setDate]       = useState(today)
  const [notes, setNotes]     = useState('')
  const [modal, setModal]     = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const selected = PRODUCTS
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({ name: p.name, quantity: quantities[p.id] }))

  const canSubmit = selected.length > 0 && !!user?.address

  const handleSubmit = async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      await createOrder({ user, products: selected, date, notes })
      navigate('/dashboard')
    } catch {
      setError('Error al crear el pedido. Intentá de nuevo.')
      setLoading(false)
    }
  }

  const setQty = (id: string, qty: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, qty) }))

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Nuevo pedido</h1>
          <p className="text-muted text-sm mt-1">Seleccioná los productos que necesitás</p>
        </div>

        {!user?.address && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
            <p className="text-yellow-400 font-medium">⚠ Sin dirección de entrega</p>
            <p className="text-yellow-400/70 mt-1">
              Agregá tu dirección en{' '}
              <Link to="/perfil" className="underline hover:text-yellow-300">
                Mi perfil
              </Link>{' '}
              antes de hacer un pedido.
            </p>
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-300 mb-3">Productos</h2>
          {PRODUCTS.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              qty={quantities[p.id] ?? 0}
              onChange={(qty) => setQty(p.id, qty)}
            />
          ))}
        </section>

        {selected.length > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 text-sm">
            <p className="text-accent font-medium mb-1">Seleccionado:</p>
            <p className="text-white">{summarizeProducts(selected)}</p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Fecha de entrega</label>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            rows={3}
            placeholder="Horario preferido, instrucciones especiales..."
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white placeholder-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <Button
          onClick={() => setModal(true)}
          disabled={!canSubmit}
          className="w-full"
        >
          Revisar y confirmar pedido
        </Button>

        <Modal open={modal} onClose={() => setModal(false)} title="Confirmar pedido">
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-muted text-xs uppercase tracking-wide mb-2">Productos</p>
              <div className="space-y-1">
                {selected.map((p) => (
                  <div key={p.name} className="flex justify-between">
                    <span>{p.name}</span>
                    <span className="text-accent font-medium">x{p.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted">Dirección</span>
                <span className="text-right max-w-[60%]">{user?.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Fecha</span>
                <span>{new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}</span>
              </div>
              {notes && (
                <div className="flex justify-between">
                  <span className="text-muted">Notas</span>
                  <span className="text-right max-w-[60%] italic">{notes}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            <Button variant="outline" onClick={() => setModal(false)} className="flex-1">
              Editar
            </Button>
            <Button onClick={handleSubmit} loading={loading} className="flex-1">
              Enviar pedido
            </Button>
          </div>
        </Modal>
      </main>
    </>
  )
}

function ProductRow({
  product,
  qty,
  onChange,
}: {
  product: Product
  qty: number
  onChange: (qty: number) => void
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-center">
      <span className="font-medium text-sm">{product.name}</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(qty - 1)}
          disabled={qty === 0}
          className="w-9 h-9 rounded-full bg-bg border border-border text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center"
        >
          −
        </button>
        <span className="w-6 text-center font-bold text-lg">{qty}</span>
        <button
          onClick={() => onChange(qty + 1)}
          className="w-9 h-9 rounded-full bg-bg border border-border text-lg hover:border-accent transition-colors flex items-center justify-center"
        >
          +
        </button>
      </div>
    </div>
  )
}
