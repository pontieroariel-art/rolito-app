import { useState, useRef } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import SignaturePad, { SignaturePadHandle } from './SignaturePad'
import { renovarComodato, Actor } from '../../services/asignacionHeladeraService'
import { generateContratoComodato } from '../../utils/pdf'
import { getUserDocument } from '../../services/userService'
import { Heladera } from '../../types'

// Re-firma el mismo contrato con fecha y número nuevos — no genera orden de
// entrega (no hay traslado físico, el equipo sigue en el mismo lugar).
export default function RenovarComodatoModal({
  heladera, actor, onClose,
}: {
  heladera: Heladera
  actor:    Actor
  onClose:  () => void
}) {
  const [firmanteNombre, setFirmanteNombre] = useState('')
  const [firmanteCargo,  setFirmanteCargo]  = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')
  const padRef = useRef<SignaturePadHandle>(null)

  const handleSubmit = async () => {
    if (!firmanteNombre.trim() || !firmanteCargo.trim()) { setError('Completá nombre y cargo de quién firma'); return }
    const firma = padRef.current?.toDataURL()
    if (!firma) { setError('Falta la firma del cliente'); return }
    setSaving(true)
    setError('')
    try {
      const firmante = { nombre: firmanteNombre.trim(), cargo: firmanteCargo.trim() }
      const asignacion = await renovarComodato(heladera.id, actor, firma, firmante)
      const cliente = heladera.clienteAsignadoId ? await getUserDocument(heladera.clienteAsignadoId) : null
      await generateContratoComodato({
        numero:   asignacion.numero,
        fecha:    asignacion.fecha.toDate(),
        heladera: { modelo: heladera.modelo, numeroSerie: heladera.numeroSerie },
        cliente:  {
          razonSocial: heladera.clienteAsignadoNombre ?? '—',
          cuit:        cliente?.cuit ?? '',
          direccion:   heladera.clienteAsignadoDireccion ?? '',
        },
        firmante,
        firmaDataUrl: firma,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo renovar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Renovar comodato — ${heladera.codigoInterno}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Se vuelve a firmar el contrato de <span className="font-medium text-gray-900">{heladera.clienteAsignadoNombre}</span>
          {heladera.clienteAsignadoDireccion ? <> — {heladera.clienteAsignadoDireccion}</> : null}, por 12 meses más.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Nombre de quien firma</label>
            <input
              value={firmanteNombre}
              onChange={(e) => setFirmanteNombre(e.target.value)}
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Cargo</label>
            <input
              value={firmanteCargo}
              onChange={(e) => setFirmanteCargo(e.target.value)}
              placeholder="Encargado, dueño, gerente…"
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Firma del cliente</label>
          <SignaturePad ref={padRef} />
        </div>

        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Renovar y firmar</Button>
        </div>
      </div>
    </Modal>
  )
}
