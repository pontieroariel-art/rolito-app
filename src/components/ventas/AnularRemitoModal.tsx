import { useState } from 'react'
import { Ban } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { anularRemitoChofer } from '@/services/ventaCamionService'
import { reportError } from '@/services/observability'
import { codigoComprobanteInterno } from '@/utils/numeracionInterna'
import { MOTIVOS_ANULACION, type MotivoAnulacion, type VentaCamion } from '@/types'

// El chofer anula un remito de cuenta corriente desde la calle, sin
// autorización (2026-09-11, decisión de Ariel): elige el motivo y confirma. La
// venta deja de contar en su liquidación y en el stock del camión; la oficina
// recibe el aviso y anula el remito en Tango.
// Con origen 'facturacion' lo usa la oficina sobre un día ya cerrado: la
// liquidación no se reabre, el server le anota la anulación.
export default function AnularRemitoModal({ venta, actor, origen, onCerrar }: {
  venta: VentaCamion
  actor: { uid: string; nombre: string }
  origen?: 'facturacion'
  onCerrar: (anulada: boolean) => void
}) {
  const [motivo, setMotivo] = useState<MotivoAnulacion | ''>('')
  const [nota, setNota] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const numero = venta.comprobanteInterno ? codigoComprobanteInterno(venta.comprobanteInterno) : 'sin número'

  const anular = async () => {
    setError('')
    if (!motivo) { setError('Elegí el motivo.'); return }
    if (motivo === 'otro' && !nota.trim()) { setError('Con "Otro" hay que explicar qué pasó.'); return }
    if (!confirmo) { setError('Confirmá que el remito queda sin efecto.'); return }
    setGuardando(true)
    try {
      await anularRemitoChofer(venta, motivo, nota, actor, { origen })
      onCerrar(true)
    } catch (err) {
      reportError(err, { origen: 'AnularRemitoModal', ventaId: venta.id })
      setError(origen ? 'No se pudo anular. Probá de nuevo.' : 'No se pudo anular. Si pasó más de una hora desde la venta, o caja ya cerró tu liquidación, pedí la anulación a la oficina.')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-xl px-3.5 py-3 text-[15px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  return (
    <Modal open onClose={() => onCerrar(false)} title="Anular remito" variant="light">
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Remito <b>{numero}</b> · <b>{venta.clienteNombre}</b>
        </p>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 block">¿Qué pasó?</label>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoAnulacion)} className={inputClass}>
            <option value="">Elegí el motivo</option>
            {(Object.keys(MOTIVOS_ANULACION) as MotivoAnulacion[]).map((m) => <option key={m} value={m}>{MOTIVOS_ANULACION[m]}</option>)}
          </select>
        </div>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Algo más que quieras aclarar (opcional)" className={inputClass} />
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-1" />
          <span>{origen
            ? <>El remito queda sin efecto en la app y hay que <b>anularlo en Tango</b>. La liquidación de <b>{venta.choferNombre}</b> de ese día ya está cerrada: no se reabre, queda anotada la anulación.</>
            : 'El remito queda sin efecto: no cuenta en mi liquidación y la mercadería vuelve a mi camión. Si el cliente se quedó con el hielo, hago la venta correcta.'}</span>
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={() => onCerrar(false)} className="flex-1">Volver</Button>
          <Button onClick={anular} loading={guardando} className="flex-1 bg-red-600 hover:bg-red-700"><Ban size={15} className="mr-1.5" /> Anular remito</Button>
        </div>
      </div>
    </Modal>
  )
}
