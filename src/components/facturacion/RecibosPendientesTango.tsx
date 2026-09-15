import { useEffect, useState } from 'react'
import { Receipt } from 'lucide-react'
import { subscribeRecibosPendientesEnTango } from '@/services/cobranzaService'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION_RECIBO, type Cobranza } from '@/types'

// Recibos de cobranza anulados en la app (con autorización, 2026-09-15) que la
// oficina todavía tiene que anular en Tango. Decisión de Ariel (15/09): por
// ahora la app avisa y facturación lo hace a mano; esta lista reemplaza a
// "acordarse de la push". Cada fila desaparece sola cuando el lector de
// comprobantes ve el recibo con ESTADO ANU (hasta 1 h).
export default function RecibosPendientesTango() {
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  useEffect(() => subscribeRecibosPendientesEnTango(setCobranzas), [])
  if (cobranzas.length === 0) return null
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-800 flex items-center gap-2"><Receipt size={16} /> Recibos anulados en la app que hay que anular en Tango</h2>
        <span className="text-xs text-red-700">{cobranzas.length} {cobranzas.length === 1 ? 'pendiente' : 'pendientes'} · la fila desaparece sola cuando Tango lo refleje (hasta 1 h)</span>
      </div>
      <ul className="divide-y divide-red-100 text-sm">
        {cobranzas.map((c) => {
          const a = c.anulacion
          const cheques = c.medios?.cheques ?? []
          return (
            <li key={c.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono font-semibold text-gray-900">{c.tango?.reciboNumero ?? c.numeroRecibo ?? 'sin número'}</span>
              <span className="text-secundario">({c.numeroRecibo ?? 'sin RS'})</span>
              <span className="text-gray-800">{c.clienteNombre}</span>
              <span className="text-secundario tabular-nums">{formatoARS(c.importe)}</span>
              <span className="text-secundario">{c.registradoPor.nombre}</span>
              {cheques.length > 0 && <span className="text-xs text-secundario">cheque{cheques.length > 1 ? 's' : ''} {cheques.map((ch) => `${ch.numero} ${ch.bancoNombre}`).join(', ')}</span>}
              <span className="text-xs text-secundario">
                anulado {a?.anuladaEn?.toDate ? a.anuladaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                {a?.anuladaPor?.nombre ? ` por ${a.anuladaPor.nombre}` : ''}
                {a?.motivo ? ` · ${MOTIVOS_ANULACION_RECIBO[a.motivo] ?? a.motivo}` : ''}{a?.nota ? ` · ${a.nota}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
