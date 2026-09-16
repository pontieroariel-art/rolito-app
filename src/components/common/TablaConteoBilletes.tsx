import { useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import { NOMBRE_EMPRESA } from '@/utils/inhabilitadoTango'
import { compararDesgloses, conCambioChico, conCantidad, DENOMINACIONES, desgloseContado, etiquetaDenominacion, sinEfectivo, type Denominacion } from '@/utils/billetes'
import type { DesgloseBilletes, EmpresaTango } from '@/types'

// Tabla de conteo de billetes (rendición por sobres, etapa 1, 2026-09-16).
// Una por empresa: cinco filas fijas ($20.000 a $500) con − / cantidad / + y
// el subtotal, una fila "Monedas / cambio chico" como importe, y el total
// grande abajo. El total NUNCA se escribe a mano. La marca "no recibí efectivo
// de esta empresa" deja el conteo válido en cero a propósito.
// Con `referencia` (el conteo de la otra parte) muestra al lado la cantidad
// del otro y pinta en rojo la fila donde difieren: es lo que le dice a
// tesorería "la diferencia está en los de $10.000".

export const COLOR_EMPRESA: Record<EmpresaTango, { texto: string; borde: string; fondo: string; etiqueta: string }> = {
  redonhielo: { texto: 'text-[#14538C]', borde: 'border-[#1D6FA8]', fondo: 'bg-[#E8F1FA]', etiqueta: 'oficial' },
  rolito:     { texto: 'text-[#6B3F94]', borde: 'border-[#8A4FBF]', fondo: 'bg-[#F1E8FA]', etiqueta: 'no oficial' },
}

export function ChipEmpresa({ empresa, className = '' }: { empresa: EmpresaTango; className?: string }) {
  const c = COLOR_EMPRESA[empresa]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${c.fondo} ${c.texto} ${className}`}>{NOMBRE_EMPRESA[empresa]}<span className="font-normal opacity-80">· {c.etiqueta}</span></span>
}

export default function TablaConteoBilletes({ empresa, valor, onChange, soloLectura = false, referencia, etiquetaReferencia = 'contó', etiquetaPropia = 'conté', titulo }: {
  /** null = toda la caja junta (cierre de turno de ventanilla, 2026-09-16): sin chip ni color de empresa. */
  empresa:   EmpresaTango | null
  valor:     DesgloseBilletes
  onChange?: (d: DesgloseBilletes) => void
  soloLectura?: boolean
  /** El conteo de la otra parte, para comparar fila por fila. */
  referencia?: DesgloseBilletes
  etiquetaReferencia?: string
  etiquetaPropia?: string
  titulo?: string
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const editable = !soloLectura && !!onChange
  const contado = desgloseContado(valor)
  const dif = referencia ? compararDesgloses(referencia, valor) : []
  const difDe = (fila: string) => dif.find((d) => d.fila === fila)
  const c = empresa ? COLOR_EMPRESA[empresa] : { borde: 'border-[#D3D1C7]' }
  const campo = 'h-11 w-16 text-center text-base tabular-nums bg-white border border-[#D3D1C7] rounded-lg focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-[#F8F7F2] disabled:text-secundario'
  const btn = 'h-11 w-11 inline-flex items-center justify-center rounded-lg border border-[#D3D1C7] bg-white text-gray-800 active:scale-95 disabled:opacity-40'
  const enter = (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); refs.current[i + 1]?.focus(); refs.current[i + 1]?.select() }
  }

  return (
    <section className={`rounded-xl border-2 ${valor.sinEfectivo ? 'border-[#D3D1C7]' : c.borde} bg-white p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">{empresa && <ChipEmpresa empresa={empresa} />}{titulo && <span className="text-sm font-semibold text-gray-900">{titulo}</span>}</div>
        {!contado && editable && <span className="text-xs font-semibold text-amber-700">Sin contar</span>}
        {valor.sinEfectivo && <span className="text-xs font-semibold text-secundario">Sin efectivo de esta empresa</span>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-secundario">
            <th className="text-left py-1 font-semibold">Billete</th>
            {referencia && <th className="text-right py-1 font-semibold whitespace-nowrap">{etiquetaReferencia}</th>}
            <th className="text-center py-1 font-semibold">{referencia ? etiquetaPropia : 'Cantidad'}</th>
            <th className="text-right py-1 font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {DENOMINACIONES.map((den, i) => {
            const n = valor.billetes[`${den}`] ?? 0
            const d = difDe(`${den}`)
            return (
              <tr key={den} className={`border-t border-[#E7E5DC] ${d ? 'bg-red-50' : ''}`}>
                <td className="py-1.5 font-medium text-gray-900 tabular-nums">{etiquetaDenominacion(den)}</td>
                {referencia && <td className={`py-1.5 text-right tabular-nums ${d ? 'text-red-700 font-semibold' : 'text-secundario'}`}>{referencia.billetes[`${den}`] ?? 0}</td>}
                <td className="py-1.5">
                  <div className="flex items-center justify-center gap-1.5">
                    {editable && <button type="button" className={btn} aria-label={`Un billete menos de ${etiquetaDenominacion(den)}`} disabled={valor.sinEfectivo || n === 0} onClick={() => onChange?.(conCantidad(valor, den as Denominacion, n - 1))}><Minus size={16} /></button>}
                    <input ref={(el) => { refs.current[i] = el }} type="text" inputMode="numeric" pattern="[0-9]*" value={n === 0 && !editable ? '0' : String(n)}
                      disabled={!editable || valor.sinEfectivo} onKeyDown={enter(i)} onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => onChange?.(conCantidad(valor, den as Denominacion, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
                      className={`${campo} ${d ? 'border-red-300 text-red-700 font-semibold' : ''}`} aria-label={`Cantidad de billetes de ${etiquetaDenominacion(den)}`} />
                    {editable && <button type="button" className={btn} aria-label={`Un billete más de ${etiquetaDenominacion(den)}`} disabled={valor.sinEfectivo} onClick={() => onChange?.(conCantidad(valor, den as Denominacion, n + 1))}><Plus size={16} /></button>}
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-900">{n ? formatoARS(den * n) : <span className="text-secundario">—</span>}</td>
              </tr>
            )
          })}
          <tr className={`border-t border-[#E7E5DC] ${difDe('cambioChico') ? 'bg-red-50' : ''}`}>
            <td className="py-1.5 font-medium text-gray-900">Monedas / cambio chico</td>
            {referencia && <td className={`py-1.5 text-right tabular-nums ${difDe('cambioChico') ? 'text-red-700 font-semibold' : 'text-secundario'}`}>{formatoARS(referencia.cambioChico || 0)}</td>}
            <td className="py-1.5">
              <div className="flex justify-center">
                <input ref={(el) => { refs.current[DENOMINACIONES.length] = el }} type="text" inputMode="numeric" pattern="[0-9]*" value={valor.cambioChico ? String(valor.cambioChico) : (editable ? '' : '0')} placeholder="importe"
                  disabled={!editable || valor.sinEfectivo} onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => onChange?.(conCambioChico(valor, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
                  className={`${campo} w-28 ${difDe('cambioChico') ? 'border-red-300 text-red-700 font-semibold' : ''}`} aria-label="Importe en monedas o cambio chico" />
              </div>
            </td>
            <td className="py-1.5 text-right tabular-nums text-gray-900">{valor.cambioChico ? formatoARS(valor.cambioChico) : <span className="text-secundario">—</span>}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex items-end justify-between gap-3 pt-2 border-t-2 border-[#D3D1C7]">
        {editable ? (
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={valor.sinEfectivo} onChange={(e) => onChange?.(sinEfectivo(e.target.checked))} className="accent-[#1D9E75] w-4 h-4" />
            {empresa ? `No recibí efectivo de ${NOMBRE_EMPRESA[empresa]}` : 'No hay efectivo en la caja'}
          </label>
        ) : <span />}
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-secundario font-semibold">Total contado</p>
          <p className={`text-2xl font-black tabular-nums leading-none ${contado ? 'text-gray-900' : 'text-secundario'}`}>{formatoARS(valor.total)}</p>
        </div>
      </div>
    </section>
  )
}
