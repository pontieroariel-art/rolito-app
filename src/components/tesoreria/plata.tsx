import { useState, type ReactNode } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import { claveDeCheque } from '@/utils/sobres'
import type { ChequeRendido, EmpresaTango } from '@/types'

// Piezas del rediseño caja ↔ tesorería (2026-09-23, maqueta aprobada por
// Ariel): las mismas en Mi turno, Sobres y Plata del día, para que el ojo
// encuentre siempre lo mismo en el mismo lugar.
//
//   · EfectivoCheques: "Efectivo $…" arriba y "Cheques $…" abajo, dos renglones
//     iguales (Ariel: "en los cuadros de las rendiciones debería decir efectivo
//     y por debajo los cheques").
//   · CeldasRH: Redonhielo y Rolito, siempre en ese orden.
//   · BloqueRenglones: un bloque plegable con cantidad, total y el partido por
//     empresa a la vista aunque esté cerrado; adentro, un renglón por documento.
//   · TablaCheques: emisor, banco y número, emisión, pago, quién lo cobró e
//     importe; con tildes cuando alguien los recibe.

export const NOMBRE_EMPRESA: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }
export const TEXTO_EMPRESA: Record<EmpresaTango, string> = { redonhielo: 'text-[#14538C]', rolito: 'text-[#6B3F94]' }
export const ddmmaa = (s: string | undefined): string => (s && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '—')

/** "Redonhielo $278.350 · Rolito $1.308.750" en una línea chica. */
export function TextoRH({ redonhielo, rolito, guiones = true }: { redonhielo: number; rolito: number; guiones?: boolean }) {
  const v = (n: number) => (n || !guiones ? formatoARS(n) : '—')
  return <span className="tabular-nums"><span className={TEXTO_EMPRESA.redonhielo}>Redonhielo {v(redonhielo)}</span> · <span className={TEXTO_EMPRESA.rolito}>Rolito {v(rolito)}</span></span>
}

/** Los dos renglones iguales: Efectivo y Cheques, cada uno con su nota. */
export function EfectivoCheques({ efectivo, cheques, subEfectivo, subCheques, compacto = false, tono = 'normal' }: {
  efectivo: number
  cheques: number
  subEfectivo?: ReactNode
  subCheques?: ReactNode
  compacto?: boolean
  tono?: 'normal' | 'mal' | 'bien'
}) {
  const tam = compacto ? 'text-base' : 'text-2xl'
  const color = tono === 'mal' ? 'text-red-700' : tono === 'bien' ? 'text-[#0F6B4E]' : 'text-gray-900'
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline">
      <span className={`${compacto ? 'text-sm' : 'text-base'} font-semibold text-gray-900`}>Efectivo</span>
      <span className={`text-right font-bold tabular-nums ${tam} ${efectivo ? color : 'text-secundario'}`}>{formatoARS(efectivo)}</span>
      {subEfectivo && <span className="col-span-2 text-xs text-secundario -mt-0.5 text-right">{subEfectivo}</span>}
      <span className={`${compacto ? 'text-sm' : 'text-base'} font-semibold text-gray-900 mt-1.5`}>Cheques</span>
      <span className={`text-right font-bold tabular-nums ${tam} mt-1.5 ${cheques ? color : 'text-secundario'}`}>{formatoARS(cheques)}</span>
      {subCheques && <span className="col-span-2 text-xs text-secundario -mt-0.5 text-right">{subCheques}</span>}
    </div>
  )
}

/** Dos celdas grandes, Redonhielo y Rolito, con nota debajo. */
/** Cheques de una empresa en el cajón: cuánto suman y cuántos son. */
export interface ChequesEmpresa { total: number; cantidad: number }

/**
 * Una celda por empresa. Con `cheques`, cada celda separa efectivo de cheques
 * (2026-09-24, pedido de Ariel al ver Mi turno: el fajo de cada empresa es el
 * efectivo, y los cheques van aparte en el sobre, así que se leen por
 * separado). Sin `cheques`, muestra solo el número, como antes.
 */
export function CeldasRH({ redonhielo, rolito, subRedonhielo, subRolito, cheques }: {
  redonhielo: number; rolito: number; subRedonhielo?: ReactNode; subRolito?: ReactNode
  cheques?: Record<EmpresaTango, ChequesEmpresa>
}) {
  // Tres renglones iguales (etiqueta a la izquierda, importe a la derecha, misma
  // tipografía) y el Total separado por una línea: efectivo + cheques, que es lo
  // que va en el sobre de esa empresa. `sub` queda para una nota chica (anticipo).
  const fila = (etiqueta: string, importe: number, total = false) => (
    <div className={`flex items-baseline justify-between gap-2 ${total ? 'border-t-2 border-[#B8B5A8] mt-1 pt-1' : ''}`}>
      <span className={`text-base ${total ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>{etiqueta}</span>
      <span className={`text-base tabular-nums ${total ? 'font-bold' : 'font-semibold'} ${importe ? 'text-gray-900' : 'text-secundario'}`}>{formatoARS(importe)}</span>
    </div>
  )
  const celda = (e: EmpresaTango, n: number, sub?: ReactNode) => {
    const ch = cheques?.[e]
    return (
      <div className="rounded-xl border-2 border-[#B8B5A8] bg-white px-3 py-2">
        <p className={`text-center text-sm font-extrabold uppercase tracking-wider mb-1 ${TEXTO_EMPRESA[e]}`}>{NOMBRE_EMPRESA[e]}</p>
        {ch ? (
          <>
            {fila('Efectivo', n)}
            {fila(ch.cantidad ? `Cheques · ${ch.cantidad}` : 'Cheques', ch.total)}
            {fila('Total', n + ch.total, true)}
          </>
        ) : (
          <p className={`text-lg font-bold tabular-nums ${n ? 'text-gray-900' : 'text-secundario'}`}>{formatoARS(n)}</p>
        )}
        {sub && <p className="text-xs text-secundario mt-1">{sub}</p>}
      </div>
    )
  }
  return <div className="grid grid-cols-2 gap-2">{celda('redonhielo', redonhielo, subRedonhielo)}{celda('rolito', rolito, subRolito)}</div>
}

// ── Bloques y renglones (Mi turno) ───────────────────────────────────────────

export function BloqueRenglones({ titulo, cantidad, total, redonhielo, rolito, nota, resta = false, abiertoInicial = false, children, vacio }: {
  titulo: string
  cantidad: number
  total: number
  redonhielo: number
  rolito: number
  /** "+ 1 cheque", "no suma al cajón". */
  nota?: string
  /** Un bloque que resta (anticipos): el total en rojo con signo menos. */
  resta?: boolean
  abiertoInicial?: boolean
  children?: ReactNode
  vacio?: string
}) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  // Encabezado en columnas (2026-09-24, pedido de Ariel): Redonhielo, Rolito y
  // Total a la derecha, alineados con las columnas de importe de cada renglón.
  const signo = (n: number) => (resta && n ? `− ${formatoARS(n)}` : formatoARS(n))
  const columna = (etiqueta: string, n: number, claseEtiqueta: string, esTotal = false) => (
    <span className="flex flex-col items-end">
      <span className={`text-xs font-extrabold uppercase tracking-wider ${claseEtiqueta}`}>{etiqueta}</span>
      <span className={`tabular-nums whitespace-nowrap ${esTotal ? 'font-bold' : 'font-semibold'} ${resta && n ? 'text-red-700' : n ? 'text-gray-900' : 'text-secundario'}`}>{signo(n)}</span>
    </span>
  )
  return (
    <section className="bg-white rounded-xl border border-[#D3D1C7] overflow-hidden">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left min-h-[44px]">
        <span className="min-w-0">
          <span className="font-semibold text-gray-900">{titulo}</span>
          <span className="text-xs text-secundario ml-1.5 tabular-nums">{cantidad}</span>
          <span className="block text-xs text-secundario"><ChevronRight size={12} className={`inline text-inerte transition-transform ${abierto ? 'rotate-90' : ''}`} /> {abierto ? 'Ocultar el detalle' : 'Ver el detalle'}{nota ? ` · ${nota}` : ''}</span>
        </span>
        <span className={`grid ${COLUMNAS_IMPORTE} gap-2 shrink-0`}>
          {columna('Redonhielo', redonhielo, TEXTO_EMPRESA.redonhielo)}
          {columna('Rolito', rolito, TEXTO_EMPRESA.rolito)}
          {columna('Total', total, 'text-secundario', true)}
        </span>
      </button>
      {abierto && (
        <div className="border-t border-[#E7E5DC]">
          {cantidad === 0 && vacio ? <p className="px-3.5 py-2 text-sm text-secundario">{vacio}</p> : children}
        </div>
      )}
    </section>
  )
}

/** Las tres columnas de importe de Mi turno: Redonhielo, Rolito, Total. Encabezado y renglones comparten la medida. */
const COLUMNAS_IMPORTE = 'grid-cols-[104px_104px_112px]'

/**
 * Un renglón: hora o código, texto con empresa y el importe DEBAJO de la
 * columna de su empresa (2026-09-24). Una liquidación, que trae plata de las
 * dos, pasa `importePorEmpresa` y llena las dos columnas más el total.
 * Tocarlo abre lo que le pasen.
 */
export function Renglon({ clave, texto, sub, empresa, importe, importePorEmpresa, tachado = false, sinCajon = false, onClick }: {
  clave: string
  texto: string
  sub?: string
  empresa?: EmpresaTango
  importe: number
  importePorEmpresa?: { redonhielo: number; rolito: number }
  tachado?: boolean
  /** Cheque o transferencia: se lista pero no suma al cajón. */
  sinCajon?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  const claseImporte = `text-right tabular-nums font-medium whitespace-nowrap ${sinCajon ? 'text-secundario' : 'text-gray-900'}`
  const vacio = <span className="text-right text-inerte">—</span>
  const celdas = importePorEmpresa
    ? [importePorEmpresa.redonhielo, importePorEmpresa.rolito, importePorEmpresa.redonhielo + importePorEmpresa.rolito].map((n, i) => (
        <span key={i} className={`${claseImporte} ${i === 2 ? 'font-semibold' : ''}`}>{formatoARS(n)}</span>
      ))
    : [
        empresa === 'redonhielo' || !empresa ? <span key="rh" className={claseImporte}>{formatoARS(importe)}</span> : <span key="rh">{vacio}</span>,
        empresa === 'rolito' ? <span key="ro" className={claseImporte}>{formatoARS(importe)}</span> : <span key="ro">{vacio}</span>,
        <span key="t" />,
      ]
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`w-full grid grid-cols-[80px_1fr_auto] gap-2 items-center px-3.5 py-2 border-t border-[#E7E5DC] first:border-t-0 text-left text-sm ${onClick ? 'hover:bg-[#FCFBF8]' : ''} ${tachado ? 'line-through text-secundario' : ''}`}>
      <span className="text-xs text-secundario tabular-nums whitespace-nowrap">{clave}</span>
      {/* Sin chip de empresa (2026-09-24): la columna del importe ya dice de cuál es. */}
      <span className="min-w-0 truncate" title={`${texto}${sub ? ` · ${sub}` : ''}`}>
        <span className="text-gray-900">{texto}</span>
        {sub && <span className="text-xs text-secundario ml-1.5">{sub}</span>}
      </span>
      <span className={`grid ${COLUMNAS_IMPORTE} gap-2 shrink-0`}>{celdas}</span>
    </Tag>
  )
}

/** "Ver las 20 restantes" al pie de un bloque largo. */
export function VerMas({ ocultos, abierto, onToggle }: { ocultos: number; abierto: boolean; onToggle: () => void }) {
  if (ocultos <= 0) return null
  return (
    <button type="button" onClick={onToggle} className="w-full px-3.5 py-2 border-t border-[#E7E5DC] text-left text-xs font-semibold text-[#178760] min-h-[40px]">
      {abierto ? 'Ver menos' : `Ver ${ocultos === 1 ? 'el restante' : `las ${ocultos} restantes`}`}
    </button>
  )
}

// ── Cheques ──────────────────────────────────────────────────────────────────

export type DecisionCheque = { recibido: true } | { recibido: false; motivo: string }

/**
 * Los cheques de un sobre con emisión, fecha de pago y quién lo cobró (Ariel,
 * 23/09). `decisiones` + `onDecision` agregan los tildes de quien recibe.
 */
export function TablaCheques({ cheques, decisiones, onDecision, etiquetaSi = 'Recibido', etiquetaNo = 'No vino', pieRH = true }: {
  cheques: ChequeRendido[]
  decisiones?: Record<string, DecisionCheque | undefined>
  onDecision?: (clave: string, d: DecisionCheque) => void
  etiquetaSi?: string
  etiquetaNo?: string
  pieRH?: boolean
}) {
  if (!cheques.length) return <p className="text-sm text-secundario">Sin cheques.</p>
  const th = 'text-[10px] uppercase tracking-wider text-secundario font-bold text-left py-1.5 pr-2 border-b border-[#D3D1C7] whitespace-nowrap'
  const td = 'py-2 pr-2 border-b border-[#E7E5DC] align-top text-sm'
  const total = cheques.reduce((s, c) => s + c.importe, 0)
  const rh = cheques.filter((c) => (c.empresa ?? 'redonhielo') === 'redonhielo').reduce((s, c) => s + c.importe, 0)
  const dias = (c: ChequeRendido) => {
    if (c.dias) return c.dias
    if (!c.fechaEmision || !c.fechaAcreditacion) return 0
    return Math.round((new Date(c.fechaAcreditacion + 'T12:00:00').getTime() - new Date(c.fechaEmision + 'T12:00:00').getTime()) / 86400000)
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead><tr>
          <th className={th}>Emisor</th><th className={th}>Banco · N°</th><th className={th}>Emisión</th><th className={th}>Pago</th><th className={th}>Lo cobró</th><th className={`${th} text-right`}>Importe</th>
          {decisiones && <th className={th}></th>}
        </tr></thead>
        <tbody>
          {cheques.map((c) => {
            const clave = claveDeCheque(c)
            const d = decisiones?.[clave]
            const n = dias(c)
            return (
              <tr key={clave} className={d && !d.recibido ? 'bg-red-50' : ''}>
                <td className={td}><b className="font-semibold text-gray-900">{c.clienteNombre}</b><small className="block text-xs text-secundario">{NOMBRE_EMPRESA[c.empresa ?? 'redonhielo']}{c.numeroRecibo ? ` · recibo ${c.numeroRecibo}` : ''}</small></td>
                <td className={td}>{c.bancoNombre}<small className="block text-xs text-secundario tabular-nums">N° {c.numero}{c.esEcheq ? ' · e-cheq' : ''}</small></td>
                <td className={`${td} tabular-nums`}>{ddmmaa(c.fechaEmision)}</td>
                <td className={`${td} tabular-nums`}>{ddmmaa(c.fechaAcreditacion)}{n > 0 && <small className="block text-xs text-secundario">a {n} días</small>}</td>
                <td className={td}>{c.cobradoPor ?? '—'}<small className="block text-xs text-secundario">{c.origenCodigo ? `liquidación ${c.origenCodigo}` : 'mostrador'}</small></td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{formatoARS(c.importe)}</td>
                {decisiones && (
                  <td className={`${td} whitespace-nowrap`}>
                    <span className="inline-flex gap-1">
                      <button type="button" onClick={() => onDecision?.(clave, { recibido: true })} className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-full border text-xs font-semibold ${d?.recibido ? 'bg-[#1D9E75] text-white border-[#1D9E75]' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}><Check size={12} /> {etiquetaSi}</button>
                      <button type="button" onClick={() => onDecision?.(clave, { recibido: false, motivo: d && !d.recibido ? d.motivo : '' })} className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-full border text-xs font-semibold ${d && !d.recibido ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}><X size={12} /> {etiquetaNo}</button>
                    </span>
                    {d && !d.recibido && (
                      <input value={d.motivo} onChange={(e) => onDecision?.(clave, { recibido: false, motivo: e.target.value })} placeholder="Motivo (obligatorio)" className="mt-1 block w-44 bg-white border border-red-300 rounded-lg px-2 py-1 text-xs" />
                    )}
                  </td>
                )}
              </tr>
            )
          })}
          <tr>
            <td colSpan={5} className="py-2 pr-2 text-sm font-bold text-gray-900">{cheques.length} {cheques.length === 1 ? 'cheque' : 'cheques'}{pieRH && <span className="font-normal text-xs text-secundario ml-2"><TextoRH redonhielo={rh} rolito={total - rh} guiones={false} /></span>}</td>
            <td className="py-2 pr-2 text-right text-sm font-bold tabular-nums">{formatoARS(total)}</td>
            {decisiones && <td />}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

