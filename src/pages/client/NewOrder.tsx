import { useState, ChangeEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useBranch } from '../../context/BranchContext'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { summarizeProducts, formatShortDate } from '../../utils/helpers'
import { useAuth } from '../../context/AuthContext'
import { Order } from '../../types'
import { createOrder, cancelAndRecreateOrder } from '../../services/orderService'
import { getNotificationEmails } from '../../services/configService'
import { useNotifyPedidoRecibido, useNotifyAdminNuevoPedido } from '../../hooks/useNotifications'
import { useListaPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { getPrimaryAddress } from '../../types'
import { tsToDate } from '../../utils/helpers'

interface DisplayProduct {
  id:     string
  nombre: string
  unidad: string
  precio?: number
}

export default function NewOrder() {
  const { user }               = useAuth()
  const { selectedAddress }    = useBranch()
  const navigate               = useNavigate()
  const location               = useLocation()
  const state       = location.state as { repeatOrder?: Order; modifyOrder?: Order } | null
  const repeatOrder = state?.repeatOrder
  const modifyOrder = state?.modifyOrder
  const prefillOrder = modifyOrder ?? repeatOrder
  const today    = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    if (!prefillOrder) return {}
    const q: Record<string, number> = {}
    for (const p of prefillOrder.products) {
      if (p.productoId) q[p.productoId] = p.quantity
    }
    return q
  })
  const [date,      setDate]      = useState(modifyOrder ? toDateInput(tsToDate(modifyOrder.date)) : tomorrow)
  const [notes,     setNotes]     = useState(modifyOrder?.notes ?? '')
  const [modal,     setModal]     = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [esUrgente, setEsUrgente] = useState(false)
  const notifyPedidoRecibidoMutation    = useNotifyPedidoRecibido()
  const notifyAdminNuevoPedidoMutation  = useNotifyAdminNuevoPedido()

  const { lista }    = useListaPrecios(user?.listaPreciosId)
  const { catalogo } = useCatalogo()

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

  const primaryAddr     = user ? getPrimaryAddress(user) : null
  const deliveryAddress = selectedAddress?.address ?? primaryAddr?.address ?? user?.address ?? ''
  const deliveryNombre  = selectedAddress?.nombre ?? primaryAddr?.nombre
  const canSubmit = selected.length > 0 && !!deliveryAddress

  const handleSubmit = async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const orderParams = { user, products: selected, date, notes, address: deliveryAddress, esUrgente: esUrgente || undefined }
      if (modifyOrder) {
        await cancelAndRecreateOrder(modifyOrder.id, orderParams)
      } else {
        await createOrder(orderParams)
      }

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

      // Awaitar antes de navegar para que mutate se llame con el componente montado
      try {
        const adminEmails = await getNotificationEmails()
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
      } catch { /* no bloquear la creación del pedido si falla la notificación */ }

      navigate('/dashboard')
    } catch {
      setError(modifyOrder ? 'Error al modificar el pedido. Intentá de nuevo.' : 'Error al crear el pedido. Intentá de nuevo.')
      setLoading(false)
    }
  }

  const setQty = (id: string, qty: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, qty) }))

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{modifyOrder ? 'Modificar pedido' : 'Nuevo pedido'}</h1>
          {deliveryNombre ? (
            <p className="text-accent text-sm mt-1 font-medium">📍 {deliveryNombre}</p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">Seleccioná los productos que necesitás</p>
          )}
        </div>

        {modifyOrder && (
          <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-2xl px-4 py-3">
            <p className="text-xs text-accent font-medium">Modificando pedido del {formatShortDate(modifyOrder.date)}</p>
            <p className="text-sm text-gray-900 truncate mt-0.5">{summarizeProducts(modifyOrder.products)}</p>
            <p className="text-xs text-gray-500 mt-1">Al confirmar, este pedido se cancela y se crea uno nuevo con los cambios.</p>
          </div>
        )}

        {repeatOrder && !modifyOrder && (
          <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-accent font-medium">Repetir pedido del {formatShortDate(repeatOrder.date)}</p>
              <p className="text-sm text-gray-900 truncate mt-0.5">{summarizeProducts(repeatOrder.products)}</p>
            </div>
            <button
              onClick={() => setQuantities({})}
              className="text-xs text-gray-400 hover:text-gray-700 shrink-0 transition-colors"
            >
              Limpiar
            </button>
          </div>
        )}

        {!deliveryAddress && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm">
            <p className="text-amber-700 font-medium">⚠ Sin dirección de entrega</p>
            <p className="text-amber-600/80 mt-1">
              Agregá una dirección en{' '}
              <Link to="/perfil" className="underline hover:text-amber-700">
                Mi perfil
              </Link>{' '}
              antes de hacer un pedido.
            </p>
          </div>
        )}

        {!lista && user?.listaPreciosId === undefined && catalogo.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-700">
            Sin lista de precios asignada — los precios se confirmarán con el administrador.
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide">Productos</h2>
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
          <div className="bg-[#E8F5F0] border border-[#B3DDD3] rounded-2xl p-4 text-sm space-y-2">
            <p className="text-accent font-medium">Seleccionado:</p>
            <p className="text-gray-900">{summarizeProducts(selected)}</p>
            {hasPrecios && total > 0 && (
              <div className="flex justify-between items-center pt-2 border-t border-[#B3DDD3]">
                <span className="text-gray-500">Total estimado</span>
                <span className="text-gray-900 font-bold text-base">
                  ${total.toLocaleString('es-AR')}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Fecha de entrega</label>
            <input
              type="date"
              value={date}
              min={esUrgente ? today : tomorrow}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-gray-400">Los pedidos requieren al menos 24 hs de anticipación.</p>
          </div>

          {/* Toggle urgente */}
          <button
            type="button"
            onClick={() => {
              const next = !esUrgente
              setEsUrgente(next)
              if (!next && date < tomorrow) setDate(tomorrow)
            }}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 border text-sm transition-colors text-left ${
              esUrgente
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <span className="text-lg shrink-0">⚡</span>
            <div>
              <p className="font-medium">Pedido urgente</p>
              <p className="text-xs opacity-70">
                {esUrgente
                  ? 'Activado — logística será notificada. La entrega queda sujeta a disponibilidad.'
                  : 'Necesito entrega en menos de 24 hs'}
              </p>
            </div>
            <div className={`ml-auto w-9 h-5 rounded-full transition-colors shrink-0 ${esUrgente ? 'bg-red-500' : 'bg-gray-300'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${esUrgente ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </button>

          {esUrgente && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
              ⚠ El pedido urgente <strong>no garantiza la entrega</strong>. Logística evaluará la disponibilidad y te confirmará a la brevedad.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            rows={3}
            placeholder="Horario preferido, instrucciones especiales..."
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <Button
          onClick={() => setModal(true)}
          disabled={!canSubmit}
          className="w-full py-3.5"
        >
          {modifyOrder ? 'Revisar y confirmar modificación' : 'Revisar y confirmar pedido'}
        </Button>

        <Modal open={modal} onClose={() => setModal(false)} title={modifyOrder ? 'Confirmar modificación' : 'Confirmar pedido'}>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Productos</p>
              <div className="space-y-1">
                {selected.map((p) => (
                  <div key={p.name} className="flex justify-between text-gray-900">
                    <span>{p.name}</span>
                    <span className="text-accent font-medium">x{p.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2">
              {esUrgente && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <span>⚡</span>
                  <span className="text-xs text-red-700 font-medium">Pedido urgente — sujeto a disponibilidad</span>
                </div>
              )}
              <div className="flex justify-between text-gray-900">
                <span className="text-gray-500">Dirección</span>
                <span className="text-right max-w-[60%]">{deliveryAddress}</span>
              </div>
              <div className="flex justify-between text-gray-900">
                <span className="text-gray-500">Fecha</span>
                <span>{new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}</span>
              </div>
              {notes && (
                <div className="flex justify-between text-gray-900">
                  <span className="text-gray-500">Notas</span>
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
              {modifyOrder ? 'Confirmar modificación' : 'Enviar pedido'}
            </Button>
          </div>
        </Modal>
      </main>
    </div>
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
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex justify-between items-center">
      <div>
        <p className="font-medium text-sm text-gray-900">{nombre}</p>
        {precio !== undefined && precio > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
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
          className="w-9 h-9 rounded-full bg-white border border-gray-200 text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-gray-600"
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
          className="w-12 text-center font-bold text-lg bg-transparent border-b border-gray-200 focus:outline-none focus:border-accent text-gray-900 placeholder-gray-300"
        />
        <button
          onClick={() => onChange(qty + 1)}
          className="w-9 h-9 rounded-full bg-white border border-gray-200 text-lg hover:border-accent transition-colors flex items-center justify-center text-gray-600"
        >
          +
        </button>
      </div>
    </div>
  )
}
