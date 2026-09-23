import { useEffect, useMemo, useState } from 'react'
import { Receipt, RefreshCw } from 'lucide-react'
import { subscribeRecibosPendientesEnTango } from '@/services/cobranzaService'
import { verificarAnuladosEnTango } from '@/services/anuladosTangoService'
import { reportError } from '@/services/observability'
import { useComprobantesTango } from '@/hooks/useComprobantesTango'
import { useAuth } from '@/context/AuthContext'
import { claveDetalle, lecturaRecibo } from '@/utils/estadoEnTango'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION_RECIBO, type Cobranza, type EmpresaTango } from '@/types'
import ChipTango from './ChipTango'

// Recibos de cobranza anulados en la app (con autorización, 2026-09-15) que la
// oficina todavía tiene que anular en Tango. Decisión de Ariel (15/09): por
// ahora la app avisa y facturación lo hace a mano; esta lista reemplaza a
// "acordarse de la push". Cada fila desaparece sola cuando el lector de
// comprobantes ve el recibo con ESTADO ANU.
//
// Desde el 2026-09-20 cada fila dice qué estado tiene hoy en Tango y hay un
// botón para preguntárselo en el momento, sin esperar la pasada de la hora.

// Por NÚMERO de recibo, no por la ficha del cliente: el recibo de FERRANTE
// estaba anulado en Tango pero registrado con el código 000000, así que en la
// ficha de FC.583 no aparecía y la fila no se iba nunca.
const claveDe = (c: Cobranza) => claveDetalle((c.empresa ?? 'redonhielo') as EmpresaTango, 'REC', c.tango?.reciboNumero ?? '')

export default function RecibosPendientesTango() {
  const { user } = useAuth()
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [verificando, setVerificando] = useState(false)
  const [aviso, setAviso] = useState('')
  useEffect(() => subscribeRecibosPendientesEnTango(setCobranzas), [])

  const claves = useMemo(() => cobranzas.map(claveDe).filter((k) => !k.endsWith('_')), [cobranzas])
  const { estados, cargando, recargar } = useComprobantesTango(claves)

  const preguntar = async () => {
    if (!user) return
    setVerificando(true)
    setAviso('')
    try {
      const r = await verificarAnuladosEnTango(
        cobranzas.map((c) => ({
          clienteUid: String(c.clienteId ?? ''),
          empresa: (c.empresa ?? 'redonhielo') as EmpresaTango,
          codigo: String(c.codigoTango ?? '').trim(),
        })),
        { uid: user.uid, nombre: user.nombre ?? '' },
      )
      recargar()
      setAviso(r.recibos.confirmados > 0
        ? `${r.recibos.confirmados} ${r.recibos.confirmados === 1 ? 'recibo salió' : 'recibos salieron'} de la lista.`
        : 'Tango todavía no muestra ninguno de estos como anulado.')
    } catch (err) {
      reportError(err, { origen: 'RecibosPendientesTango', accion: 'verificarAnuladosEnTango' })
      setAviso('No se pudo preguntarle a Tango. Probá de nuevo en un rato.')
    } finally {
      setVerificando(false)
    }
  }

  if (cobranzas.length === 0) return null
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-800 flex items-center gap-2"><Receipt size={16} /> Recibos anulados en la app que hay que anular en Tango</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-red-700">{cobranzas.length} {cobranzas.length === 1 ? 'pendiente' : 'pendientes'} · la fila se va sola cuando Tango lo refleje</span>
          <button
            type="button" onClick={preguntar} disabled={verificando}
            title="Le pide a Tango el estado de estos recibos ahora mismo, sin esperar la pasada de la hora"
            className="text-xs font-medium text-red-800 border border-red-300 bg-white rounded-lg px-2.5 py-1 min-h-8 inline-flex items-center gap-1.5 hover:bg-red-100 disabled:opacity-50"
          >
            <RefreshCw size={12} className={verificando ? 'animate-spin' : ''} /> {verificando ? 'Preguntando…' : 'Preguntar a Tango'}
          </button>
        </div>
      </div>
      {aviso && <p className="text-xs text-red-800">{aviso}</p>}
      <ul className="divide-y divide-red-100 text-sm">
        {cobranzas.map((c) => {
          const a = c.anulacion
          const cheques = c.medios?.cheques ?? []
          const lectura = lecturaRecibo(estados.get(claveDe(c)))
          return (
            <li key={c.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono font-semibold text-gray-900">{c.tango?.reciboNumero ?? c.numeroRecibo ?? 'sin número'}</span>
              <span className="text-secundario">({c.numeroRecibo ?? 'sin RS'})</span>
              <span className="text-gray-800">{c.clienteNombre}</span>
              <span className="text-secundario tabular-nums">{formatoARS(c.importe)}</span>
              <span className="text-secundario">{c.registradoPor.nombre}</span>
              <ChipTango lectura={lectura} cargando={cargando} />
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
