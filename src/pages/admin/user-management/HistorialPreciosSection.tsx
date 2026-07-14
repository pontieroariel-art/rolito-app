import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useHistorialCliente } from '../../../hooks/useHistorialPrecios'
import { HistorialPrecioEvento, ListaPrecios } from '../../../types'

const CHART_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#C084FC', '#F97316', '#34D399']

function evToDate(ev: HistorialPrecioEvento): Date {
  const ts = ev.fecha as any
  if (!ts) return new Date(0)
  return ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
}

function relativeTime(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7)  return `hace ${days} días`
  if (days < 30) return `hace ${Math.floor(days / 7)} sem.`
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function HistorialPreciosSection({
  uid,
  lista,
  preciosCustom,
}: {
  uid:           string
  lista?:        ListaPrecios
  preciosCustom?: Record<string, number>
}) {
  const [visible, setVisible]       = useState(false)
  const { historial, loading, load } = useHistorialCliente(uid)

  const handleLoad = () => { setVisible(true); load() }

  // Chart data
  const chartData = useMemo(() => {
    const evs = historial.filter((e) => e.tipo === 'custom' && e.precioNuevo != null)
    if (evs.length < 2) return null
    const byProduct: Record<string, Array<{ ts: number; precio: number }>> = {}
    for (const ev of evs) {
      const n = ev.productoNombre ?? '?'
      if (!byProduct[n]) byProduct[n] = []
      byProduct[n].push({ ts: evToDate(ev).getTime(), precio: ev.precioNuevo! })
    }
    const allTs = [...new Set(Object.values(byProduct).flat().map((p) => p.ts))].sort()
    if (allTs.length < 2) return null
    const productos = Object.keys(byProduct)
    const rows = allTs.map((ts) => {
      const row: Record<string, any> = {
        fecha: new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      }
      for (const nombre of productos) {
        const pts = byProduct[nombre].filter((p) => p.ts <= ts)
        if (pts.length > 0) row[nombre] = pts[pts.length - 1].precio
      }
      return row
    })
    return { rows, productos }
  }, [historial])

  // Desviación vs lista base
  const desvios = useMemo(() => {
    if (!lista || !preciosCustom) return []
    return Object.entries(preciosCustom).map(([id, custom]) => {
      const item = lista.items.find((i) => i.productoId === id)
      if (!item) return null
      const pct = Math.round(((custom - item.precio) / item.precio) * 100)
      return { nombre: item.nombre, listaPrice: item.precio, customPrice: custom, pct }
    }).filter(Boolean) as Array<{ nombre: string; listaPrice: number; customPrice: number; pct: number }>
  }, [lista, preciosCustom])

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={12} /> Historial de precios
        </h3>
        {!visible && (
          <button
            onClick={handleLoad}
            className="text-xs text-accent hover:bg-accent hover:text-gray-700 border border-accent/30 hover:border-accent rounded-lg px-2.5 py-1 transition-colors"
          >
            Ver historial
          </button>
        )}
      </div>

      {/* Desviación vs lista base */}
      {desvios.length > 0 && (
        <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-gray-500">Desviación respecto a lista base ({lista?.nombre})</p>
          {desvios.map((d) => (
            <div key={d.nombre} className="flex justify-between items-center text-xs">
              <span className="text-gray-500 truncate flex-1">{d.nombre}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-gray-500">${d.listaPrice.toLocaleString('es-AR')}</span>
                <span className="text-gray-900 font-medium">${d.customPrice.toLocaleString('es-AR')}</span>
                <span className={`font-bold w-12 text-right ${
                  Math.abs(d.pct) > 20 ? 'text-red-400' : d.pct < 0 ? 'text-success' : 'text-orange-400'
                }`}>
                  {d.pct > 0 ? '+' : ''}{d.pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!visible && (
        <p className="text-xs text-gray-400 text-center py-1">Cargá el historial para ver el detalle de cambios</p>
      )}

      {visible && loading && (
        <p className="text-xs text-gray-500 text-center py-2 animate-pulse">Cargando historial…</p>
      )}

      {visible && !loading && historial.length === 0 && (
        <div className="bg-[#F8F7F2] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Sin cambios registrados aún</p>
        </div>
      )}

      {visible && !loading && historial.length > 0 && (
        <>
          {/* Gráfico evolución */}
          {chartData && (
            <div className="bg-[#F8F7F2] rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-2">Evolución de precios</p>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={chartData.rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <XAxis dataKey="fecha" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={44}
                    tickFormatter={(v) => `$${Number(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1c30', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`$${Number(v).toLocaleString('es-AR')}`, '']}
                  />
                  {chartData.productos.map((nombre, i) => (
                    <Line key={nombre} type="stepAfter" dataKey={nombre}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2} dot={{ r: 3 }} connectNulls={false} name={nombre} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {historial.map((ev) => {
              const fecha   = evToDate(ev)
              const diff    = ev.precioAnterior != null && ev.precioNuevo != null
                ? Math.round(((ev.precioNuevo - ev.precioAnterior) / ev.precioAnterior) * 100)
                : null
              const big     = diff !== null && Math.abs(diff) > 20
              const vigTs   = ev.vigenciaHasta as any
              const vigDate = vigTs?.toDate?.() ?? (vigTs?.seconds ? new Date(vigTs.seconds * 1000) : null)
              const expired = vigDate && vigDate < new Date()

              return (
                <div key={ev.id} className={`bg-[#F8F7F2] rounded-xl p-3 space-y-1 border ${
                  big ? 'border-red-500/20' : 'border-transparent'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="shrink-0 text-sm mt-0.5">{ev.tipo === 'lista' ? '📋' : '💰'}</span>
                      <div className="min-w-0">
                        {ev.tipo === 'lista' ? (
                          <p className="text-xs">
                            <span className="text-gray-500 line-through">{ev.listaAnteriorNombre ?? '—'}</span>
                            {' → '}
                            <span className="text-accent font-medium">{ev.listaNuevaNombre ?? '—'}</span>
                          </p>
                        ) : (
                          <p className="text-xs">
                            <span className="font-medium">{ev.productoNombre}</span>
                            {' '}
                            {ev.accion === 'eliminado' ? (
                              <span className="text-red-400">eliminado (era ${(ev.precioAnterior ?? 0).toLocaleString('es-AR')})</span>
                            ) : (
                              <>
                                <span className="text-gray-500">${(ev.precioAnterior ?? 0).toLocaleString('es-AR')}</span>
                                {' → '}
                                <span className="text-accent font-medium">${(ev.precioNuevo ?? 0).toLocaleString('es-AR')}</span>
                                {diff !== null && (
                                  <span className={`ml-1 font-bold text-xs ${big ? 'text-red-400' : diff > 0 ? 'text-orange-400' : 'text-success'}`}>
                                    {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}%{big ? ' ⚠' : ''}
                                  </span>
                                )}
                              </>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-gray-400">{ev.modificadoPorNombre}</p>
                        {ev.motivo && (
                          <p className="text-xs text-gray-400 italic mt-0.5">"{ev.motivo}"</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500">{relativeTime(fecha)}</p>
                      {vigDate && (
                        <p className={`text-xs mt-0.5 ${expired ? 'text-red-400' : 'text-accent/70'}`}>
                          {expired ? 'vencido' : `hasta ${vigDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
