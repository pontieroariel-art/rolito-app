import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import * as XLSX from 'xlsx'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import KpiTile from '../../components/heladeras/KpiTile'
import { useHeladeras } from '../../hooks/useHeladeras'
import { useTicketsServicio } from '../../hooks/useTicketsServicio'
import { generateListadoPdf } from '../../utils/pdf'
import { Heladera, TicketServicio } from '../../types'

const ESTADO_TICKET_LABELS: Record<string, string> = {
  abierto: 'Abierto', asignado_tecnico: 'Con técnico', asignado_chofer: 'Con chofer',
}

type Categoria = 'disponibles' | 'pintura' | 'refrigeracion' | 'deposito' | 'asignados' | 'service'

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
