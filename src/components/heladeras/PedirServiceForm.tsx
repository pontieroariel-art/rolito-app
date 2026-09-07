import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useMotivosReparacion } from '@/hooks/useReparacionCatalogos'
import { crearTicket, nuevoTicketId, subirFotoTicket, type Actor } from '@/services/ticketServicioService'
import { reportError } from '@/services/observability'
import type { Heladera, TicketServicio } from '@/types'

const inputClass = 'w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Formulario de pedido de service para una heladera en comodato: motivo del
// catálogo, observación y foto opcional (Storage). Lo usa el supervisor desde
// la ficha del cliente y desde la ficha de la heladera (QR de la etiqueta).
export default function PedirServiceForm({ heladera, actor, origen, onCreado, onCancel }: {
  heladera: Heladera
  actor:    Actor
  origen:   'supervisor'
  onCreado: (ticket: TicketServicio) => void
  onCancel: () => void
}) {
  const { motivos, isLoading } = useMotivosReparacion()
  const [motivoId, setMotivoId] = useState('')
  const [observacion, setObservacion] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const elegirFoto = (file: File | null) => {
    if (fotoPreview) URL.revokeObjectURL(fotoPreview)
    setFoto(file)
    setFotoPreview(file ? URL.createObjectURL(file) : null)
  }

  const enviar = async () => {
    const motivo = motivos.find((m) => m.id === motivoId)
    if (!motivo) { setError('Elegí el motivo.'); return }
    if (!heladera.clienteAsignadoId) { setError('Esta heladera no está asignada a un cliente.'); return }
    setGuardando(true)
    setError('')
    try {
      const id = nuevoTicketId()
      let fotoUrl: string | null = null
      if (foto) {
        try {
          fotoUrl = await subirFotoTicket(id, foto)
        } catch (err) {
          // Sin foto igual vale el pedido: se avisa y se sigue.
          reportError(err, { origen: 'PedirServiceForm.foto', ticketId: id })
          fotoUrl = null
        }
      }
      const ticket = await crearTicket({
        id,
        heladeraId:     heladera.id,
        heladeraCodigo: heladera.codigoInterno,
        clientId:       heladera.clienteAsignadoId,
        clientName:     heladera.clienteAsignadoNombre ?? '—',
        direccionId:    heladera.clienteAsignadoDireccionId ?? null,
        direccion:      heladera.clienteAsignadoDireccion ?? null,
        motivoId:       motivo.id,
        motivoNombre:   motivo.nombre,
        requiereChofer: !!motivo.requiereChofer,
        urgente:        !!motivo.urgente,
        observacion,
        fotoUrl,
        origen,
      }, actor)
      if (foto && !fotoUrl) setError('El pedido se creó, pero la foto no se pudo subir.')
      onCreado(ticket)
    } catch (err) {
      reportError(err, { origen: 'PedirServiceForm', heladeraId: heladera.id })
      setError('No se pudo crear el pedido. Revisá la señal y probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const activos = motivos.filter((m) => m.activo)
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        <span className="font-medium text-gray-900">{heladera.codigoInterno}</span> · {heladera.modelo}
        {heladera.clienteAsignadoDireccion ? <> — {heladera.clienteAsignadoDireccion}</> : null}
      </p>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Motivo</label>
        <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} className={inputClass} disabled={isLoading}>
          <option value="">{isLoading ? 'Cargando motivos…' : 'Elegí un motivo…'}</option>
          {activos.map((m) => (
            <option key={m.id} value={m.id}>{m.nombre}{m.urgente ? ' (urgente)' : ''}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Observación (opcional)</label>
        <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={3} maxLength={500}
          placeholder="Qué pasa, desde cuándo, a quién preguntar…" className={inputClass} />
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Foto del problema (opcional)</label>
        {fotoPreview ? (
          <div className="relative inline-block">
            <img src={fotoPreview} alt="Foto del problema" className="h-32 rounded-lg border border-[#D3D1C7] object-cover" />
            <button type="button" onClick={() => elegirFoto(null)} aria-label="Quitar foto"
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-[#D3D1C7] flex items-center justify-center text-gray-600 shadow">
              <X size={14} />
            </button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 rounded-lg border border-[#D3D1C7] bg-white px-3 py-2 text-sm text-gray-700 cursor-pointer active:scale-[0.98]">
            <Camera size={16} className="text-accent" /> Sacar foto
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={guardando}>Cancelar</Button>
        <Button onClick={enviar} loading={guardando} disabled={!motivoId} className="flex-1">Pedir service</Button>
      </div>
    </div>
  )
}
