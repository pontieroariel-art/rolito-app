import { useMemo, useRef, useState } from 'react'
import { Printer, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SignaturePad, { SignaturePadHandle } from '../../components/heladeras/SignaturePad'
import { useAuth } from '../../context/AuthContext'
import { useTicketsServicio } from '../../hooks/useTicketsServicio'
import { useTecnicos } from '../../hooks/useTecnicos'
import { useChoferes } from '../../hooks/useChoferes'
import { useModelosHeladera } from '../../hooks/useModelosHeladera'
import {
  asignarATecnico, asignarAChofer, cerrarTicket, anularTicket,
  Actor, TicketNoDisponibleError,
} from '../../services/ticketServicioService'
import { getHeladera } from '../../services/heladeraService'
import { getUserDocument } from '../../services/userService'
import { generatePedidoReparacion } from '../../utils/pdf'
import { TicketServicio, getPrimaryAddress } from '../../types'
import { tsToDate } from '../../utils/helpers'
import { ESTADO_TICKET_LABELS as ESTADO_LABELS, ESTADO_TICKET_STYLES as ESTADO_STYLES } from '../../utils/heladeraLabels'

type Tab = 'abiertos' | 'curso' | 'cerrados'

function AsignarModal({ ticket, actor, onClose }: { ticket: TicketServicio; actor: Actor; onClose: () => void }) {
  const { tecnicos } = useTecnicos()
  const { choferes }  = useChoferes()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const opciones = ticket.requiereChofer
    ? choferes.map((c) => ({ uid: c.uid, nombre: c.nombre }))
    : tecnicos.filter((t) => t.estado === 'activo').map((t) => ({ uid: t.uid, nombre: t.nombre }))

  const asignar = async (persona: { uid: string; nombre: string }) => {
    setSaving(true)
    setError('')
    try {
      if (ticket.requiereChofer) await asignarAChofer(ticket.id, persona, actor)
      else await asignarATecnico(ticket.id, persona, actor)
      onClose()
    } catch (err) {
      setError(err instanceof TicketNoDisponibleError ? err.message : 'No se pudo asignar. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Asignar ${ticket.heladeraCodigo}`}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          {ticket.requiereChofer ? 'Este motivo requiere un chofer (traslado de equipo).' : 'Elegí un técnico para este service.'}
        </p>
        {opciones.length === 0 ? (
          <p className="text-amber-600 text-sm">No hay {ticket.requiereChofer ? 'choferes' : 'técnicos'} disponibles.</p>
        ) : (
          <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {opciones.map((p) => (
              <button key={p.uid} disabled={saving} onClick={() => asignar(p)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 disabled:opacity-50">
                {p.nombre}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <Button variant="outline" onClick={onClose} className="w-full">Cancelar</Button>
      </div>
    </Modal>
  )
}

function CerrarModal({ ticket, actor, onClose }: { ticket: TicketServicio; actor: Actor; onClose: () => void }) {
  const [nombre, setNombre] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const padRef = useRef<SignaturePadHandle>(null)

  const handleSubmit = async () => {
    const firma = padRef.current?.toDataURL()
    if (!nombre.trim()) { setError('Falta el nombre de quien confirma'); return }
    if (!firma) { setError('Falta la firma'); return }
    setSaving(true)
    setError('')
    try {
      await cerrarTicket(ticket.id, actor, firma, nombre.trim(), ticket.clientId)
      onClose()
    } catch {
      setError('No se pudo cerrar. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Cerrar ${ticket.heladeraCodigo}`}>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nombre de quien confirma</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Firma</label>
          <SignaturePad ref={padRef} />
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Cerrar ticket</Button>
        </div>
      </div>
    </Modal>
  )
}

function AnularModal({ ticket, actor, onClose }: { ticket: TicketServicio; actor: Actor; onClose: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleSubmit = async () => {
    if (!motivo.trim()) { setError('Contá el motivo de la anulación'); return }
    setSaving(true)
    setError('')
    try {
      await anularTicket(ticket.id, actor, motivo.trim())
      onClose()
    } catch {
      setError('No se pudo anular. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Anular ${ticket.heladeraCodigo}`}>
      <div className="space-y-4">
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Motivo de la anulación"
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button className="flex-1 bg-red-500 hover:bg-red-600" loading={saving} onClick={handleSubmit}>Anular</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function ConsultaServicePage() {
  const { user } = useAuth()
  const { tickets, loading } = useTicketsServicio()
  const { modelos } = useModelosHeladera()
  const [tab, setTab] = useState<Tab>('abiertos')
  const [asignarTicket, setAsignarTicket] = useState<TicketServicio | null>(null)
  const [cerrarTicketSel, setCerrarTicketSel] = useState<TicketServicio | null>(null)
  const [anularTicketSel, setAnularTicketSel] = useState<TicketServicio | null>(null)
  const [imprimiendo, setImprimiendo] = useState<string | null>(null)

  const actor: Actor | null = user ? { uid: user.uid, nombre: user.nombre } : null

  const filtrados = useMemo(() => {
    let lista: TicketServicio[]
    if (tab === 'abiertos') lista = tickets.filter((t) => t.estado === 'abierto')
    else if (tab === 'curso') lista = tickets.filter((t) => t.estado === 'asignado_tecnico' || t.estado === 'asignado_chofer')
    else lista = tickets.filter((t) => t.estado === 'cerrado' || t.estado === 'anulado')
    return [...lista].sort((a, b) => Number(b.urgente) - Number(a.urgente))
  }, [tickets, tab])

  const imprimirPedido = async (ticket: TicketServicio) => {
    setImprimiendo(ticket.id)
    try {
      const [heladera, cliente] = await Promise.all([getHeladera(ticket.heladeraId), getUserDocument(ticket.clientId)])
      const modelo = heladera ? modelos.find((m) => m.id === heladera.modeloId) : undefined
      await generatePedidoReparacion({
        ticket: { numero: ticket.numero, motivoNombre: ticket.motivoNombre, fechaPedido: tsToDate(ticket.fechaPedido), estado: ticket.estado },
        heladera: {
          codigoInterno: heladera?.codigoInterno ?? ticket.heladeraCodigo,
          modelo:        heladera?.modelo ?? '',
          numeroSerie:   heladera?.numeroSerie ?? '',
          medidas:       modelo?.medidas,
          fotoUrl:       modelo?.fotoUrl,
        },
        cliente: {
          razonSocial:   cliente?.razonSocial ?? ticket.clientName,
          cuit:           cliente?.cuit ?? '',
          codigoCliente:  cliente?.codigoCliente,
          direccion:      (cliente && (getPrimaryAddress(cliente)?.address || cliente.address)) || '',
        },
      })
    } finally {
      setImprimiendo(null)
    }
  }

  if (loading) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Consulta de service</h1>
            <p className="text-gray-500 text-sm">Asignar, cerrar y anular tickets</p>
          </div>
          <Link to="/heladeras/toma-service">
            <Button className="text-sm flex items-center gap-1.5"><Plus size={15} /> Nuevo ticket</Button>
          </Link>
        </div>

        <div className="flex gap-2">
          {(['abiertos', 'curso', 'cerrados'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium ${tab === t ? 'bg-accent/10 text-accent border-accent/40' : 'border-[#D3D1C7] text-gray-500'}`}
            >
              {t === 'abiertos' ? 'Abiertos' : t === 'curso' ? 'En curso' : 'Cerrados/Anulados'}
            </button>
          ))}
        </div>

        {filtrados.length === 0 ? (
          <p className="text-gray-400 text-sm">No hay tickets en esta categoría.</p>
        ) : (
          <div className="space-y-2">
            {filtrados.map((t) => (
              <div key={t.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-900">{t.heladeraCodigo} — {t.clientName}</p>
                    <p className="text-xs text-gray-500">{t.motivoNombre} · {tsToDate(t.fechaPedido).toLocaleDateString('es-AR')}</p>
                    {t.asignadoA && <p className="text-xs text-gray-500 mt-0.5">Asignado a {t.asignadoA.nombre} ({t.asignadoA.tipo})</p>}
                    {t.trabajoRealizado && <p className="text-xs text-gray-500 mt-0.5">Trabajo: {t.trabajoRealizado}</p>}
                    {t.motivoAnulacion && <p className="text-xs text-red-500 mt-0.5">Anulado: {t.motivoAnulacion}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.urgente && (
                      <span className="text-xs px-2 py-1 rounded-full border font-medium bg-red-100 text-red-700 border-red-200">
                        Urgente
                      </span>
                    )}
                    <span className={`text-xs px-2 py-1 rounded-full border font-medium ${ESTADO_STYLES[t.estado]}`}>
                      {ESTADO_LABELS[t.estado] ?? t.estado}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.estado === 'abierto' && (
                    <Button size="sm" onClick={() => setAsignarTicket(t)}>Asignar</Button>
                  )}
                  {(t.estado === 'asignado_tecnico' || t.estado === 'asignado_chofer') && (
                    <>
                      <Button size="sm" onClick={() => setCerrarTicketSel(t)}>Cerrar</Button>
                      <Button size="sm" variant="outline" className="text-red-500 border-red-200 hover:bg-red-50" onClick={() => setAnularTicketSel(t)}>Anular</Button>
                    </>
                  )}
                  {t.estado === 'abierto' && (
                    <Button size="sm" variant="outline" className="text-red-500 border-red-200 hover:bg-red-50" onClick={() => setAnularTicketSel(t)}>Anular</Button>
                  )}
                  <Button size="sm" variant="outline" loading={imprimiendo === t.id} onClick={() => imprimirPedido(t)}>
                    <Printer size={13} className="mr-1 inline" /> Imprimir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {asignarTicket && actor && <AsignarModal ticket={asignarTicket} actor={actor} onClose={() => setAsignarTicket(null)} />}
      {cerrarTicketSel && actor && <CerrarModal ticket={cerrarTicketSel} actor={actor} onClose={() => setCerrarTicketSel(null)} />}
      {anularTicketSel && actor && <AnularModal ticket={anularTicketSel} actor={actor} onClose={() => setAnularTicketSel(null)} />}
    </div>
  )
}
