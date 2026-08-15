import { useMemo, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useTicketsAsignadosAMi } from '../../hooks/useTicketsAsignadosAMi'
import { marcarHechoChofer, Actor } from '../../services/ticketServicioService'
import { TicketServicio } from '../../types'
import { tsToDate } from '../../utils/helpers'

function MarcarHechoModal({ ticket, actor, onClose }: { ticket: TicketServicio; actor: Actor; onClose: () => void }) {
  const [detalle, setDetalle] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async () => {
    if (!detalle.trim()) { setError('Contá qué hiciste (retiré/entregué el equipo, etc.)'); return }
    setSaving(true)
    setError('')
    try {
      await marcarHechoChofer(ticket.id, actor, detalle.trim())
      onClose()
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Marcar hecho — ${ticket.heladeraCodigo}`}>
      <div className="space-y-4">
        <textarea
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          rows={3}
          placeholder="Ej: retiré la heladera, entregué el equipo nuevo…"
          className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <p className="text-xs text-gray-400">El encargado cierra el ticket desde Consulta de service.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Guardar</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function TicketsServicioSection({ uid, actor }: { uid: string | null; actor: Actor | null }) {
  const { tickets } = useTicketsAsignadosAMi(uid)
  const [seleccionado, setSeleccionado] = useState<TicketServicio | null>(null)

  const pendientes = useMemo(() => tickets.filter((t) => t.estado === 'asignado_chofer'), [tickets])

  if (pendientes.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Traslados de heladeras</h2>
      <div className="space-y-2">
        {pendientes.map((t) => (
          <div key={t.id} className="bg-white border border-[#D3D1C7] rounded-2xl p-4 space-y-2 shadow-sm">
            <div>
              <p className="font-semibold text-sm text-gray-900">{t.heladeraCodigo} — {t.clientName}</p>
              <p className="text-gray-500 text-xs mt-0.5">{t.motivoNombre} · {tsToDate(t.fechaPedido).toLocaleDateString('es-AR')}</p>
              {t.trabajoRealizado && <p className="text-xs text-accent mt-1">Ya registraste: {t.trabajoRealizado}</p>}
            </div>
            <Button className="text-xs py-2 px-4" onClick={() => setSeleccionado(t)}>Marcar hecho</Button>
          </div>
        ))}
      </div>

      {seleccionado && actor && (
        <MarcarHechoModal ticket={seleccionado} actor={actor} onClose={() => setSeleccionado(null)} />
      )}
    </section>
  )
}
