import { useState } from 'react'
import { Minus, Plus, XCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useCatalogo } from '@/hooks/useCatalogo'
import { editOrderBy } from '@/services/orderService'
import { tsToDate } from '@/utils/helpers'
import { PRODUCTS } from '@/utils/constants'
import { Order, OrderProduct, AccionHistorial } from '@/types'
import { reportError } from '@/services/observability'

export default function EditOrderModal({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()
  // Catálogo completo desde Firestore. Si aún no cargó, cae a la lista base
  // hardcodeada (evita quedarse sin productos para agregar).
  const disponibles = catalogo.length > 0
    ? catalogo.map((c) => ({ id: c.id, nombre: c.nombre }))
    : PRODUCTS.map((p) => ({ id: p.id, nombre: p.name }))
  const [products,    setProducts]    = useState<OrderProduct[]>(order.products.map((p) => ({ ...p })))
  const [date,        setDate]        = useState(order.date?.toDate ? order.date.toDate().toISOString().split('T')[0] : '')
  const [horaEntrega, setHoraEntrega] = useState(order.horaEntrega ?? '')
  const [notes,       setNotes]       = useState(order.notes ?? '')
  const [numeroOC,    setNumeroOC]    = useState(order.numeroOC ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const updateQty = (name: string, qty: number) => {
    if (qty < 1) { removeProduct(name); return }
    setProducts((prev) => prev.map((p) => p.name === name ? { ...p, quantity: qty } : p))
  }

  const removeProduct = (name: string) => setProducts((prev) => prev.filter((p) => p.name !== name))

  const addProduct = (id: string) => {
    const cat = disponibles.find((p) => p.id === id)
    if (!cat) return
    if (products.find((p) => p.name === cat.nombre)) {
      setProducts((prev) => prev.map((p) => p.name === cat.nombre ? { ...p, quantity: p.quantity + 1 } : p))
    } else {
      setProducts((prev) => [...prev, { name: cat.nombre, quantity: 1, productoId: cat.id }])
    }
  }

  const handleSave = async () => {
    if (!user || products.length === 0 || !date) return
    setSaving(true)
    setError('')
    const actor = { uid: user.uid, nombre: user.nombre || user.email || 'Usuario' }
    try {
      await editOrderBy(order.id, { products, date, horaEntrega, notes, numeroOC }, actor)
      onSaved()
      onClose()
    } catch (err) {
      reportError(err, { origen: 'EditOrderModal' })
      setError('No se pudieron guardar los cambios. Verificá tu conexión y permisos e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Editar pedido — ${order.clientName}`}>
      <div className="space-y-4">

        {/* Productos */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Productos</p>
          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                <div className="flex items-center gap-1">
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => updateQty(p.name, p.quantity - 1)} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                    <Minus size={12} />
                  </button>
                  <input
                    type="number" min={1} value={p.quantity}
                    onChange={(e) => updateQty(p.name, parseInt(e.target.value) || 1)}
                    className="w-12 text-center text-sm border border-gray-200 rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => updateQty(p.name, p.quantity + 1)} className="w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                    <Plus size={12} />
                  </button>
                  <button onClick={() => removeProduct(p.name)} className="ml-1 text-red-400 hover:text-red-600 transition-colors">
                    <XCircle size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Agregar producto */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {disponibles.filter((p) => !products.find((pp) => pp.name === p.nombre)).map((p) => (
              <button key={p.id} onClick={() => addProduct(p.id)} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-accent hover:text-accent transition-colors">
                + {p.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Fecha y hora */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Hora entrega</label>
            <input type="time" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        </div>

        {/* Orden de compra */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Orden de compra</label>
          <input type="text" value={numeroOC} onChange={(e) => setNumeroOC(e.target.value)}
            placeholder="N° OC (opcional)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>

        {/* Notas */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notas</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || products.length === 0 || !date}
            className="flex-1 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>

        {order.historialAcciones && order.historialAcciones.length > 0 && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Historial de cambios</p>
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
    </Modal>
  )
}
