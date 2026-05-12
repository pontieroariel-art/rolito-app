import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { getAllUsers } from '../../services/userService'
import { summarizeProducts } from '../../utils/helpers'
import { STATUS_LABELS } from '../../utils/constants'
import { Order, UserProfile, OrderStatus } from '../../types'

type Periodo = 'dia' | 'mes' | 'anio'

function tsToDate(ts: any): Date {
  if (!ts) return new Date(0)
  return ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
}

function orderTotal(order: Order): number {
  return order.products.reduce(
    (acc, p) => acc + (p.price !== undefined ? p.price * p.quantity : 0),
    0,
  )
}

export default function ComercialOrders() {
  const now = new Date()

  // Filtros
  const [periodo,       setPeriodo]       = useState<Periodo>('mes')
  const [clienteId,     setClienteId]     = useState<string>('todos')
  const [statusFilter,  setStatusFilter]  = useState<OrderStatus | 'todos'>('todos')
  const [search,        setSearch]        = useState('')

  // Cursor de fecha
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())       // 0-indexed
  const [day,   setDay]   = useState(now.getDate())

  const { orders, loading: ordersLoading } = useAllOrders()
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  getAllUsers,
    staleTime: 60_000,
  })

  const clientes = users.filter((u) => u.rol === 'cliente')

  // ── Filtrado ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const date = tsToDate(o.date)

      // Filtro periodo
      if (periodo === 'dia') {
        if (
          date.getFullYear() !== year ||
          date.getMonth()    !== month ||
          date.getDate()     !== day
        ) return false
      } else if (periodo === 'mes') {
        if (date.getFullYear() !== year || date.getMonth() !== month) return false
      } else {
        if (date.getFullYear() !== year) return false
      }

      // Filtro cliente
      if (clienteId !== 'todos' && o.clientId !== clienteId) return false

      // Filtro estado
      if (statusFilter !== 'todos' && o.status !== statusFilter) return false

      // Búsqueda libre
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !o.clientName.toLowerCase().includes(q) &&
          !o.clientAddress.toLowerCase().includes(q) &&
          !o.products.some((p) => p.name.toLowerCase().includes(q))
        ) return false
      }

      return true
    }).sort((a, b) => tsToDate(b.date).getTime() - tsToDate(a.date).getTime())
  }, [orders, periodo, year, month, day, clienteId, statusFilter, search])

  // ── Totales del período ───────────────────────────────────────────────────

  const totalPedidos  = filtered.length
  const totalEntregados = filtered.filter((o) => o.status === 'entregado').length
  const totalImporte  = filtered.reduce((acc, o) => acc + orderTotal(o), 0)
  const totalUnidades = filtered.reduce(
    (acc, o) => acc + o.products.reduce((a, p) => a + p.quantity, 0),
    0,
  )

  // ── Navegación de fecha ───────────────────────────────────────────────────

  const prevPeriodo = () => {
    if (periodo === 'dia') {
      const d = new Date(year, month, day - 1)
      setYear(d.getFullYear()); setMonth(d.getMonth()); setDay(d.getDate())
    } else if (periodo === 'mes') {
      const d = new Date(year, month - 1, 1)
      setYear(d.getFullYear()); setMonth(d.getMonth())
    } else {
      setYear((y) => y - 1)
    }
  }

  const nextPeriodo = () => {
    if (periodo === 'dia') {
      const d = new Date(year, month, day + 1)
      setYear(d.getFullYear()); setMonth(d.getMonth()); setDay(d.getDate())
    } else if (periodo === 'mes') {
      const d = new Date(year, month + 1, 1)
      setYear(d.getFullYear()); setMonth(d.getMonth())
    } else {
      setYear((y) => y + 1)
    }
  }

  const periodoLabel = () => {
    if (periodo === 'dia')
      return new Date(year, month, day).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (periodo === 'mes')
      return new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    return String(year)
  }

  const isLoading = ordersLoading || usersLoading

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-5 pb-10">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/comercial" className="text-muted hover:text-white transition-colors">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Historial de pedidos</h1>
            <p className="text-muted text-sm mt-0.5">Consultá y filtrá todas las compras</p>
          </div>
        </div>

        {/* ── Filtros ─────────────────────────────────────────────────── */}
        <div className="bg-surface border border-border rounded-xl p-4 space-y-4">

          {/* Selector de período */}
          <div className="flex gap-1 bg-bg border border-border rounded-lg p-1 w-fit">
            {(['dia', 'mes', 'anio'] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  periodo === p ? 'bg-accent text-bg' : 'text-muted hover:text-white'
                }`}
              >
                {p === 'dia' ? 'Día' : p === 'mes' ? 'Mes' : 'Año'}
              </button>
            ))}
          </div>

          {/* Navegación de fecha */}
          <div className="flex items-center gap-3">
            <button
              onClick={prevPeriodo}
              className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center hover:border-accent transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium capitalize min-w-[200px] text-center">
              {periodoLabel()}
            </span>
            <button
              onClick={nextPeriodo}
              className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center hover:border-accent transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Filtros secundarios */}
          <div className="flex flex-wrap gap-2">
            {/* Cliente */}
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="todos">Todos los clientes</option>
              {clientes
                .sort((a, b) => (a.razonSocial || a.nombre).localeCompare(b.razonSocial || b.nombre))
                .map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.razonSocial || c.nombre}
                  </option>
                ))}
            </select>

            {/* Estado */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'todos')}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="todos">Todos los estados</option>
              {(['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'] as OrderStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>

            {/* Búsqueda */}
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente, dirección, producto..."
                className="w-full bg-bg border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        </div>

        {/* ── Totales del período ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Pedidos"    value={String(totalPedidos)} />
          <SummaryCard label="Entregados" value={String(totalEntregados)} />
          <SummaryCard label="Unidades"   value={String(totalUnidades)} />
          <SummaryCard
            label="Importe estimado"
            value={totalImporte > 0 ? `$${totalImporte.toLocaleString('es-AR')}` : '—'}
            accent={totalImporte > 0}
          />
        </div>

        {/* ── Lista de pedidos ─────────────────────────────────────────── */}
        {isLoading ? (
          <LoadingSpinner />
        ) : filtered.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
            No hay pedidos para el período y filtros seleccionados
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((o) => (
              <OrderCard key={o.id} order={o} users={users} />
            ))}
          </div>
        )}

      </main>
    </>
  )
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({ order, users }: { order: Order; users: UserProfile[] }) {
  const client  = users.find((u) => u.uid === order.clientId)
  const total   = orderTotal(order)
  const date    = tsToDate(order.date)

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{client?.razonSocial || order.clientName}</span>
            {client?.razonSocial && client.razonSocial !== order.clientName && (
              <span className="text-xs text-muted">({order.clientName})</span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5 truncate">{order.clientAddress}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge status={order.status} />
          <span className="text-xs text-muted">
            {date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-xs text-muted">{summarizeProducts(order.products)}</p>
          {order.driverId && (
            <p className="text-xs text-muted">Chofer: {order.driverId}</p>
          )}
          {order.notes && (
            <p className="text-xs text-muted italic">"{order.notes}"</p>
          )}
        </div>
        {total > 0 && (
          <p className="text-sm font-bold text-accent shrink-0">
            ${total.toLocaleString('es-AR')}
          </p>
        )}
      </div>
    </div>
  )
}

// ── SummaryCard ───────────────────────────────────────────────────────────────

function SummaryCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className={`text-lg font-bold ${accent ? 'text-accent' : 'text-white'}`}>{value}</p>
      <p className="text-muted text-xs mt-1">{label}</p>
    </div>
  )
}
