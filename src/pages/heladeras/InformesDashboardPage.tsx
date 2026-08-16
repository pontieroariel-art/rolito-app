import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import KpiTile from '../../components/heladeras/KpiTile'
import { useHeladeras } from '../../hooks/useHeladeras'
import { useTicketsServicio } from '../../hooks/useTicketsServicio'
import { generateListadoPdf } from '../../utils/pdf'
import { Heladera, TicketServicio } from '../../types'
import { ESTADO_TICKET_LABELS } from '../../utils/heladeraLabels'
import { tsToDate } from '../../utils/helpers'

type Categoria = 'disponibles' | 'pintura' | 'refrigeracion' | 'deposito' | 'asignados' | 'service'

const DIA_MS = 86_400_000

// Última vez que la heladera llegó a 'disponible' (puede haber más de una si
// tuvo un rechazo y volvió a empezar el ciclo) menos el alta — tiempo total
// que pasó en taller en su paso por el pipeline más reciente. `null` si
// todavía no llegó a disponible ninguna vez (sigue en taller o no hay datos).
function tiempoEnTallerDias(h: Heladera): number | null {
  const creada = h.historialAcciones.find((a) => a.accion === 'creada')
  if (!creada) return null
  const llegadas = h.historialAcciones.filter((a) => a.estadoDestino === 'disponible')
  if (llegadas.length === 0) return null
  const ultima = llegadas.reduce((max, a) => (tsToDate(a.timestamp) > tsToDate(max.timestamp) ? a : max))
  return (tsToDate(ultima.timestamp).getTime() - tsToDate(creada.timestamp).getTime()) / DIA_MS
}

function promedio(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((s, v) => s + v, 0) / valores.length
}

export default function InformesDashboardPage() {
  const { heladeras, loading: loadingHeladeras } = useHeladeras()
  const { tickets, loading: loadingTickets } = useTicketsServicio()
  const [abierta, setAbierta] = useState<Categoria | null>(null)

  const grupos = useMemo(() => {
    const disponibles = heladeras.filter((h) => h.estado === 'disponible')
    // Pintura/refrigeración son sectores compartidos por ambos pipelines
    // (fabricación y reacondicionamiento) — se identifican por el área del
    // que la tiene agarrada, no por el estado (que ahora es genérico).
    const pintura       = heladeras.filter((h) => h.enProceso?.area === 'pintura')
    const refrigeracion = heladeras.filter((h) => h.enProceso?.area === 'refrigeracion')
    // "Depósito" = recién ingresada, todavía no arrancó ningún paso.
    const deposito       = heladeras.filter((h) => h.estado === 'en_taller' && !h.enProceso && h.pasoActualId === h.primerPasoId)
    const asignados      = heladeras.filter((h) => h.estado === 'en_comodato')
    const service         = tickets.filter((t) => ['abierto', 'asignado_tecnico', 'asignado_chofer'].includes(t.estado))
    return { disponibles, pintura, refrigeracion, deposito, asignados, service }
  }, [heladeras, tickets])

  // Métricas históricas — SLA de tickets cerrados y tiempo total en taller.
  // Se calculan sobre lo que ya traen useTicketsServicio()/useHeladeras()
  // (300/500 más recientes, ya acotado), no hace falta una query aparte.
  const metricas = useMemo(() => {
    const cerrados = tickets.filter((t) => t.estado === 'cerrado' && t.fechaCierre)
    const slaDias = promedio(cerrados.map((t) => (tsToDate(t.fechaCierre!).getTime() - tsToDate(t.fechaPedido).getTime()) / DIA_MS))

    const tallerDias = promedio(
      heladeras.map(tiempoEnTallerDias).filter((v): v is number => v !== null),
    )

    const now = new Date()
    const semanas = Array.from({ length: 8 }, (_, idx) => {
      const i = 7 - idx
      const inicio = new Date(now); inicio.setHours(0, 0, 0, 0); inicio.setDate(inicio.getDate() - (i * 7 + 6))
      const fin    = new Date(now); fin.setHours(23, 59, 59, 999); fin.setDate(fin.getDate() - i * 7)
      return { label: inicio.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), inicio, fin, cerrados: 0 }
    })
    cerrados.forEach((t) => {
      const d = tsToDate(t.fechaCierre!)
      const semana = semanas.find((s) => d >= s.inicio && d <= s.fin)
      if (semana) semana.cerrados++
    })

    return { slaDias, tallerDias, semanas, cerradosCount: cerrados.length }
  }, [tickets, heladeras])

  const tarjetas: { id: Categoria; label: string; value: number; tone?: 'warn' | 'good' }[] = [
    { id: 'disponibles',   label: 'Disponibles',      value: grupos.disponibles.length, tone: 'good' },
    { id: 'pintura',       label: 'En pintura',       value: grupos.pintura.length },
    { id: 'refrigeracion', label: 'En refrigeración', value: grupos.refrigeracion.length },
    { id: 'deposito',      label: 'En depósito',      value: grupos.deposito.length },
    { id: 'asignados',     label: 'Asignados',        value: grupos.asignados.length },
    { id: 'service',       label: 'Service tomados',  value: grupos.service.length, tone: 'warn' },
  ]

  const heladeraCols = ['Código', 'Modelo', 'Serie']
  const heladeraFilas = (lista: Heladera[]) => lista.map((h) => [h.codigoInterno, h.modelo, h.numeroSerie])

  const asignadosCols = ['Código', 'Modelo', 'Serie', 'Cliente']
  const asignadosFilas = (lista: Heladera[]) => lista.map((h) => [h.codigoInterno, h.modelo, h.numeroSerie, h.clienteAsignadoNombre ?? '—'])

  const serviceCols = ['Heladera', 'Cliente', 'Motivo', 'Estado', 'Asignado a']
  const serviceFilas = (lista: TicketServicio[]) => lista.map((t) => [
    t.heladeraCodigo, t.clientName, t.motivoNombre, ESTADO_TICKET_LABELS[t.estado] ?? t.estado, t.asignadoA?.nombre ?? '—',
  ])

  function datosDe(cat: Categoria): { titulo: string; cols: string[]; filas: (string | number)[][] } {
    switch (cat) {
      case 'disponibles':   return { titulo: 'Equipos disponibles',      cols: heladeraCols, filas: heladeraFilas(grupos.disponibles) }
      case 'pintura':       return { titulo: 'Equipos en pintura',       cols: heladeraCols, filas: heladeraFilas(grupos.pintura) }
      case 'refrigeracion': return { titulo: 'Equipos en refrigeración', cols: heladeraCols, filas: heladeraFilas(grupos.refrigeracion) }
      case 'deposito':      return { titulo: 'Equipos en depósito',      cols: heladeraCols, filas: heladeraFilas(grupos.deposito) }
      case 'asignados':     return { titulo: 'Equipos asignados',        cols: asignadosCols, filas: asignadosFilas(grupos.asignados) }
      case 'service':       return { titulo: 'Service tomados',          cols: serviceCols, filas: serviceFilas(grupos.service) }
    }
  }

  const exportarExcel = (cat: Categoria) => {
    const { titulo, cols, filas } = datosDe(cat)
    const rows = filas.map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i]])))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), titulo.slice(0, 31))
    XLSX.writeFile(wb, `${titulo.toLowerCase().replace(/\s+/g, '-')}.xlsx`)
  }

  const imprimir = (cat: Categoria) => {
    const { titulo, cols, filas } = datosDe(cat)
    generateListadoPdf(titulo, cols, filas)
  }

  const loading = loadingHeladeras || loadingTickets
  if (loading) return <LoadingSpinner fullScreen />

  const catAbierta = abierta ? datosDe(abierta) : null

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informes</h1>
          <p className="text-gray-500 text-sm">Tocá una tarjeta para ver el listado completo</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {tarjetas.map((t) => (
            <KpiTile
              key={t.id}
              value={t.value}
              label={t.label}
              tone={t.tone}
              active={abierta === t.id}
              onClick={() => setAbierta((prev) => (prev === t.id ? null : t.id))}
            />
          ))}
        </div>

        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Tiempos y SLA</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <KpiTile
              value={metricas.slaDias !== null ? Math.round(metricas.slaDias * 10) / 10 : 0}
              label={`SLA service (días)${metricas.cerradosCount === 0 ? ' · sin datos' : ''}`}
              active={false}
              onClick={() => {}}
            />
            <KpiTile
              value={metricas.tallerDias !== null ? Math.round(metricas.tallerDias * 10) / 10 : 0}
              label={`Tiempo en taller (días)${metricas.tallerDias === null ? ' · sin datos' : ''}`}
              active={false}
              onClick={() => {}}
            />
          </div>

          {metricas.cerradosCount > 0 && (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Tickets de service cerrados por semana</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={metricas.semanas} margin={{ top: 4, right: 12, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#6B7280' }} itemStyle={{ color: '#1D9E75' }}
                    cursor={{ fill: 'rgba(29,158,117,0.06)' }}
                  />
                  <Bar dataKey="cerrados" name="Cerrados" fill="#1D9E75" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {catAbierta && (
          <section className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[#D3D1C7]">
              <h2 className="text-sm font-semibold text-gray-900">{catAbierta.titulo}</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportarExcel(abierta as Categoria)}
                  disabled={catAbierta.filas.length === 0}
                  className="flex items-center gap-1.5 text-xs bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 hover:border-accent transition-colors disabled:opacity-40"
                >
                  <Download size={12} /> Excel
                </button>
                <button
                  onClick={() => imprimir(abierta as Categoria)}
                  disabled={catAbierta.filas.length === 0}
                  className="flex items-center gap-1.5 text-xs bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 hover:border-accent transition-colors disabled:opacity-40"
                >
                  <Printer size={12} /> PDF
                </button>
              </div>
            </div>

            {catAbierta.filas.length === 0 ? (
              <p className="text-gray-400 text-sm p-4">No hay equipos en esta categoría.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#D3D1C7] bg-[#F8F7F2]">
                      {catAbierta.cols.map((c) => (
                        <th key={c} className="text-left text-gray-500 text-xs py-2.5 px-4 font-medium whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catAbierta.filas.map((fila, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        {fila.map((celda, j) => (
                          <td key={j} className="py-2 px-4 text-gray-700 whitespace-nowrap">{celda}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
