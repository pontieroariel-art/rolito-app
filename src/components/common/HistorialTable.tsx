import { ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Inbox, RotateCw, Search, TriangleAlert } from 'lucide-react'
import { INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { descargarCSV } from '@/utils/csv'
import { CAMPO_FILTRO, TD, TH } from './tabla'

/**
 * TABLA DE HISTORIAL canónica (fase 3.2 del reordenamiento, 2026-09-12).
 *
 * Base común de las tablas de auditoría: encabezado, celdas, cargando, vacío,
 * error con reintento, paginador al pie y exportar a CSV. Antes cada pantalla
 * repetía las clases de `th`/`td`, su propia fila de "sin datos" y no tenía ni
 * paginador ni exportación.
 *
 * Las consultas y las suscripciones siguen siendo de cada pantalla: este
 * componente solo dibuja lo que le pasan.
 *
 * Las pantallas que ya tienen su tabla armada a mano pueden usar solo las
 * clases (`TH`, `TD`) para no repetirlas.
 */



export interface ColumnaHistorial<T> {
  /** Título de la columna; también el encabezado en el CSV. */
  titulo: string
  celda: (fila: T) => ReactNode
  alinear?: 'der'
  /** Valor plano para el CSV. Sin esto, exporta la celda solo si es texto o número. */
  csv?: (fila: T) => string | number | null | undefined
  /** Fuera del CSV (columnas de botones). */
  sinCsv?: boolean
}

interface Props<T> {
  columnas: ColumnaHistorial<T>[]
  filas: T[]
  claveDe: (fila: T) => string
  /** Título de la sección, arriba de la tabla. */
  titulo?: string
  /** A la derecha del título (totales del período). */
  resumen?: ReactNode
  cargando?: boolean
  error?: boolean
  onReintentar?: () => void
  /** Qué decir cuando no hay nada. */
  vacio?: string
  anchoMinimo?: number
  filaResaltada?: (fila: T) => boolean
  /** Filas por página; sin esto se muestran todas. */
  porPagina?: number
  /** Nombre base del archivo; sin esto no hay botón de exportar. */
  exportar?: string
  className?: string
}

const valorCSV = <T,>(c: ColumnaHistorial<T>, fila: T): string | number | null | undefined => {
  if (c.csv) return c.csv(fila)
  const v = c.celda(fila)
  return typeof v === 'string' || typeof v === 'number' ? v : ''
}

export { TH, TD, CAMPO_FILTRO }

export default function HistorialTable<T>({
  columnas, filas, claveDe, titulo, resumen, cargando = false, error = false, onReintentar,
  vacio = 'No hay registros en este período.', anchoMinimo, filaResaltada, porPagina, exportar, className = '',
}: Props<T>) {
  const [pagina, setPagina] = useState(0)

  const paginas = porPagina ? Math.ceil(filas.length / porPagina) : 1
  const paginaActual = Math.min(pagina, Math.max(paginas - 1, 0))
  const visibles = useMemo(
    () => (porPagina ? filas.slice(paginaActual * porPagina, (paginaActual + 1) * porPagina) : filas),
    [filas, porPagina, paginaActual],
  )

  const exportables = columnas.filter((c) => !c.sinCsv)
  const bajarCSV = () => descargarCSV(
    exportar ?? 'historial',
    exportables.map((c) => c.titulo),
    filas.map((f) => exportables.map((c) => valorCSV(c, f))),
  )

  const cuerpo = () => {
    if (error) {
      return (
        <tr>
          <td colSpan={columnas.length} className="px-3 py-10 text-center">
            <TriangleAlert size={22} className="mx-auto text-amber-500 mb-2" />
            <p className="text-sm text-gray-700">No pudimos cargar estos datos.</p>
            {onReintentar && (
              <button type="button" onClick={onReintentar}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/40 rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors">
                <RotateCw size={13} /> Reintentar
              </button>
            )}
          </td>
        </tr>
      )
    }
    if (cargando) {
      return [0, 1, 2, 3, 4].map((i) => (
        <tr key={`esqueleto-${i}`} aria-hidden>
          {columnas.map((c, j) => (
            <td key={c.titulo + j} className={TD}>
              <span className="block h-3.5 rounded bg-gray-100 animate-pulse" style={{ width: j === 0 ? '70%' : '45%' }} />
            </td>
          ))}
        </tr>
      ))
    }
    if (filas.length === 0) {
      return (
        <tr>
          <td colSpan={columnas.length} className="px-3 py-10 text-center">
            <Inbox size={22} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">{vacio}</p>
          </td>
        </tr>
      )
    }
    return visibles.map((fila) => (
      <tr key={claveDe(fila)} className={filaResaltada?.(fila) ? 'bg-accent/5' : ''}>
        {columnas.map((c, i) => (
          <td key={c.titulo + i} className={`${TD} ${c.alinear === 'der' ? 'text-right' : ''}`}>{c.celda(fila)}</td>
        ))}
      </tr>
    ))
  }

  const hayBarra = titulo || resumen || exportar
  return (
    <section className={`bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 ${className}`}>
      {hayBarra && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          {titulo ? <p className="text-sm font-semibold text-gray-900">{titulo}</p> : <span />}
          <div className="flex items-center gap-3">
            {resumen}
            {exportar && filas.length > 0 && !cargando && !error && (
              <button type="button" onClick={bajarCSV} title="Bajar esta tabla en CSV (se abre con Excel)"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-[#D3D1C7] rounded-lg px-2.5 py-1.5 hover:text-accent hover:border-accent transition-colors">
                <Download size={13} /> Exportar
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full" style={anchoMinimo ? { minWidth: anchoMinimo } : undefined}>
          <thead>
            <tr>{columnas.map((c, i) => <th key={c.titulo + i} className={`${TH} ${c.alinear === 'der' ? 'text-right' : ''}`}>{c.titulo}</th>)}</tr>
          </thead>
          <tbody>{cuerpo()}</tbody>
        </table>
      </div>

      {paginas > 1 && !cargando && !error && (
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-gray-100">
          <p className="text-xs text-gray-500 tabular-nums">
            {paginaActual * porPagina! + 1}–{Math.min((paginaActual + 1) * porPagina!, filas.length)} de {filas.length}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPagina(paginaActual - 1)} disabled={paginaActual === 0} aria-label="Página anterior"
              className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-gray-600 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-[#D3D1C7] disabled:hover:text-gray-600 transition-colors">
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs text-gray-500 px-1 tabular-nums">{paginaActual + 1} / {paginas}</span>
            <button type="button" onClick={() => setPagina(paginaActual + 1)} disabled={paginaActual >= paginas - 1} aria-label="Página siguiente"
              className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-gray-600 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-[#D3D1C7] disabled:hover:text-gray-600 transition-colors">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Barra de filtros ─────────────────────────────────────────────────────────

export interface SelectFiltro {
  valor: string
  onChange: (v: string) => void
  /** La primera opción es la de "todos". */
  opciones: Array<{ value: string; label: string }>
  etiqueta: string
}

/**
 * Barra estándar de un historial: mes, buscador de texto y los selectores que
 * necesite la pantalla. Lo que se hace con esos valores (filtrar, resuscribir)
 * queda en la pantalla.
 */
export function BarraHistorial({
  mes, buscador, selects = [], children,
}: {
  mes?: { valor: string; max?: string; onChange: (m: string) => void }
  buscador?: { valor: string; onChange: (v: string) => void; placeholder?: string }
  selects?: SelectFiltro[]
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mes && (
        <input type="month" value={mes.valor} max={mes.max} onChange={(e) => mes.onChange(e.target.value)}
          aria-label="Mes" className={CAMPO_FILTRO} />
      )}
      {selects.map((s) => (
        <select key={s.etiqueta} value={s.valor} onChange={(e) => s.onChange(e.target.value)} aria-label={s.etiqueta} className={CAMPO_FILTRO}>
          {s.opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {buscador && (
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input {...INPUT_BUSQUEDA_PROPS} value={buscador.valor} onChange={(e) => buscador.onChange(e.target.value)}
            placeholder={buscador.placeholder ?? 'Buscar…'} aria-label={buscador.placeholder ?? 'Buscar'}
            className={`${CAMPO_FILTRO} w-full pl-8`} />
        </div>
      )}
      {children}
    </div>
  )
}
