import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Download, Share2 } from 'lucide-react'
import { useMisLiquidaciones } from '@/hooks/useMisLiquidaciones'
import { generateLiquidacion, nombreArchivoLiquidacion } from '@/utils/pdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { formatoARS } from '@/utils/money'
import { reportError } from '@/services/observability'
import { esRecibido } from '@/utils/valoresEnPapel'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, type Liquidacion } from '@/types'

// "Mi rendición": lo que el chofer / supervisor ve de su propia liquidación
// (2026-09-09). Antes no veía nada. Muestra el código, la plata rendida y la
// diferencia, quién la recibió (con firma) y qué cheques/retenciones entregó,
// y le deja ver/enviar el PDF (se arma solo con el doc cerrado).
export default function MiRendicionCard({ uid, hoy }: { uid: string; hoy: string }) {
  const { hoyLiq, anteriores } = useMisLiquidaciones(uid, hoy)
  const [abrirAnteriores, setAbrirAnteriores] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const compartible = puedeCompartirArchivos()

  const ver = async (l: Liquidacion) => {
    setOcupado(true); setAviso('')
    try { await generateLiquidacion(l) } catch (err) { reportError(err, { origen: 'MiRendicionCard', accion: 'pdf' }); setAviso('No se pudo generar el PDF.') } finally { setOcupado(false) }
  }
  const enviar = async (l: Liquidacion) => {
    setOcupado(true); setAviso('')
    try {
      const blob = (await generateLiquidacion(l, undefined, { descargar: false })) as Blob
      const r = await compartirArchivo(blob, nombreArchivoLiquidacion(l), { titulo: `Liquidación ${l.codigo ?? l.fecha}`, texto: `Mi liquidación del ${l.fecha}` })
      if (r === 'descargado') setAviso('Este teléfono no puede compartir archivos: se descargó el PDF.')
    } catch (err) { reportError(err, { origen: 'MiRendicionCard', accion: 'enviar' }); setAviso('No se pudo generar el PDF.') } finally { setOcupado(false) }
  }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent disabled:opacity-50'

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Mi rendición de hoy</h2>
        {hoyLiq?.codigo && <span className="text-xs font-semibold text-gray-700">{hoyLiq.codigo}</span>}
      </div>

      {!hoyLiq ? (
        <p className="text-sm text-gray-500">Todavía no rendiste hoy. Cuando caja cierre tu liquidación la vas a ver acá con la firma de quien te recibió.</p>
      ) : (
        <Resumen l={hoyLiq} ocupado={ocupado} compartible={compartible} onVer={() => ver(hoyLiq)} onEnviar={() => enviar(hoyLiq)} btn={btn} />
      )}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}

      {anteriores.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <button type="button" onClick={() => setAbrirAnteriores((v) => !v)} className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Últimas rendiciones ({anteriores.length})</span>
            {abrirAnteriores ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {abrirAnteriores && (
            <ul className="mt-2 space-y-1.5">
              {anteriores.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-700">{l.fecha}{l.codigo ? <span className="text-gray-400"> · {l.codigo}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-gray-900">{formatoARS(l.efectivoRecibido)}</span>
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
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-gray-500">A rendir</p><p className="text-sm font-semibold tabular-nums text-gray-900">{formatoARS(l.efectivoARendir)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-[11px] text-gray-500">Entregué</p><p className="text-sm font-semibold tabular-nums text-gray-900">{formatoARS(l.efectivoRecibido)}</p></div>
        <div className={`rounded-lg p-2 ${l.diferenciaEfectivo === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-[11px] text-gray-500">Diferencia</p><p className={`text-sm font-semibold tabular-nums ${l.diferenciaEfectivo === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(l.diferenciaEfectivo)}</p></div>
      </div>
      {l.diferencia && <p className="text-xs text-red-700">{MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}{l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}</p>}
      <p className="text-sm text-gray-800 flex items-center gap-1.5">
        <CheckCircle2 size={16} className="text-[#1D9E75] shrink-0" />
        Recibido por <b>{recibioNombre}</b>{l.firmaRecibe ? ' · firmado' : ''} · {l.createdAt.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      </p>
      {valores.length > 0 && (
        <p className="text-xs text-gray-600">
          Cheques y retenciones entregados: <b className={entregados === valores.length ? 'text-[#0F6B4E]' : 'text-red-600'}>{entregados}/{valores.length}</b>
          {l.valoresFaltantes?.cantidad ? <span className="text-red-600"> · {l.valoresFaltantes.cantidad} pendiente(s) de entregar ({formatoARS(l.valoresFaltantes.total)})</span> : null}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onVer} disabled={ocupado} className={btn}><Download size={12} /> Ver PDF</button>
        <button type="button" onClick={onEnviar} disabled={ocupado} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Descargar'}</button>
      </div>
    </div>
  )
}
