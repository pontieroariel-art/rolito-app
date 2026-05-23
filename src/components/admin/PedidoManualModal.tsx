import { useState, ChangeEvent, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { getAllUsers } from '../../services/userService'
import { createOrderManual } from '../../services/orderService'
import { useListaPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { UserProfile, getPrimaryAddress } from '../../types'

// ── ProductRow ────────────────────────────────────────────────────────────────

function ProductRow({
  nombre, unidad, precio, qty, onChange,
}: {
  nombre: string; unidad: string; precio?: number; qty: number
  onChange: (qty: number) => void
}) {
  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    onChange(raw === '' ? 0 : Math.max(0, parseInt(raw, 10)))
  }
  return (
    <div className="bg-bg border border-border rounded-xl p-3 flex justify-between items-center">
      <div>
        <p className="font-medium text-sm">{nombre}</p>
        {precio !== undefined && precio > 0 && (
          <p className="text-xs text-muted mt-0.5">
            ${precio.toLocaleString('es-AR')} / {unidad}
            {qty > 0 && <span className="text-accent ml-2 font-medium">= ${(precio * qty).toLocaleString('es-AR')}</span>}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(qty - 1)}
          disabled={qty === 0}
          className="w-8 h-8 rounded-full bg-surface border border-border text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center"
        >−</button>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={qty > 0 ? String(qty) : ''} placeholder="0"
          onChange={handleInput}
          className="w-10 text-center font-bold bg-transparent border-b border-border focus:outline-none focus:border-accent text-white placeholder-muted"
        />
        <button
          onClick={() => onChange(qty + 1)}
          className="w-8 h-8 rounded-full bg-surface border border-border text-lg hover:border-accent transition-colors flex items-center justify-center"
        >+</button>
      </div>
    </div>
  )
}

// ── StepCliente ───────────────────────────────────────────────────────────────

function StepCliente({
  onSelect,
}: {
  onSelect: (c: UserProfile) => void
}) {
  const [search, setSearch] = useState('')

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey:  ['users', 'clientes-activos'],
    queryFn:   () => getAllUsers().then((u) => u.filter((x) => x.rol === 'cliente' && x.estado === 'activo')),
    staleTime: 300_000,
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allUsers
    return allUsers.filter((u) => {
      const name = (u.razonSocial || u.nombre || '').toLowerCase()
      const cuit = (u.cuit || '').toLowerCase()
      return name.includes(q) || cuit.includes(q)
    })
  }, [allUsers, search])

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre o CUIT…"
        className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder-muted"
      />
      {isLoading ? (
        <p className="text-muted text-sm text-center py-4">Cargando clientes…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted text-sm text-center py-4">Sin resultados</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {filtered.map((c) => {
            const nombre = c.razonSocial || c.nombre || c.email
            const addr   = getPrimaryAddress(c)?.address || c.address || ''
            return (
              <button
                key={c.uid}
                onClick={() => onSelect(c)}
                className="w-full text-left bg-surface border border-border hover:border-accent/60 rounded-xl px-4 py-3 transition-colors"
              >
                <p className="font-medium text-sm text-white">{nombre}</p>
                <p className="text-xs text-muted mt-0.5 truncate">
                  {c.cuit && <span className="mr-2">CUIT {c.cuit}</span>}
                  {addr && <span>{addr}</span>}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── StepProductos ─────────────────────────────────────────────────────────────

function StepProductos({
  cliente, defaultDate, onBack, onConfirm,
}: {
  cliente:     UserProfile
  defaultDate: string
  onBack:      () => void
  onConfirm:   () => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [date, setDate]             = useState(defaultDate)
  const [notes, setNotes]           = useState('')
  const [address, setAddress]       = useState(
    () => getPrimaryAddress(cliente)?.address || cliente.address || ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const { lista }    = useListaPrecios(cliente.listaPreciosId ?? undefined)
  const { catalogo } = useCatalogo()

  const displayProducts = useMemo(() => {
    if (lista) {
      const items = lista.items.filter((i) => i.activo).map((i) => ({
        id:     i.productoId,
        nombre: i.nombre,
        unidad: i.unidad,
        precio: cliente.preciosCustom?.[i.productoId] ?? i.precio,
      }))
      if (items.length > 0) return items
    }
    return catalogo.map((p) => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, precio: undefined }))
  }, [lista, catalogo, cliente])

  const selected = displayProducts
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({
      name:       p.nombre,
      quantity:   quantities[p.id],
      productoId: p.id,
      ...(p.precio !== undefined ? { price: p.precio } : {}),
    }))

  const total     = selected.reduce((s, p) => s + ((p.price ?? 0) * p.quantity), 0)
  const hasPrecios = selected.some((p) => p.price !== undefined)
  const canSubmit  = selected.length > 0 && !!address && !!date

  const setQty = (id: string, qty: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, qty) }))

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      await createOrderManual({ cliente, products: selected, date, notes, address })
      onConfirm()
    } catch {
      setError('Error al crear el pedido. Intentá de nuevo.')
      setLoading(false)
    }
  }

  const nombreCliente = cliente.razonSocial || cliente.nombre || cliente.email

  return (
    <div className="space-y-4">
      {/* Cliente seleccionado */}
      <div className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-xl px-4 py-2.5">
        <div>
          <p className="text-xs text-accent font-medium">Cliente</p>
          <p className="text-sm font-semibold text-white">{nombreCliente}</p>
        </div>
        <button onClick={onBack} className="text-xs text-muted hover:text-white transition-colors">
          Cambiar
        </button>
      </div>

      {/* Dirección */}
      <div>
        <label className="text-xs text-muted mb-1 block">Dirección de entrega</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección…"
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Productos */}
      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
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
      </div>

      {/* Total */}
      {hasPrecios && total > 0 && (
        <div className="flex justify-between items-center bg-accent/5 border border-accent/20 rounded-xl px-4 py-2.5 text-sm">
          <span className="text-muted">Total estimado</span>
          <span className="font-bold text-white">${total.toLocaleString('es-AR')}</span>
        </div>
      )}

      {/* Fecha */}
      <div>
        <label className="text-xs text-muted mb-1 block">Fecha de entrega</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Notas */}
      <div>
        <label className="text-xs text-muted mb-1 block">Notas (opcional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Horario preferido, instrucciones especiales…"
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white text-sm placeholder-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1 text-sm">Volver</Button>
        <Button onClick={handleSubmit} loading={loading} disabled={!canSubmit} className="flex-1 text-sm">
          Crear pedido
        </Button>
      </div>
    </div>
  )
}

// ── Modal principal ───────────────────────────────────────────────────────────

export default function PedidoManualModal({
  open, onClose, defaultDate,
}: {
  open:        boolean
  onClose:     () => void
  defaultDate: string
}) {
  const [cliente, setCliente] = useState<UserProfile | null>(null)
  const [done, setDone]       = useState(false)

  const handleClose = () => {
    setCliente(null)
    setDone(false)
    onClose()
  }

  const handleConfirm = () => {
    setDone(true)
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={done ? 'Pedido creado' : cliente ? 'Nuevo pedido manual — Productos' : 'Nuevo pedido manual — Cliente'}
    >
      {done ? (
        <div className="text-center space-y-4 py-2">
          <p className="text-4xl">✅</p>
          <p className="text-white font-semibold">Pedido creado correctamente</p>
          <p className="text-muted text-sm">Aparece como pendiente en el panel de pedidos.</p>
          <Button onClick={handleClose} className="w-full">Cerrar</Button>
        </div>
      ) : !cliente ? (
        <StepCliente onSelect={setCliente} />
      ) : (
        <StepProductos
          cliente={cliente}
          defaultDate={defaultDate}
          onBack={() => setCliente(null)}
          onConfirm={handleConfirm}
        />
      )}
    </Modal>
  )
}
