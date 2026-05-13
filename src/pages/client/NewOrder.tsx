import { useState, ChangeEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { summarizeProducts } from '../../utils/helpers'
import { useAuth } from '../../context/AuthContext'
import { createOrder } from '../../services/orderService'
import { getNotificationEmails } from '../../services/configService'
import { useNotifyPedidoRecibido, useNotifyAdminNuevoPedido } from '../../hooks/useNotifications'
import { useListaPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { getPrimaryAddress } from '../../types'

interface DisplayProduct {
  id:     string
  nombre: string
  unidad: string
  precio?: number
}

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
  const notifyPedidoRecibidoMutation    = useNotifyPedidoRecibido()
  const notifyAdminNuevoPedidoMutation  = useNotifyAdminNuevoPedido()

  const { lista }    = useListaPrecios(user?.listaPreciosId)
  const { catalogo } = useCatalogo()

  // Build the product list from price list (if assigned) or catalog fallback
  const listaItems = lista
    ? lista.items
        .filter((i) => i.activo)
        .map((i) => ({
          id:     i.productoId,
          nombre: i.nombre,
          unidad: i.unidad,
          precio: user?.preciosCustom?.[i.productoId] ?? i.precio,
        }))
    : []

  // Si la lista no tiene items activos, cae al catálogo sin precios
  const displayProducts: DisplayProduct[] = listaItems.length > 0
    ? listaItems
    : catalogo.map((p) => ({ id: p.id, nombre: p.nombre, unidad: p.unidad }))

  const selected = displayProducts
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({
      name:       p.nombre,
      quantity:   quantities[p.id],
      productoId: p.id,
      ...(p.precio !== undefined ? { price: p.precio } : {}),
    }))

  const total = selected.reduce(
    (acc, p) => acc + (p.price !== undefined ? p.price * p.quantity : 0),
    0,
  )
  const hasPrecios = selected.some((p) => p.price !== undefined)

  const primaryAddr    = user ? getPrimaryAddress(user) : null
  const deliveryAddress = primaryAddr?.address ?? user?.address ?? ''
  const canSubmit = selected.length > 0 && !!deliveryAddress

  const handleSubmit = async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      await createOrder({ user, products: selected, date, notes })

      // Fire-and-forget — no bloquean la navegación
      const nombre       = (user.nombreContacto || user.nombre || '').split(' ')[0] || 'Cliente'
      const clientName   = user.razonSocial   || user.nombre   || ''
      const clientPhone  = user.telefono      || user.phone    || ''

      notifyPedidoRecibidoMutation.mutate({
        email:    user.email,
        nombre,
        products: selected,
        date,
        notes:    notes || undefined,
      })

      getNotificationEmails().then((adminEmails) => {
        if (adminEmails.length > 0) {
          notifyAdminNuevoPedidoMutation.mutate({
            adminEmails,
            clientName,
            clientAddress: deliveryAddress,
            clientPhone,
            products:      selected,
            date,
            notes:         notes || undefined,
          })
        }
      }).catch(console.error)

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

        {!deliveryAddress && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm">
            <p className="text-yellow-400 font-medium">⚠ Sin dirección de entrega</p>
            <p className="text-yellow-400/70 mt-1">
              Agregá una dirección en{' '}
              <Link to="/perfil" className="underline hover:text-yellow-300">
                Mi perfil
              </Link>{' '}
              antes de hacer un pedido.
            </p>
          </div>
        )}

        {!lista && user?.listaPreciosId === undefined && catalogo.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-sm text-yellow-400">
            Sin lista de precios asignada — los precios se confirmarán con el administrador.
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-300 mb-3">Productos</h2>
          {displayProducts.map((p) => (
            <ProductRow
              key={p.id}
              nombre={p.nombre}
              unidad={p.unidad}
              precio={p.precio}
              qty={quantities[p.id] ?? 0}
              onChange={(qty) => setQty(p.id, qty)}
            />
          ))}
        </section>

        {selected.length > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 text-sm space-y-2">
            <p className="text-accent font-medium">Seleccionado:</p>
            <p className="text-white">{summarizeProducts(selected)}</p>
            {hasPrecios && total > 0 && (
              <div className="flex justify-between items-center pt-2 border-t border-accent/20">
                <span className="text-muted">Total estimado</span>
                <span className="text-white font-bold text-base">
                  ${total.toLocaleString('es-AR')}
                </span>
              </div>
            )}
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
                <span className="text-right max-w-[60%]">{deliveryAddress}</span>
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
  nombre,
  unidad,
  precio,
  qty,
  onChange,
}: {
  nombre:  string
  unidad:  string
  precio?: number
  qty:     number
  onChange: (qty: number) => void
}) {
  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    onChange(raw === '' ? 0 : Math.max(0, parseInt(raw, 10)))
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex justify-between items-center">
      <div>
        <p className="font-medium text-sm">{nombre}</p>
        {precio !== undefined && precio > 0 && (
          <p className="text-xs text-muted mt-0.5">
            ${precio.toLocaleString('es-AR')} / {unidad}
            {qty > 0 && (
              <span className="text-accent ml-2 font-medium">
                = ${(precio * qty).toLocaleString('es-AR')}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(qty - 1)}
          disabled={qty === 0}
          className="w-9 h-9 rounded-full bg-bg border border-border text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={qty > 0 ? String(qty) : ''}
          placeholder="0"
          onChange={handleInput}
          className="w-12 text-center font-bold text-lg bg-transparent border-b border-border focus:outline-none focus:border-accent text-white placeholder-muted"
        />
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
