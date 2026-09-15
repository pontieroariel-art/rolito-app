import { useState } from 'react'
import { Ban } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { solicitarAnulacionRecibo } from '@/services/anulacionCobranzaService'
import { reportError } from '@/services/observability'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION_RECIBO, type Cobranza, type MotivoAnulacionRecibo } from '@/types'

// El que cobró pide anular SU recibo (2026-09-15, pedido de Ariel: "un botón de
// anulación en la rendición y que autoricen los autorizados"): elige el motivo,
// explica, confirma, y la solicitud queda esperando a alguien con permiso.
// Mientras esté pendiente no cierra su día. Con la aprobación, el recibo deja
// de contar y le llega el aviso con "Hacer el recibo correcto".
export default function AnularReciboModal({ cobranza, actor, onCerrar }: {
  cobranza: Cobranza
  actor: { uid: string; nombre: string }
  onCerrar: (pedida: boolean) => void
}) {
  const [motivo, setMotivo] = useState<MotivoAnulacionRecibo | ''>('')
  const [nota, setNota] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const pedir = async () => {
    setError('')
    if (!motivo) { setError('Elegí el motivo.'); return }
    if (motivo === 'otro' && !nota.trim()) { setError('Con "Otro" hay que explicar qué pasó.'); return }
    if (!confirmo) { setError('Confirmá que entendés lo que pasa con el recibo.'); return }
    setGuardando(true)
    try {
      await solicitarAnulacionRecibo(cobranza, motivo, nota, actor)
      onCerrar(true)
    } catch (err) {
      reportError(err, { origen: 'AnularReciboModal', accion: 'error al pedir la anulación del recibo' })
      const msg = (err as { code?: string; message?: string })
      setError(msg.code === 'permission-denied'
        ? 'No se pudo pedir: puede que tu rendición de ese día ya esté cerrada, o que el recibo ya tenga una anulación.'
        : msg.message || 'No se pudo pedir la anulación. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const m = cobranza.medios

  return (
    <Modal open onClose={() => onCerrar(false)} title="Anular recibo">
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Recibo <b>{cobranza.numeroRecibo ?? 'sin número'}</b>{cobranza.tango?.reciboNumero ? <span className="text-secundario"> · Tango {cobranza.tango.reciboNumero}</span> : null} · <b>{cobranza.clienteNombre}</b> · {formatoARS(cobranza.importe)}
        </p>
        {m && (
          <ul className="border border-[#D3D1C7] rounded-lg divide-y divide-[#E7E5DC] text-sm">
            {m.efectivo > 0 && <li className="flex justify-between px-3 py-1.5"><span className="text-gray-700">Efectivo</span><span className="font-medium">{formatoARS(m.efectivo)}</span></li>}
            {m.transferencia > 0 && <li className="flex justify-between px-3 py-1.5"><span className="text-gray-700">Transferencia</span><span className="font-medium">{formatoARS(m.transferencia)}</span></li>}
            {m.cheques.map((ch, i) => <li key={i} className="flex justify-between gap-2 px-3 py-1.5"><span className="text-gray-700 truncate">Cheque {ch.numero} · {ch.bancoNombre}</span><span className="font-medium shrink-0">{formatoARS(ch.importe)}</span></li>)}
            {m.retenciones.map((r, i) => <li key={`r${i}`} className="flex justify-between gap-2 px-3 py-1.5"><span className="text-gray-700 truncate">Retención · cert. {r.nroCertificado}</span><span className="font-medium shrink-0">{formatoARS(r.importe)}</span></li>)}
          </ul>
        )}

        <div>
          <label className="text-xs text-secundario">¿Qué pasó?</label>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoAnulacionRecibo | '')} className={inputClass}>
            <option value="">Elegir motivo…</option>
            {(Object.keys(MOTIVOS_ANULACION_RECIBO) as MotivoAnulacionRecibo[]).map((k) => <option key={k} value={k}>{MOTIVOS_ANULACION_RECIBO[k]}</option>)}
          </select>
        </div>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Detalle (qué estaba mal, qué corresponde)…" className={inputClass} />

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-0.5" />
          <span>Entiendo que el recibo queda <b>anulado entero</b> cuando lo autoricen (las facturas vuelven a deber y los valores dejan de contar en mi rendición), y que voy a hacer el recibo correcto.</span>
        </label>

        <p className="text-xs text-secundario">
          La anulación no sale sola: la tiene que autorizar alguien con permiso (recibe un aviso). Mientras esté pendiente, no vas a poder cerrar tu rendición. En Tango el recibo lo anula la oficina.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={() => onCerrar(false)} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button onClick={pedir} loading={guardando} className="flex-1"><Ban size={16} className="mr-1.5" /> Pedir autorización</Button>
        </div>
      </div>
    </Modal>
  )
}
