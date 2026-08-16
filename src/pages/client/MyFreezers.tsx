import { Snowflake, Wrench } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useHeladerasPorCliente } from '../../hooks/useHeladerasPorCliente'
import { useTicketsPorCliente } from '../../hooks/useTicketsPorCliente'
import { ESTADO_TICKET_LABELS, ESTADO_TICKET_STYLES } from '../../utils/heladeraLabels'
import { formatShortDate } from '../../utils/helpers'
import { Heladera, TicketServicio } from '../../types'

function FreezerCard({ heladera }: { heladera: Heladera }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-[#E8F5F0] text-accent flex items-center justify-center shrink-0">
        <Snowflake size={20} />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{heladera.modelo}</p>
        <p className="text-xs text-gray-500">
          Código {heladera.codigoInterno} · Serie {heladera.numeroSerie}
        </p>
        {heladera.fechaAsignacion && (
          <p className="text-xs text-gray-400 mt-0.5">Desde el {formatShortDate(heladera.fechaAsignacion)}</p>
        )}
      </div>
    </div>
  )
}

function TicketCard({ ticket }: { ticket: TicketServicio }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm">{ticket.heladeraCodigo} — {ticket.motivoNombre}</p>
          <p className="text-xs text-gray-500">Pedido el {formatShortDate(ticket.fechaPedido)}</p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${ESTADO_TICKET_STYLES[ticket.estado]}`}>
          {ESTADO_TICKET_LABELS[ticket.estado]}
        </span>
      </div>
      {ticket.trabajoRealizado && (
        <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">{ticket.trabajoRealizado}</p>
      )}
      {ticket.fechaCierre && (
        <p className="text-xs text-gray-400">Cerrado el {formatShortDate(ticket.fechaCierre)}</p>
      )}
    </div>
  )
}

export default function MyFreezers() {
  const { user } = useAuth()
  const { heladeras, loading: loadingHeladeras } = useHeladerasPorCliente(user?.uid ?? null)
  const { tickets, loading: loadingTickets } = useTicketsPorCliente(user?.uid ?? null)

  if (loadingHeladeras || loadingTickets) return <><Navbar /><LoadingSpinner fullScreen className="bg-white" /></>

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mis heladeras</h1>
          <p className="text-gray-500 text-sm mt-1">Equipos en comodato y estado de tus pedidos de service</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Snowflake size={14} /> Equipos en comodato
          </h2>
          {heladeras.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-400 text-sm">No tenés heladeras asignadas por el momento.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {heladeras.map((h) => <FreezerCard key={h.id} heladera={h} />)}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Wrench size={14} /> Historial de service
          </h2>
          {tickets.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-400 text-sm">Todavía no pediste ningún service.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => <TicketCard key={t.id} ticket={t} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
