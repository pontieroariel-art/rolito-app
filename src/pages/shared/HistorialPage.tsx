import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Badge from '../../components/ui/Badge'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllOrders } from '../../hooks/useOrders'
import { useVisitasPuntuales } from '../../hooks/useVisitas'
import { getAllUsers } from '../../services/userService'
import { summarizeProducts } from '../../utils/helpers'
import { STATUS_LABELS } from '../../utils/constants'
import { Order, VisitaPuntual, OrderStatus, UserProfile } from '../../types'
import { Timestamp } from 'firebase/firestore'

type Periodo = 'dia' | 'mes' | 'anio'
type TipoFiltro = 'todos' | 'pedidos' | 'visitas'

function tsToDate(ts: Timestamp | null | undefined): Date {
  if (!ts) return new Date(0)
  return ts.toDate ? ts.toDate() : new Date((ts as any).seconds * 1000)
}

function orderTotal(order: Order): number {
  return order.products.reduce(
    (acc, p) => acc + (p.price !== undefined ? p.price * p.quantity : 0),
    0,
  )
}

const VISITA_STATUS_LABELS: Record<string, string> = {
  pendiente:     'Pendiente',
  visitado:      'Visitado',
  sin_contacto:  'Sin contacto',
}

const VISITA_STATUS_COLORS: Record<string, string> = {
  pendiente:    'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  visitado:     'bg-success/15 text-success border border-success/30',
  sin_contacto: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
}

export default function HistorialPage() {
  const now = new Date()

  const [periodo,      setPeriodo]      = useState<Periodo>('mes')
  const [tipo,         setTipo]         = useState<TipoFiltro>('todos')
  const [clienteId,    setClienteId]    = useState<string>('todos')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todos'>('todos')
  const [search,       setSearch]       = useState('')

  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [day,   setDay]   = useState(now.getDate())

  const { orders, loading: ordersLoading }  = useAllOrders()
  const { visitas, loading: visitasLoading } = useVisitasPuntuales()
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey:  ['users'],
    queryFn:   getAllUsers,
    staleTime: 300_000,
  })

  const clientes = users.filter((u) => u.rol === 'cliente')

  // ── Helpers de período ────────────────────────────────────────────────────

  function enPeriodo(date: Date): boolean {
    if (periodo === 'dia')
      return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    if (periodo === 'mes')
      return date.getFullYear() === year && date.getMonth() === month
    return date.getFullYear() === year
  }

  // ── Filtrado ──────────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    if (tipo === 'visitas') return []
    return orders.filter((o) => {
      if (!enPeriodo(tsToDate(o.date))) return false
      if (clienteId !== 'todos' && o.clientId !== clienteId) return false
      if (statusFilter !== 'todos' && o.status !== statusFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !o.clientName.toLowerCase().includes(q) &&
          !o.clientAddress.toLowerCase().includes(q) &&
          !o.products.some((p) => p.name.toLowerCase().includes(q))
        ) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, periodo, year, month, day, clienteId, statusFilter, search, tipo])

  const filteredVisitas = useMemo(() => {
    if (tipo === 'pedidos') return []
    return visitas.filter((v) => {
      if (!v.fecha?.toDate) return false
      if (!enPeriodo(v.fecha.toDate())) return false
      if (clienteId !== 'todos' && v.clientId !== clienteId) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !v.clientName.toLowerCase().includes(q) &&
          !v.clientAddress.toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitas, periodo, year, month, day, clienteId, search, tipo])

  // ── Unificar y ordenar ────────────────────────────────────────────────────

  type Item =
    | { kind: 'pedido';  data: Order;         date: Date }
    | { kind: 'visita';  data: VisitaPuntual; date: Date }

  const items: Item[] = useMemo(() => {
    const result: Item[] = [
      ...filteredOrders.map((o)  => ({ kind: 'pedido' as const, data: o, date: tsToDate(o.date) })),
      ...filteredVisitas.map((v) => ({ kind: 'visita' as const, data: v, date: tsToDate(v.fecha) })),
    ]
    return result.sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [filteredOrders, filteredVisitas])

  // ── Totales ───────────────────────────────────────────────────────────────

  const totalPedidos    = filteredOrders.length
  const totalEntregados = filteredOrders.filter((o) => o.status === 'entregado').length
  const totalVisitas    = filteredVisitas.length
  const totalVisitados  = filteredVisitas.filter((v) => v.status === 'visitado').length
  const totalImporte    = filteredOrders.reduce((acc, o) => acc + orderTotal(o), 0)

  // ── Navegación de período ─────────────────────────────────────────────────

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
      return new Date(year, month, day).toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    if (periodo === 'mes')
      return new Date(year, month, 1).toLocaleDateString('es-AR', {
        month: 'long', year: 'numeric',
      })
    return String(year)
  }

  const isLoading = ordersLoading || visitasLoading || usersLoading

  return (
    <>
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-5 pb-10">

        <div>
          <h1 className="text-2xl font-bold">Historial</h1>
          <p className="text-muted text-sm mt-0.5">Pedidos y visitas del período</p>
        </div>

        {/* ── Filtros ─────────────────────────────────────────────────── */}
        <div className="bg-surface border border-border rounded-xl p-4 space-y-4">

          {/* Período */}
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

          {/* Tipo + cliente + estado + búsqueda */}
          <div className="flex flex-wrap gap-2">

            {/* Tipo */}
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoFiltro)}
              className="bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="todos">Pedidos y visitas</option>
              <option value="pedidos">Solo pedidos</option>
              <option value="visitas">Solo visitas</option>
            </select>

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

            {/* Estado pedido (solo si tipo no es visitas) */}
            {tipo !== 'visitas' && (
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
            )}

            {/* Búsqueda */}
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente, dirección..."
                className="w-full bg-bg border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        </div>

        {/* ── Totales ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tipo !== 'visitas' && (
            <>
              <SummaryCard label="Pedidos"    value={String(totalPedidos)} />
              <SummaryCard label="Entregados" value={String(totalEntregados)} />
              {totalImporte > 0 && (
                <SummaryCard
                  label="Importe estimado"
                  value={`$${totalImporte.toLocaleString('es-AR')}`}
                  accent
                />
              )}
            </>
          )}
          {tipo !== 'pedidos' && (
            <>
              <SummaryCard label="Visitas"   value={String(totalVisitas)} />
              <SummaryCard label="Visitados" value={String(totalVisitados)} />
            </>
          )}
        </div>

        {/* ── Lista ────────────────────────────────────────────────────── */}
        {isLoading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted text-sm">
            No hay registros para el período y filtros seleccionados
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) =>
              item.kind === 'pedido' ? (
                <PedidoCard key={`p-${item.data.id}`} order={item.data} users={users} />
              ) : (
                <VisitaCard key={`v-${item.data.id}`} visita={item.data} />
              ),
            )}
          </div>
        )}

      </main>
    </>
  )
}

// ── PedidoCard ────────────────────────────────────────────────────────────────

function PedidoCard({ order, users }: { order: Order; users: UserProfile[] }) {
  const client = users.find((u) => u.uid === order.clientId)
  const total  = orderTotal(order)
  const date   = tsToDate(order.date)

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-medium shrink-0">
            Pedido
          </span>
          <span className="font-medium text-sm">{client?.razonSocial || order.clientName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {order.entregaParcial && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-500/15 text-orange-400 border border-orange-500/30">
              Parcial
            </span>
          )}
          <Badge status={order.status} />
          <span className="text-xs text-muted">
            {date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-0.5 min-w-0">
          <p className="text-xs text-muted truncate">📍 {order.clientAddress}</p>
          {order.productosEntregados ? (
            <p className="text-xs text-muted">
              Entregado: {summarizeProducts(order.productosEntregados)}
            </p>
          ) : (
            <p className="text-xs text-muted">{summarizeProducts(order.products)}</p>
          )}
          {order.driverId && (
            <p className="text-xs text-muted">Chofer: {order.driverId}</p>
          )}
          {order.notes && (
            <p className="text-xs text-muted italic">"{order.notes}"</p>
          )}
          {order.notaEntrega && (
            <p className="text-xs text-orange-400 italic">⚠ {order.notaEntrega}</p>
          )}
          {order.motivoCancelacion && (
            <p className="text-xs text-red-400 italic">✕ {order.motivoCancelacion}</p>
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

// ── VisitaCard ────────────────────────────────────────────────────────────────

function VisitaCard({ visita }: { visita: VisitaPuntual }) {
  const date    = tsToDate(visita.fecha)
  const statusClass = VISITA_STATUS_COLORS[visita.status] ?? 'bg-surface text-muted'

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium shrink-0">
            Visita
          </span>
          <span className="font-medium text-sm">{visita.clientName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
            {VISITA_STATUS_LABELS[visita.status] ?? visita.status}
          </span>
          <span className="text-xs text-muted">
            {date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="space-y-0.5">
        <p className="text-xs text-muted truncate">📍 {visita.clientAddress}</p>
        {visita.clientPhone && (
          <p className="text-xs text-accent">{visita.clientPhone}</p>
        )}
        {visita.notas && (
          <p className="text-xs text-muted italic">"{visita.notas}"</p>
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
