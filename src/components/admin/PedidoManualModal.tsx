import { useState, ChangeEvent, useMemo } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { createOrderManual, findActiveOrdersSameDay } from '../../services/orderService'
import { useListaPrecios } from '../../hooks/useListasPrecios'
import { useCatalogo } from '../../hooks/useCatalogo'
import { useSucursales, SucursalItem } from '../../hooks/useSucursales'
import { UserProfile, Order } from '../../types'
import { formatShortDate } from '../../utils/helpers'
import { STATUS_LABELS } from '../../utils/constants'

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
    <div className="bg-[#F1EFE8] border border-[#D3D1C7] rounded-xl p-3 flex justify-between items-center">
      <div>
        <p className="font-medium text-sm text-gray-900">{nombre}</p>
        {precio !== undefined && precio > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            ${precio.toLocaleString('es-AR')} / {unidad}
            {qty > 0 && <span className="text-accent ml-2 font-medium">= ${(precio * qty).toLocaleString('es-AR')}</span>}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(qty - 1)}
          disabled={qty === 0}
          className="w-8 h-8 rounded-full bg-white border border-[#D3D1C7] text-lg hover:border-accent transition-colors disabled:opacity-30 flex items-center justify-center text-gray-700"
        >−</button>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={qty > 0 ? String(qty) : ''} placeholder="0"
          onChange={handleInput}
          className="w-10 text-center font-bold bg-transparent border-b border-[#D3D1C7] focus:outline-none focus:border-accent text-gray-900 placeholder-gray-400"
        />
        <button
          onClick={() => onChange(qty + 1)}
          className="w-8 h-8 rounded-full bg-white border border-[#D3D1C7] text-lg hover:border-accent transition-colors flex items-center justify-center text-gray-700"
        >+</button>
      </div>
    </div>
  )
}

// ── StepCliente ───────────────────────────────────────────────────────────────

function StepCliente({
  onSelect,
}: {
  onSelect: (item: SucursalItem) => void
}) {
  const [search, setSearch] = useState('')
  const { sucursales, isLoading, isError } = useSucursales()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return sucursales
    return sucursales.filter((s) =>
      s.label.toLowerCase().includes(q) ||
      (s.user.cuit || '').toLowerCase().includes(q) ||
      (s.user.codigoCliente || '').toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q),
    )
  }, [sucursales, search])

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre, CUIT o dirección…"
        className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-400"
      />
      {isLoading ? (
        <p className="text-gray-500 text-sm text-center py-4">Cargando clientes…</p>
      ) : isError ? (
        <p className="text-red-600 text-sm text-center py-4">Error al cargar clientes. Verificá la conexión.</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">
          {search ? 'Sin resultados para esa búsqueda' : 'No hay clientes activos'}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {filtered.map((s) => (
            <button
              key={s.key}
              onClick={() => onSelect(s)}
              className="w-full text-left bg-[#F1EFE8] border border-[#D3D1C7] hover:border-accent/60 hover:bg-white rounded-xl px-4 py-3 transition-colors"
            >
              <p className="font-medium text-sm text-gray-900">{s.label}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {s.user.cuit && <span className="mr-2">CUIT {s.user.cuit}</span>}
                {s.address && <span>{s.address}</span>}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── StepProductos ─────────────────────────────────────────────────────────────

function StepProductos({
  cliente, clientLabel, initialAddress, initialHorario, defaultDate, onBack, onConfirm,
}: {
  cliente:         UserProfile
  clientLabel:     string
  initialAddress:  string
  initialHorario?: string
  defaultDate:     string
  onBack:          () => void
  onConfirm:       () => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [date, setDate]             = useState(defaultDate)
  const [notes, setNotes]           = useState('')
  const [address, setAddress]       = useState(initialAddress)
  const [ordenCompra, setOrdenCompra] = useState('')
  const [fechaEmision, setFechaEmision] = useState('')
  const [checkingDup, setCheckingDup] = useState(false)
  const [duplicates,  setDuplicates]  = useState<Order[] | null>(null)
  const parseHorario = (h?: string) => {
    const parts = (h ?? '').split(/\s*[–-]\s*/)
    return { desde: parts[0]?.trim() ?? '', hasta: parts[1]?.trim() ?? '' }
  }
  const [horarioDesde, setHorarioDesde] = useState(() => parseHorario(initialHorario).desde)
  const [horarioHasta, setHorarioHasta] = useState(() => parseHorario(initialHorario).hasta)
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

  const handleSubmit = async (skipDupCheck = false) => {
    if (!canSubmit) return
    setError('')

    if (!skipDupCheck) {
      setCheckingDup(true)
      const dups = await findActiveOrdersSameDay(cliente.uid, date)
      setCheckingDup(false)
      if (dups.length > 0) {
        setDuplicates(dups)
        return
      }
    }
    setDuplicates(null)

    setLoading(true)
    try {
      const horarioCombinado = horarioDesde && horarioHasta
        ? `${horarioDesde} – ${horarioHasta}`
        : horarioDesde || horarioHasta || undefined
      await createOrderManual({
        cliente, clientLabel, products: selected, date, notes, address,
        ordenCompra: ordenCompra.trim() || undefined,
        horaEntrega: horarioCombinado,
        fechaEmision: fechaEmision || undefined,
      })
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
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
          Cambiar
        </button>
      </div>

      {/* Dirección */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Dirección de entrega</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección…"
          className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-400"
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
          <span className="text-gray-500">Total estimado</span>
          <span className="font-bold text-white">${total.toLocaleString('es-AR')}</span>
        </div>
      )}

      {/* Fecha */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Fecha de entrega</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Orden de compra */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Orden de compra (opcional)</label>
          <input
            value={ordenCompra}
            onChange={(e) => setOrdenCompra(e.target.value)}
            placeholder="Nro. de OC…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fecha de emisión de la OC (opcional)</label>
          <input
            type="date"
            value={fechaEmision}
            onChange={(e) => setFechaEmision(e.target.value)}
            className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Rango horario */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Rango horario del cliente (opcional)</label>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={horarioDesde}
            onChange={(e) => setHorarioDesde(e.target.value)}
            className="flex-1 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-gray-400 text-sm shrink-0">–</span>
          <input
            type="time"
            value={horarioHasta}
            onChange={(e) => setHorarioHasta(e.target.value)}
            className="flex-1 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Notas */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Notas (opcional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Horario preferido, instrucciones especiales…"
          className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-400 resize-none focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {duplicates && duplicates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm space-y-2">
          <p className="text-amber-700 font-medium">
            ⚠ Ya existe{duplicates.length > 1 ? 'n' : ''} {duplicates.length} pedido{duplicates.length > 1 ? 's' : ''} de este cliente para el {formatShortDate(duplicates[0].date)}
          </p>
          <ul className="text-xs text-amber-700/80 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.id}>
                {d.numeroOC ? `OC #${d.numeroOC}` : 'Sin OC'} — {STATUS_LABELS[d.status]}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => setDuplicates(null)} className="flex-1 text-xs !py-1.5">
              Revisar
            </Button>
            <Button onClick={() => handleSubmit(true)} loading={loading} className="flex-1 text-xs !py-1.5 !bg-amber-600 hover:!bg-amber-500">
              Crear igual
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1 text-sm">Volver</Button>
        <Button onClick={() => handleSubmit()} loading={loading || checkingDup} disabled={!canSubmit} className="flex-1 text-sm">
          {checkingDup ? 'Verificando…' : 'Crear pedido'}
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
  const [selection, setSelection] = useState<{ user: UserProfile; address: string; label: string; horario?: string } | null>(null)
  const [done, setDone]           = useState(false)

  const handleClose = () => {
    setSelection(null)
    setDone(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={done ? 'Pedido creado' : selection ? 'Nuevo pedido manual — Productos' : 'Nuevo pedido manual — Cliente'}
      variant="light"
    >
      {done ? (
        <div className="text-center space-y-4 py-2">
          <p className="text-4xl">✅</p>
          <p className="text-gray-900 font-semibold">Pedido creado correctamente</p>
          <p className="text-gray-500 text-sm">Aparece como pendiente en el panel de pedidos.</p>
          <Button onClick={handleClose} className="w-full">Cerrar</Button>
        </div>
      ) : !selection ? (
        <StepCliente onSelect={(s) => setSelection({ user: s.user, address: s.address, label: s.label, horario: s.horario })} />
      ) : (
        <StepProductos
          cliente={selection.user}
          clientLabel={selection.label}
          initialAddress={selection.address}
          initialHorario={selection.horario}
          defaultDate={defaultDate}
          onBack={() => setSelection(null)}
          onConfirm={() => setDone(true)}
        />
      )}
    </Modal>
  )
}
