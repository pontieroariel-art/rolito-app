import { useState, useMemo, ChangeEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import ClienteCombobox from '../../components/ui/ClienteCombobox'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAllHistorial } from '../../hooks/useHistorialPrecios'
import { getAllUsers } from '../../services/userService'
import { HistorialPrecioEvento } from '../../types'
import { Timestamp } from 'firebase/firestore'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#C084FC', '#F97316', '#34D399']

function evToDate(ev: HistorialPrecioEvento): Date {
  const ts = ev.fecha as any
  if (!ts) return new Date(0)
  return ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtDateTime(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function pctDiff(nuevo: number, viejo: number): number {
  if (viejo === 0) return 0
  return Math.round(((nuevo - viejo) / viejo) * 100)
}

function exportCSV(rows: HistorialPrecioEvento[]) {
  const headers = ['Fecha', 'Cliente', 'Tipo', 'Detalle', 'Precio anterior', 'Precio nuevo', 'Variación %', 'Motivo', 'Modificado por', 'Vigencia hasta']
  const lines = rows.map((ev) => {
    const d    = evToDate(ev)
    const fecha = fmtDateTime(d)
    const tipo  = ev.tipo === 'lista' ? 'Cambio de lista' : 'Precio especial'
    const detalle = ev.tipo === 'lista'
      ? `${ev.listaAnteriorNombre ?? '—'} → ${ev.listaNuevaNombre ?? '—'}`
      : `${ev.productoNombre ?? ''} (${ev.accion ?? ''})`
    const pctStr = ev.precioAnterior != null && ev.precioNuevo != null
      ? `${pctDiff(ev.precioNuevo, ev.precioAnterior)}%` : ''
    const vigTs = ev.vigenciaHasta as any
    const vigDate = vigTs?.toDate?.() ?? (vigTs?.seconds ? new Date(vigTs.seconds * 1000) : null)
    return [
      fecha, ev.clientName, tipo, detalle,
      ev.precioAnterior ?? '', ev.precioNuevo ?? '', pctStr,
      ev.motivo ?? '', ev.modificadoPorNombre,
      vigDate ? fmtDate(vigDate) : '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  })
  const csv   = [headers.join(','), ...lines].join('\n')
  const blob  = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href      = url
  a.download  = `historial-precios-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Componentes ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

function EventRow({ ev }: { ev: HistorialPrecioEvento }) {
  const fecha   = evToDate(ev)
  const diff    = ev.precioAnterior != null && ev.precioNuevo != null
    ? pctDiff(ev.precioNuevo, ev.precioAnterior) : null
  const big     = diff !== null && Math.abs(diff) > 20
  const vigTs   = ev.vigenciaHasta as any
  const vigDate = vigTs?.toDate?.() ?? (vigTs?.seconds ? new Date(vigTs.seconds * 1000) : null)
  const expired = vigDate && vigDate < new Date()

  return (
    <div className={`bg-white border rounded-xl p-4 flex flex-wrap gap-3 items-start justify-between ${
      big ? 'border-red-300' : 'border-[#D3D1C7]'
    }`}>
      <div className="min-w-0 space-y-1 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base">{ev.tipo === 'lista' ? '📋' : '💰'}</span>
          <p className="font-semibold text-sm text-gray-900">{ev.clientName}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            ev.tipo === 'lista'
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {ev.tipo === 'lista' ? 'Cambio de lista' : `Precio especial · ${ev.accion ?? ''}`}
          </span>
          {big && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 font-medium">
              ⚠ variación &gt;20%
            </span>
          )}
        </div>

        {ev.tipo === 'lista' ? (
          <p className="text-xs text-gray-500">
            <span className="line-through">{ev.listaAnteriorNombre ?? 'Sin lista'}</span>
            {' → '}
            <span className="text-gray-900 font-medium">{ev.listaNuevaNombre ?? 'Sin lista'}</span>
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            <span className="text-gray-900">{ev.productoNombre}</span>
            {ev.accion !== 'eliminado' && ev.precioAnterior != null && ev.precioNuevo != null && (
              <>
                {' '}
                <span>${ev.precioAnterior.toLocaleString('es-AR')}</span>
                {' → '}
                <span className="text-gray-900 font-medium">${ev.precioNuevo.toLocaleString('es-AR')}</span>
                {diff !== null && (
                  <span className={`ml-1 font-bold ${big ? 'text-red-600' : diff > 0 ? 'text-amber-600' : 'text-success'}`}>
                    ({diff > 0 ? '+' : ''}{diff}%)
                  </span>
                )}
              </>
            )}
            {ev.accion === 'eliminado' && (
              <span className="text-red-600"> — eliminado (era ${(ev.precioAnterior ?? 0).toLocaleString('es-AR')})</span>
            )}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {ev.motivo && (
            <p className="text-xs text-gray-400 italic">"{ev.motivo}"</p>
          )}
          <p className="text-xs text-gray-500">por {ev.modificadoPorNombre}</p>
          {vigDate && (
            <p className={`text-xs ${expired ? 'text-red-600' : 'text-accent/70'}`}>
              {expired ? '⚠ vigencia vencida' : `válido hasta ${fmtDate(vigDate)}`}
            </p>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className="text-xs text-gray-500">{fmtDate(fecha)}</p>
        <p className="text-xs text-gray-400">{fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </div>
  )
}

// ── Gráfico de evolución por cliente ─────────────────────────────────────────

function ClienteChart({ eventos }: { eventos: HistorialPrecioEvento[] }) {
  const customEvs = eventos.filter((e) => e.tipo === 'custom' && e.precioNuevo != null)
  if (customEvs.length < 2) return null

  const byProduct: Record<string, Array<{ ts: number; precio: number }>> = {}
  for (const ev of customEvs) {
    const n = ev.productoNombre ?? '?'
    if (!byProduct[n]) byProduct[n] = []
    byProduct[n].push({ ts: evToDate(ev).getTime(), precio: ev.precioNuevo! })
  }

  const allTs    = [...new Set(Object.values(byProduct).flat().map((p) => p.ts))].sort()
  const productos = Object.keys(byProduct)

  const rows = allTs.map((ts) => {
    const row: Record<string, any> = {
      fecha: new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }),
    }
    for (const nombre of productos) {
      const pts = byProduct[nombre].filter((p) => p.ts <= ts)
      if (pts.length > 0) row[nombre] = pts[pts.length - 1].precio
    }
    return row
  })

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Evolución de precios — {eventos[0]?.clientName}</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={56}
            tickFormatter={(v) => `$${Number(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: '#111' }}
            formatter={(v: any, name: any) => [`$${Number(v).toLocaleString('es-AR')}`, name as string]}
          />
          {productos.map((nombre, i) => (
            <Line key={nombre} type="stepAfter" dataKey={nombre}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2.5} dot={{ r: 4 }} name={nombre} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3">
        {productos.map((nombre, i) => (
          <span key={nombre} className="flex items-center gap-1.5 text-xs">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            {nombre}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────

type Periodo = '30d' | '90d' | '1y' | 'all'

const periodoMs: Record<Periodo, number> = {
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
  '1y':  365 * 86400000,
  'all': Infinity,
}

export default function HistorialPreciosPage() {
  const { historial, loading, error, reload } = useAllHistorial()
  const { data: users = [] } = useQuery({
    queryKey:  ['users'],
    queryFn:   () => getAllUsers(),
    staleTime: 300_000,
  })

  const [periodo,       setPeriodo]       = useState<Periodo>('30d')
  const [clientSearch,  setClientSearch]  = useState('')
  const [tipoFilter,    setTipoFilter]    = useState<'all' | 'lista' | 'custom'>('all')
  const [soloAlertas,   setSoloAlertas]   = useState(false)
  const [clienteDetalle, setClienteDetalle] = useState<string | null>(null)

  // Clientes cuyo código coincide con la búsqueda — permite encontrar
  // eventos por código de cliente aunque el evento no lo guarde.
  const codeMatchIds = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return new Set<string>()
    return new Set(
      users.filter((u) => u.codigoCliente?.toLowerCase().includes(q)).map((u) => u.uid),
    )
  }, [users, clientSearch])

  const filtered = useMemo(() => {
    const cutoff = periodo === 'all' ? new Date(0) : new Date(Date.now() - periodoMs[periodo])
    return historial.filter((ev) => {
      const d = evToDate(ev)
      if (d < cutoff) return false
      if (tipoFilter !== 'all' && ev.tipo !== tipoFilter) return false
      if (clientSearch && !codeMatchIds.has(ev.clientId) && !ev.clientName.toLowerCase().includes(clientSearch.toLowerCase())) return false
      if (soloAlertas) {
        const diff = ev.precioAnterior != null && ev.precioNuevo != null
          ? Math.abs(pctDiff(ev.precioNuevo, ev.precioAnterior)) : 0
        if (diff <= 20) return false
      }
      return true
    })
  }, [historial, periodo, tipoFilter, clientSearch, soloAlertas, codeMatchIds])

  // Stats
  const stats = useMemo(() => {
    const clientes    = new Set(filtered.map((e) => e.clientId)).size
    const alertas     = filtered.filter((e) => {
      const diff = e.precioAnterior != null && e.precioNuevo != null
        ? Math.abs(pctDiff(e.precioNuevo, e.precioAnterior)) : 0
      return diff > 20
    }).length
    const customEvs   = filtered.filter((e) => e.tipo === 'custom' && e.precioAnterior != null && e.precioNuevo != null)
    const diffs       = customEvs.map((e) => pctDiff(e.precioNuevo!, e.precioAnterior!))
    const maxAumento  = diffs.length > 0 ? Math.max(...diffs) : 0
    const maxBaja     = diffs.length > 0 ? Math.min(...diffs) : 0
    return { total: filtered.length, clientes, alertas, maxAumento, maxBaja }
  }, [filtered])

  // Detalles de un cliente seleccionado
  const clienteEventos = useMemo(
    () => clienteDetalle ? filtered.filter((e) => e.clientId === clienteDetalle) : [],
    [filtered, clienteDetalle],
  )

  // Lista de clientes únicos en los resultados
  const clientesUnicos = useMemo(() => {
    const map = new Map<string, string>()
    filtered.forEach((e) => map.set(e.clientId, e.clientName))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [filtered])

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>
  if (error) return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 pt-10 text-center space-y-3">
        <p className="text-4xl">⚠️</p>
        <p className="text-red-600 font-semibold">No se pudo cargar el historial</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <button onClick={reload} className="mt-4 text-sm border border-accent text-accent rounded-lg px-4 py-2 hover:bg-accent/10 transition-colors">
          Reintentar
        </button>
      </main>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6 pb-10">

        {/* Header */}
        <div className="flex flex-wrap justify-between items-end gap-3">
          <div>
            <h1 className="text-2xl font-bold">Historial de precios</h1>
            <p className="text-gray-500 text-sm">Seguimiento de cambios por cliente</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => exportCSV(filtered)}
              className="text-xs border border-[#D3D1C7] text-gray-500 hover:text-gray-900 hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
            >
              ↓ Exportar CSV
            </button>
            <button
              onClick={reload}
              className="text-xs border border-[#D3D1C7] text-gray-500 hover:text-gray-900 hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
            >
              ↻ Actualizar
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total cambios"   value={stats.total}    sub="en el período" />
          <StatCard label="Clientes"         value={stats.clientes} sub="con cambios" />
          <StatCard label="Alertas >20%"     value={stats.alertas}
            color={stats.alertas > 0 ? 'text-red-600' : 'text-gray-900'} sub="variaciones grandes" />
          <StatCard label="Mayor variación"
            value={stats.maxAumento > 0 ? `+${stats.maxAumento}%` : stats.maxBaja < 0 ? `${stats.maxBaja}%` : '—'}
            color={stats.maxAumento > 20 ? 'text-red-600' : stats.maxBaja < -20 ? 'text-success' : 'text-gray-900'}
            sub="en precios custom" />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Período */}
          <div className="flex rounded-lg border border-[#D3D1C7] overflow-hidden text-xs">
            {(['30d', '90d', '1y', 'all'] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 transition-colors ${periodo === p ? 'bg-accent text-white font-semibold' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {p === '30d' ? '30 días' : p === '90d' ? '3 meses' : p === '1y' ? '1 año' : 'Todo'}
              </button>
            ))}
          </div>

          {/* Tipo */}
          <select
            value={tipoFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipoFilter(e.target.value as any)}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">Todos los tipos</option>
            <option value="lista">Solo listas</option>
            <option value="custom">Solo precios especiales</option>
          </select>

          {/* Buscar cliente */}
          <input
            value={clientSearch}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setClientSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-40"
          />

          {/* Solo alertas */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={soloAlertas}
              onChange={(e) => setSoloAlertas(e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-gray-500 text-xs">Solo alertas &gt;20%</span>
          </label>

          {(clientSearch || tipoFilter !== 'all' || soloAlertas) && (
            <button
              onClick={() => { setClientSearch(''); setTipoFilter('all'); setSoloAlertas(false) }}
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              Limpiar ✕
            </button>
          )}
        </div>

        {/* Selector de cliente para ver gráfico */}
        {clientesUnicos.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 whitespace-nowrap">Ver evolución de:</span>
            <ClienteCombobox
              items={clientesUnicos.map(([uid, label]) => ({ uid, label }))}
              value={clienteDetalle ?? ''}
              onChange={(uid) => setClienteDetalle(uid || null)}
              className="flex-1 max-w-xs"
            />
          </div>
        )}

        {/* Gráfico del cliente seleccionado */}
        {clienteDetalle && clienteEventos.length > 0 && (
          <ClienteChart eventos={clienteEventos} />
        )}

        {/* Lista de eventos */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              {filtered.length} cambio{filtered.length !== 1 ? 's' : ''}
            </h2>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-10 text-center">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-gray-500 text-sm">No hay cambios con estos filtros</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((ev) => <EventRow key={ev.id} ev={ev} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
