import { useState } from 'react'
import { Snowflake, Wrench, History } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useHeladerasPorCliente } from '../../hooks/useHeladerasPorCliente'
import { useTicketsPorCliente } from '../../hooks/useTicketsPorCliente'
import { useAsignacionesPorCliente } from '../../hooks/useAsignacionesPorCliente'
import { useMotivosReparacion } from '../../hooks/useReparacionCatalogos'
import { crearTicket } from '../../services/ticketServicioService'
import { ESTADO_TICKET_LABELS, ESTADO_TICKET_STYLES } from '../../utils/heladeraLabels'
import { formatShortDate } from '../../utils/helpers'
import { AsignacionHeladera, Heladera, TicketServicio } from '../../types'

function FreezerCard({ heladera, onPedirService }: { heladera: Heladera; onPedirService: (h: Heladera) => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl bg-[#E8F5F0] text-accent flex items-center justify-center shrink-0">
        <Snowflake size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900">{heladera.modelo}</p>
        <p className="text-xs text-gray-500">
          Código {heladera.codigoInterno} · Serie {heladera.numeroSerie}
        </p>
        {heladera.fechaAsignacion && (
          <p className="text-xs text-gray-400 mt-0.5">Desde el {formatShortDate(heladera.fechaAsignacion)}</p>
        )}
      </div>
      <button
        onClick={() => onPedirService(heladera)}
        className="shrink-0 text-xs font-medium text-accent border border-accent/40 rounded-lg px-3 py-1.5 hover:bg-accent/10"
      >
        Pedir service
      </button>
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

function AsignacionCard({ asignacion }: { asignacion: AsignacionHeladera }) {
  const esRetiro = asignacion.tipo === 'retiro'
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 text-sm">{asignacion.heladeraCodigo}</p>
        <p className="text-xs text-gray-500">{formatShortDate(asignacion.fecha)}</p>
        {esRetiro && asignacion.motivo && (
          <p className="text-xs text-gray-400 mt-0.5">{asignacion.motivo}</p>
        )}
      </div>
      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${
        esRetiro ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-green-100 text-green-700 border-green-200'
      }`}>
        {esRetiro ? 'Retirada' : 'Asignada'}
      </span>
    </div>
  )
}

export default function MyFreezers() {
  const { user } = useAuth()
  const { heladeras, loading: loadingHeladeras, timedOut: timedOutHeladeras } = useHeladerasPorCliente(user?.uid ?? null)
  const { tickets, loading: loadingTickets, timedOut: timedOutTickets } = useTicketsPorCliente(user?.uid ?? null)
  const { asignaciones, loading: loadingAsignaciones, timedOut: timedOutAsignaciones } = useAsignacionesPorCliente(user?.uid ?? null)
  const timedOut = timedOutHeladeras || timedOutTickets || timedOutAsignaciones
  const { motivos } = useMotivosReparacion()

  const [heladeraParaService, setHeladeraParaService] = useState<Heladera | null>(null)
  const [motivoId, setMotivoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cerrarModal = () => { setHeladeraParaService(null); setMotivoId(''); setError('') }

  const handlePedirService = async () => {
    if (!user || !heladeraParaService || !motivoId) return
    const motivo = motivos.find((m) => m.id === motivoId)
    if (!motivo) { setError('Elegí un motivo válido'); return }
    setSaving(true)
    setError('')
    try {
      await crearTicket({
        heladeraId:     heladeraParaService.id,
        heladeraCodigo: heladeraParaService.codigoInterno,
        clientId:       user.uid,
        clientName:     user.razonSocial,
        motivoId:       motivo.id,
        motivoNombre:   motivo.nombre,
        requiereChofer: !!motivo.requiereChofer,
        urgente:        !!motivo.urgente,
      }, { uid: user.uid, nombre: user.nombre })
      cerrarModal()
    } catch {
      setError('No se pudo pedir el service. Intentá de nuevo.')
      setSaving(false)
    }
  }

  if ((loadingHeladeras || loadingTickets || loadingAsignaciones) && !timedOut) {
    return <><Navbar /><LoadingSpinner fullScreen className="bg-white" /></>
  }
  if (timedOut) return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 pt-10 text-center space-y-3">
        <p className="text-4xl">⚠️</p>
        <p className="text-red-600 font-semibold">No se pudo conectar</p>
        <p className="text-gray-500 text-sm">Revisá tu conexión a internet e intentá de nuevo.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-sm border border-accent text-accent rounded-lg px-4 py-2 hover:bg-accent/10 transition-colors"
        >
          Reintentar
        </button>
      </main>
    </div>
  )

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-24 md:pb-10">
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
              {heladeras.map((h) => <FreezerCard key={h.id} heladera={h} onPedirService={setHeladeraParaService} />)}
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

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <History size={14} /> Historial de comodatos
          </h2>
          {asignaciones.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <p className="text-gray-400 text-sm">Todavía no tuviste movimientos de equipos.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {asignaciones.map((a) => <AsignacionCard key={a.id} asignacion={a} />)}
            </div>
          )}
        </section>
      </main>

      <Modal open={!!heladeraParaService} onClose={cerrarModal} title="Pedir service" variant="light">
        {heladeraParaService && (
          <div className="space-y-4">
            <div className="bg-[#F8F7F2] border border-gray-200 rounded-xl p-3">
              <p className="text-sm font-medium text-gray-900">{heladeraParaService.codigoInterno}</p>
              <p className="text-xs text-gray-500">{heladeraParaService.modelo} · serie {heladeraParaService.numeroSerie}</p>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">¿Qué le pasa?</label>
              <select
                value={motivoId}
                onChange={(e) => setMotivoId(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Elegí un motivo…</option>
                {motivos.filter((m) => m.activo).map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
            </div>

            {error && <p className="text-red-500 text-xs">{error}</p>}
            <Button onClick={handlePedirService} loading={saving} disabled={!motivoId} className="w-full">
              Pedir service
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
