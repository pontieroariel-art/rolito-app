import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Eye, Share2 } from 'lucide-react'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { useMisLiquidaciones } from '@/hooks/useMisLiquidaciones'
import { useMiViajeHoy } from '@/hooks/useMiViajeHoy'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { formatoARS } from '@/utils/money'
import { reportError } from '@/services/observability'
import { esRecibido } from '@/utils/valoresEnPapel'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, type Liquidacion } from '@/types'

// Los generadores de PDF se cargan al tocar el botón, no con la pantalla (R9).
const pdf = () => import('@/utils/pdf')

// "Mi rendición": lo que el chofer / supervisor ve de su propia liquidación
// (2026-09-09). Antes no veía nada. Muestra el código, la plata rendida y la
// diferencia, quién la recibió (con firma) y qué cheques/retenciones entregó,
// y le deja ver/enviar el PDF (se arma solo con el doc cerrado).
export default function MiRendicionCard({ uid, hoy }: { uid: string; hoy: string }) {
  const { hoyLiq, anteriores } = useMisLiquidaciones(uid, hoy)
  // Las dos mitades del viaje de hoy (2026-09-18). Solo lectura: el chofer no
  // completa nada. Lo único que gana es saber en qué está su viaje sin tener que
  // preguntarle a nadie.
  const { viaje, plata, mercaderia, estado } = useMiViajeHoy(uid)
  // Con viaje manda la plata del viaje; sin viaje (supervisor, cobrador) sigue
  // valiendo la del día.
  const liqDeHoy = viaje ? plata : hoyLiq
  const [abrirAnteriores, setAbrirAnteriores] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const compartible = puedeCompartirArchivos()
  const { abrir } = useVisorComprobante()

  const ver = async (l: Liquidacion) => {
    setOcupado(true); setAviso('')
    try {
      const { generateLiquidacion, nombreArchivoLiquidacion } = await pdf()
      const blob = await generateLiquidacion(l)
      abrir({ blob, nombre: nombreArchivoLiquidacion(l), titulo: `Liquidación ${l.codigo ?? l.fecha}`, subtitulo: `Mi liquidación del ${l.fecha}` })
    } catch (err) { reportError(err, { origen: 'MiRendicionCard', accion: 'pdf' }); setAviso('No se pudo generar el PDF.') } finally { setOcupado(false) }
  }
  const enviar = async (l: Liquidacion) => {
    setOcupado(true); setAviso('')
    try {
      const { generateLiquidacion, nombreArchivoLiquidacion } = await pdf()
      const blob = (await generateLiquidacion(l, undefined, { descargar: false })) as Blob
      const r = await compartirArchivo(blob, nombreArchivoLiquidacion(l), { titulo: `Liquidación ${l.codigo ?? l.fecha}`, texto: `Mi liquidación del ${l.fecha}` })
      if (r === 'descargado') setAviso('Este teléfono no puede compartir archivos: se descargó el PDF.')
    } catch (err) { reportError(err, { origen: 'MiRendicionCard', accion: 'enviar' }); setAviso('No se pudo generar el PDF.') } finally { setOcupado(false) }
  }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent disabled:opacity-50'

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-secundario uppercase tracking-wide">Mi rendición de hoy</h2>
        {liqDeHoy?.codigo && <span className="text-xs font-semibold text-gray-700">{liqDeHoy.codigo}</span>}
      </div>

      {/* Los dos estados del viaje, de un vistazo y sin scroll: es lo único que
          el chofer mira, cinco segundos, parado al lado del camión. */}
      {viaje && (
        <div className="grid grid-cols-2 gap-2">
          <EstadoViaje titulo="Mercadería" hecha={estado.mercaderia.hecha}
            texto={estado.mercaderia.hecha ? `Contada por ${estado.mercaderia.por?.nombre ?? 'muelle'}` : 'Falta que muelle la cuente'}
            extra={mercaderia?.descargaCodigos[0]} />
          <EstadoViaje titulo="Plata" hecha={estado.plata.hecha}
            texto={estado.plata.hecha ? `Recibió ${liqDeHoy?.firmanteRecibe ?? estado.plata.por?.nombre ?? 'caja'}` : 'Falta liquidarla en caja'} />
        </div>
      )}

      {!liqDeHoy ? (
        <p className="text-sm text-secundario">Todavía no rendiste hoy. Cuando caja cierre tu liquidación la vas a ver acá con la firma de quien te recibió.</p>
      ) : (
        <Resumen l={liqDeHoy} ocupado={ocupado} compartible={compartible} onVer={() => ver(liqDeHoy)} onEnviar={() => enviar(liqDeHoy)} btn={btn} />
      )}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}

      {anteriores.length > 0 && (
        <div className="border-t border-[#E7E5DC] pt-2">
          <button type="button" onClick={() => setAbrirAnteriores((v) => !v)} className="w-full flex items-center justify-between text-xs font-semibold text-secundario uppercase tracking-wide">
            <span>Últimas rendiciones ({anteriores.length})</span>
            {abrirAnteriores ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {abrirAnteriores && (
            <ul className="mt-2 space-y-1.5">
              {anteriores.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-700">{l.fecha}{l.codigo ? <span className="text-secundario"> · {l.codigo}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <span className={`tabular-nums ${l.efectivoRecibido === 0 ? 'text-secundario' : 'text-gray-900'}`}>{formatoARS(l.efectivoRecibido)}</span>
                    {l.diferenciaEfectivo !== 0 && <span className="tabular-nums text-red-600 text-xs">({formatoARS(l.diferenciaEfectivo)})</span>}
                    <button type="button" onClick={() => enviar(l)} disabled={ocupado} className={btn} title="Enviar PDF"><Share2 size={12} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Resumen({ l, ocupado, compartible, onVer, onEnviar, btn }: { l: Liquidacion; ocupado: boolean; compartible: boolean; onVer: () => void; onEnviar: () => void; btn: string }) {
  const valores = [...(l.cheques ?? []), ...(l.retenciones ?? [])]
  const entregados = valores.filter(esRecibido).length
  const recibioNombre = l.firmanteRecibe ?? l.cerradaPor.nombre
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-secundario">A rendir</p><p className={`text-sm font-semibold tabular-nums ${l.efectivoARendir === 0 ? 'text-secundario' : 'text-gray-900'}`}>{formatoARS(l.efectivoARendir)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-secundario">Entregué</p><p className={`text-sm font-semibold tabular-nums ${l.efectivoRecibido === 0 ? 'text-secundario' : 'text-gray-900'}`}>{formatoARS(l.efectivoRecibido)}</p></div>
        <div className={`rounded-lg p-2 ${l.diferenciaEfectivo === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-[11px] text-secundario">Diferencia</p><p className={`text-sm font-semibold tabular-nums ${l.diferenciaEfectivo === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(l.diferenciaEfectivo)}</p></div>
      </div>
      {l.diferencia && <p className="text-xs text-red-700">{MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}{l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}</p>}
      <p className="text-sm text-gray-800 flex items-center gap-1.5">
        <CheckCircle2 size={16} className="text-[#1D9E75] shrink-0" />
        Recibido por <b>{recibioNombre}</b>{l.firmaRecibe ? ' · firmado' : ''} · {l.createdAt.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {valores.length > 0 && (
        <div className="text-xs text-gray-600 space-y-1">
          <p>
            Cheques y retenciones entregados: <b className={entregados === valores.length ? 'text-[#0F6B4E]' : 'text-red-600'}>{entregados}/{valores.length}</b>
            {l.valoresFaltantes?.cantidad ? <span className="text-red-600"> · {l.valoresFaltantes.cantidad} pendiente(s) de entregar ({formatoARS(l.valoresFaltantes.total)})</span> : null}
          </p>
          {/* Cada cheque con su estado (2026-09-23, pedido de Ariel): el chofer ve que caja se lo recibió. */}
          <ul className="space-y-0.5">
            {(l.cheques ?? []).map((ch) => (
              <li key={`${ch.cobranzaId}-${ch.numero}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate" title={`Cheque ${ch.numero} · ${ch.bancoNombre} · ${ch.clienteNombre}`}>Cheque {ch.numero} · {ch.clienteNombre}{ch.fechaAcreditacion ? ` · paga ${ch.fechaAcreditacion.slice(8, 10)}/${ch.fechaAcreditacion.slice(5, 7)}` : ''}</span>
                <span className="flex items-center gap-1.5 shrink-0 tabular-nums">
                  {formatoARS(ch.importe)}
                  {esRecibido(ch)
                    ? <span className="inline-flex items-center gap-0.5 text-[#0F6B4E] font-semibold"><CheckCircle2 size={12} /> recibido por caja</span>
                    : <span className="text-red-600 font-semibold" title={ch.motivoNoEntregado}>no entregado</span>}
                </span>
              </li>
            ))}
            {(l.retenciones ?? []).map((re) => (
              <li key={`${re.cobranzaId}-${re.nroCertificado}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">Retención {re.tipo.toUpperCase()} {re.nroCertificado} · {re.clienteNombre}</span>
                <span className="flex items-center gap-1.5 shrink-0 tabular-nums">
                  {formatoARS(re.importe)}
                  {esRecibido(re)
                    ? <span className="inline-flex items-center gap-0.5 text-[#0F6B4E] font-semibold"><CheckCircle2 size={12} /> recibida por caja</span>
                    : <span className="text-red-600 font-semibold" title={re.motivoNoEntregado}>no entregada</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onVer} disabled={ocupado} className={btn}><Eye size={12} /> Ver</button>
        <button type="button" onClick={onEnviar} disabled={ocupado} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Descargar'}</button>
      </div>
    </div>
  )
}

/**
 * Un estado del viaje, para el teléfono: color MÁS palabra, siempre. Esto se
 * mira a contraluz en la calle, así que el color solo no alcanza.
 */
function EstadoViaje({ titulo, hecha, texto, extra }: { titulo: string; hecha: boolean; texto: string; extra?: string }) {
  return (
    <div className={`rounded-xl border p-2.5 ${hecha ? 'border-accent/30 bg-accent/5' : 'border-[#D3D1C7] bg-white'}`}>
      <div className="flex items-center gap-1.5">
        {hecha ? <CheckCircle2 size={14} className="text-accent shrink-0" /> : <Clock size={14} className="text-secundario shrink-0" />}
        <span className="text-xs font-semibold text-gray-900">{titulo}</span>
      </div>
      <p className="text-xs text-secundario mt-0.5">{texto}</p>
      {extra && <p className="text-xs font-semibold text-gray-700 tabular-nums mt-0.5">{extra}</p>}
    </div>
  )
}
