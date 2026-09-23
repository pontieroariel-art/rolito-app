import { useState, useRef, useMemo } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import SignaturePad, { SignaturePadHandle } from './SignaturePad'
import { retirarHeladera, Actor } from '../../services/asignacionHeladeraService'
import { reportError } from '../../services/observability'
import { getUserDocument } from '../../services/userService'
import { generateRemitoComodato } from '../../utils/pdf'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { envioDeCliente } from '@/utils/envioComprobante'
import { useMotivosIngreso } from '../../hooks/useMotivosIngreso'
import { CatalogoPasos } from '../../utils/heladeraPipeline'
import { Heladera, getPrimaryAddress } from '../../types'

export default function RetirarEquipoModal({
  heladera, actor, catalogo, onClose,
}: {
  heladera: Heladera
  actor:    Actor
  catalogo: CatalogoPasos
  onClose:  () => void
}) {
  const { motivos } = useMotivosIngreso()
  const motivosActivos = useMemo(() => motivos.filter((m) => m.activo), [motivos])
  const [motivoId, setMotivoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const { abrir } = useVisorComprobante()
  const padRef = useRef<SignaturePadHandle>(null)

  const handleSubmit = async () => {
    const firma = padRef.current?.toDataURL()
    if (!firma) { setError('Falta la firma del cliente'); return }
    const motivo = motivosActivos.find((m) => m.id === motivoId)
    if (!motivo) { setError('Elegí el motivo de ingreso'); return }
    setSaving(true)
    setError('')
    try {
      const clientePrevio = heladera.clienteAsignadoId ? await getUserDocument(heladera.clienteAsignadoId) : null
      const asignacion = await retirarHeladera(heladera.id, actor, firma, motivo, catalogo)
      const blob = await generateRemitoComodato({
        numero:   asignacion.numero,
        tipo:     'retiro',
        fecha:    asignacion.fecha.toDate(),
        heladera: { codigoInterno: heladera.codigoInterno, modelo: heladera.modelo, numeroSerie: heladera.numeroSerie },
        cliente:  {
          razonSocial: asignacion.clientName,
          cuit:        clientePrevio?.cuit ?? '',
          direccion:   (clientePrevio && (getPrimaryAddress(clientePrevio)?.address || clientePrevio.address)) || '',
        },
        firmaDataUrl: firma,
        actorNombre:  actor.nombre,
      })
      onClose()
      abrir({ blob, nombre: `remito-comodato-${asignacion.numero}.pdf`, titulo: `Remito de retiro Nº ${asignacion.numero}`, subtitulo: `${asignacion.clientName} · ${heladera.codigoInterno}`,
        envio: envioDeCliente(clientePrevio, { tipo: 'RETIRO', numero: String(asignacion.numero), titulo: `Remito de retiro Nº ${asignacion.numero}`, mensaje: `Te enviamos el remito del retiro de la heladera ${heladera.codigoInterno}.`, clienteNombre: asignacion.clientName }) })
    } catch (err) {
      reportError(err, { origen: 'RetirarEquipoModal', accion: 'retirar heladera' })
      setError(err instanceof Error ? err.message : 'No se pudo retirar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Retirar ${heladera.codigoInterno}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-secundario">
          Se retira de <span className="font-medium text-gray-900">{heladera.clienteAsignadoNombre}</span> y entra al taller para reacondicionamiento.
        </p>

        <div>
          <label className="text-xs text-secundario mb-1 block">Motivo de ingreso</label>
          <select
            value={motivoId}
            onChange={(e) => setMotivoId(e.target.value)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Elegí un motivo…</option>
            {motivosActivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
          {motivosActivos.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">Todavía no hay motivos cargados — agregá uno primero en "Catálogos de service".</p>
          )}
        </div>

        <div>
          <label className="text-xs text-secundario mb-1 block">Firma del cliente</label>
          <SignaturePad ref={padRef} />
        </div>

        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Retirar y generar remito</Button>
        </div>
      </div>
    </Modal>
  )
}
