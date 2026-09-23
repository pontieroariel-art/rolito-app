import { useEffect, useMemo, useState } from 'react'
import { Ban, RefreshCw } from 'lucide-react'
import { subscribeRemitosPendientesEnTango } from '@/services/ventaCamionService'
import { verificarAnuladosEnTango } from '@/services/anuladosTangoService'
import { reportError } from '@/services/observability'
import { useComprobantesTango } from '@/hooks/useComprobantesTango'
import { useAuth } from '@/context/AuthContext'
import { claveDetalle, lecturaRemito } from '@/utils/estadoEnTango'
import { formatoARS } from '@/utils/money'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { codigoComprobanteInterno } from '@/utils/numeracionInterna'
import { MOTIVOS_ANULACION, type VentaCamion } from '@/types'
import ChipTango from './ChipTango'

// Remitos que un chofer (o facturación) anuló en la app y que la oficina
// todavía tiene que anular en Tango (2026-09-12). Hasta que la app los anule
// sola en Tango, esta lista reemplaza a "acordarse de la push". Cada fila
// desaparece sola cuando el lector de comprobantes ve el remito anulado.
//
// Desde el 2026-09-20 cada fila dice además QUÉ ESTADO tiene hoy en Tango, y
// hay un botón para preguntárselo en el momento en vez de esperar la pasada de
// la hora. El día que se estrenó, de siete pendientes de hasta ocho días no
// había ninguno anulado en Tango y tres estaban FACTURADOS: el intento de
// anularlos no podía prosperar y nadie tenía cómo enterarse.

const numeroRemito = (v: VentaCamion) => v.tango?.remitoNumero ?? (v.comprobanteInterno ? codigoComprobanteInterno(v.comprobanteInterno) : 'sin número')

export default function RemitosPendientesTango() {
  const { user } = useAuth()
  const [ventas, setVentas] = useState<VentaCamion[]>([])
  const [verificando, setVerificando] = useState(false)
  const [aviso, setAviso] = useState('')
  useEffect(() => subscribeRemitosPendientesEnTango(setVentas), [])

  // Los remitos del camión son de Redonhielo (la promo no lleva remito R). Se
  // busca por NÚMERO de comprobante, no por la ficha del cliente: en Tango un
  // comprobante puede quedar bajo otro código y desde la ficha no se ve nunca.
  const claves = useMemo(
    () => ventas.map((v) => claveDetalle('redonhielo', 'REM', v.tango?.remitoNumero ?? '')).filter((c) => !c.endsWith('_')),
    [ventas],
  )
  const { estados, cargando, recargar } = useComprobantesTango(claves)

  const preguntar = async () => {
    if (!user) return
    setVerificando(true)
    setAviso('')
    try {
      const r = await verificarAnuladosEnTango(
        ventas.map((v) => ({ clienteUid: String(v.clienteId ?? ''), empresa: 'redonhielo' as const, codigo: String(v.clienteCodigoTango ?? '').trim() })),
        { uid: user.uid, nombre: user.nombre ?? '' },
      )
      recargar()
      setAviso(r.remitos.confirmados > 0
        ? `${r.remitos.confirmados} ${r.remitos.confirmados === 1 ? 'remito salió' : 'remitos salieron'} de la lista.`
        : 'Tango todavía no muestra ninguno de estos como anulado.')
    } catch (err) {
      reportError(err, { origen: 'RemitosPendientesTango', accion: 'verificarAnuladosEnTango' })
      setAviso('No se pudo preguntarle a Tango. Probá de nuevo en un rato.')
    } finally {
      setVerificando(false)
    }
  }

  if (ventas.length === 0) return null
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-800 flex items-center gap-2"><Ban size={16} /> Remitos anulados en la app que hay que anular en Tango</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-red-700">{ventas.length} {ventas.length === 1 ? 'pendiente' : 'pendientes'} · la fila se va sola cuando Tango lo refleje</span>
          <button
            type="button" onClick={preguntar} disabled={verificando}
            title="Le pide a Tango el estado de estos remitos ahora mismo, sin esperar la pasada de la hora"
            className="text-xs font-medium text-red-800 border border-red-300 bg-white rounded-lg px-2.5 py-1 min-h-8 inline-flex items-center gap-1.5 hover:bg-red-100 disabled:opacity-50"
          >
            <RefreshCw size={12} className={verificando ? 'animate-spin' : ''} /> {verificando ? 'Preguntando…' : 'Preguntar a Tango'}
          </button>
        </div>
      </div>
      {aviso && <p className="text-xs text-red-800">{aviso}</p>}
      <ul className="divide-y divide-red-100 text-sm">
        {ventas.map((v) => {
          const a = v.anulacion
          const numero = numeroRemito(v)
          const lectura = lecturaRemito(estados.get(claveDetalle('redonhielo', 'REM', v.tango?.remitoNumero ?? '')))
          return (
            <li key={v.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono font-semibold text-gray-900">{numero}</span>
              <span className="text-gray-800">{nombreClienteVenta(v)}</span>
              <span className="text-secundario tabular-nums">{formatoARS(v.total)}</span>
              <span className="text-secundario">{v.choferNombre}</span>
              <ChipTango lectura={lectura} cargando={cargando} />
              <span className="text-xs text-secundario">
                anulado {a?.anuladaEn?.toDate ? a.anuladaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                {a?.anuladaPor?.nombre ? ` por ${a.anuladaPor.nombre}` : ''}
                {a?.motivo ? ` · ${MOTIVOS_ANULACION[a.motivo] ?? a.motivo}` : ''}{a?.nota ? ` · ${a.nota}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
