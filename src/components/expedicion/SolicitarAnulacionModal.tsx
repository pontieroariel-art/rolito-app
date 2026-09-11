import { useState } from 'react'
import { Ban } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { solicitarAnulacion, type VentaAnulable } from '@/services/anulacionService'
import { reportError } from '@/services/observability'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION, type MotivoAnulacion } from '@/types'

// Factura de ARCA, o la factura X de promo (NC interna, 2026-09-11).
const nroFactura = (v: VentaAnulable['venta']) =>
  v.factura ? `${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
    : v.comprobanteInterno ? `X ${String(v.comprobanteInterno.puntoVenta).padStart(5, '0')}-${String(v.comprobanteInterno.numero).padStart(8, '0')}` : ''

// El cajero pide anular la factura de una venta (2026-09-09): elige el motivo,
// explica, confirma que le va a hacer la factura correcta al cliente, y la
// solicitud queda esperando a alguien con permiso para autorizar. Recién con
// la aprobación el server emite la nota de crédito. Desde el 2026-09-11 también
// para la factura del camión, pedida desde la liquidación abierta del chofer.
// Con origen 'facturacion' (2026-09-11) la pide la oficina sobre una venta
// de un día ya cerrado: el cierre no se reabre, el server le anota la anulación.
export default function SolicitarAnulacionModal({ objetivo, actor, origen, onCerrar }: {
  objetivo: VentaAnulable
  actor: { uid: string; nombre: string }
  origen?: 'facturacion'
  onCerrar: (pedida: boolean) => void
}) {
  const venta = objetivo.venta
  const [motivo, setMotivo] = useState<MotivoAnulacion | ''>('')
  const [nota, setNota] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const pedir = async () => {
    setError('')
    if (!motivo) { setError('Elegí el motivo.'); return }
    if (motivo === 'otro' && !nota.trim()) { setError('Con "Otro" hay que explicar qué pasó.'); return }
    if (!confirmo) { setError('Confirmá que entendés lo que pasa con la factura.'); return }
    setGuardando(true)
    try {
      await solicitarAnulacion(objetivo, motivo, nota, actor, { origen })
      onCerrar(true)
    } catch (err) {
      reportError(err, { origen: 'SolicitarAnulacionModal', accion: 'error al pedir la anulación' })
      setError((err as Error).message || 'No se pudo pedir la anulación. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <Modal open onClose={() => onCerrar(false)} title="Anular factura">
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Factura <b>{nroFactura(venta)}</b> · <b>{venta.clienteNombre}</b> · {formatoARS(venta.total)}
        </p>
        <div className="border border-[#D3D1C7] rounded-lg divide-y divide-gray-100 text-sm">
          {venta.items.map((i) => (
            <div key={i.productoId} className="flex justify-between px-3 py-1.5">
              <span className="text-gray-700">{i.cantidad} × {i.nombre}</span>
              <span className="font-medium text-gray-900">{formatoARS(i.precioUnitario * i.cantidad)}</span>
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-gray-500">¿Qué pasó?</label>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoAnulacion | '')} className={inputClass}>
            <option value="">Elegir motivo…</option>
            {(Object.keys(MOTIVOS_ANULACION) as MotivoAnulacion[]).map((m) => <option key={m} value={m}>{MOTIVOS_ANULACION[m]}</option>)}
          </select>
        </div>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Detalle (qué había que facturar, para quién)…" className={inputClass} />

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-0.5" />
          <span>Entiendo que la factura queda <b>anulada con una nota de crédito por el total</b> cuando la autoricen, y que le voy a hacer la factura correcta al cliente.</span>
        </label>

        <p className="text-xs text-gray-500">
          {origen
            ? 'La anulación no sale sola: la tiene que autorizar alguien con permiso (recibe un aviso). La liquidación o la caja de ese día no se reabren: quedan con la anulación anotada.'
            : 'La anulación no sale sola: la tiene que autorizar alguien con permiso (recibe un aviso). Mientras esté pendiente, no vas a poder cerrar tu caja.'}
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
