import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { formatoARS } from '@/utils/money'
import { claveCheque, claveRetencion, esRecibido, type Decisiones, type DecisionValor } from '@/utils/valoresEnPapel'
import type { TipoRetencion } from '@/types'

// Lista de cheques y certificados de retención que pasan de mano (cobrador →
// caja → tesorería), 2026-09-09. Editable: quien recibe tilda cada uno como
// "Recibido" o lo marca "No entregado" con motivo (sin decidir no se puede
// cerrar; ver utils/valoresEnPapel.decisionesCompletas). Solo lectura: muestra
// ✓ / ✗ + motivo según `recibido` del doc.

type ChequeFila = { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; numero: string; bancoNombre: string; fechaAcreditacion: string; importe: number; esEcheq?: boolean; recibido?: boolean; motivoNoEntregado?: string }
type RetencionFila = { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; tipo: string; nroCertificado: string; importe: number; recibido?: boolean; motivoNoEntregado?: string }

export default function ValoresEnPapel({ cheques, retenciones, decisiones, onDecision, soloLectura = false, titulo }: {
  cheques: ChequeFila[]
  retenciones: RetencionFila[]
  decisiones?: Decisiones
  onDecision?: (clave: string, d: DecisionValor) => void
  soloLectura?: boolean
  titulo?: string
}) {
  const filas: { clave: string; texto: string; detalle: string; importe: number; recibido?: boolean; motivo?: string }[] = [
    ...cheques.map((ch) => ({
      clave: claveCheque(ch),
      texto: `Cheque${ch.esEcheq ? ' electrónico' : ''} ${ch.numero} · ${ch.bancoNombre}`,
      detalle: `acredita ${ch.fechaAcreditacion || '—'} · ${ch.clienteNombre}${ch.numeroRecibo ? ` · ${ch.numeroRecibo}` : ''}`,
      importe: ch.importe, recibido: ch.recibido, motivo: ch.motivoNoEntregado,
    })),
    ...retenciones.map((re) => ({
      clave: claveRetencion(re),
      texto: `Retención ${RETENCION_LABELS[re.tipo as TipoRetencion] ?? re.tipo.toUpperCase()} · cert. ${re.nroCertificado}`,
      detalle: `${re.clienteNombre}${re.numeroRecibo ? ` · ${re.numeroRecibo}` : ''}`,
      importe: re.importe, recibido: re.recibido, motivo: re.motivoNoEntregado,
    })),
  ]
  if (filas.length === 0) return <p className="text-sm text-gray-500">Sin cheques ni retenciones.</p>

  return (
    <div className="space-y-1.5">
      {titulo && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>}
      {filas.map((f) => (
        soloLectura
          ? <FilaLectura key={f.clave} f={f} />
          : <FilaEditable key={f.clave} f={f} decision={decisiones?.[f.clave]} onDecision={(d) => onDecision?.(f.clave, d)} />
      ))}
    </div>
  )
}

function FilaLectura({ f }: { f: { texto: string; detalle: string; importe: number; recibido?: boolean; motivo?: string } }) {
  const ok = esRecibido(f)
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${ok ? 'border-[#D3D1C7] bg-white' : 'border-red-200 bg-red-50'}`}>
      <span className={`mt-0.5 shrink-0 rounded-full p-0.5 ${ok ? 'bg-[#E6F5EF] text-[#0F6B4E]' : 'bg-red-100 text-red-600'}`}>{ok ? <Check size={14} /> : <X size={14} />}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900">{f.texto}</p>
        <p className="text-xs text-gray-500">{f.detalle}{!ok && f.motivo ? <span className="text-red-700"> · No entregado: {f.motivo}</span> : !ok ? <span className="text-red-700"> · No entregado</span> : null}</p>
      </div>
      <b className="text-sm tabular-nums text-gray-900">{formatoARS(f.importe)}</b>
    </div>
  )
}

function FilaEditable({ f, decision, onDecision }: { f: { texto: string; detalle: string; importe: number }; decision?: DecisionValor; onDecision: (d: DecisionValor) => void }) {
  const [motivo, setMotivo] = useState(decision && !decision.recibido ? decision.motivo : '')
  const estado = decision === undefined ? 'pendiente' : decision.recibido ? 'recibido' : 'no'
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  return (
    <div className={`rounded-lg border px-3 py-2 ${estado === 'recibido' ? 'border-[#1D9E75] bg-[#E6F5EF]/40' : estado === 'no' ? 'border-red-200 bg-red-50' : 'border-amber-300 bg-amber-50/40'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900">{f.texto}</p>
          <p className="text-xs text-gray-500">{f.detalle}</p>
        </div>
        <b className="text-sm tabular-nums text-gray-900">{formatoARS(f.importe)}</b>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <label className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border cursor-pointer select-none ${estado === 'recibido' ? 'bg-[#1D9E75] text-white border-[#1D9E75]' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
          <input type="radio" className="sr-only" checked={estado === 'recibido'} onChange={() => onDecision({ recibido: true })} />
          <Check size={12} /> Recibido
        </label>
        <label className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border cursor-pointer select-none ${estado === 'no' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
          <input type="radio" className="sr-only" checked={estado === 'no'} onChange={() => onDecision({ recibido: false, motivo })} />
          <X size={12} /> No entregado
        </label>
        {estado === 'no' && (
          <input value={motivo} onChange={(e) => { setMotivo(e.target.value); onDecision({ recibido: false, motivo: e.target.value }) }} placeholder="Motivo (obligatorio)" className={`${inputClass} flex-1 min-w-[160px]`} />
        )}
        {estado === 'pendiente' && <span className="text-xs text-amber-700">Sin decidir</span>}
      </div>
    </div>
  )
}
