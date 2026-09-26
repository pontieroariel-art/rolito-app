import { ReactNode, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Inbox, RotateCw, Search, TriangleAlert } from 'lucide-react'
import { INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { descargarCSV } from '@/utils/csv'
import { useIsMobile } from '@/hooks/useIsMobile'
import { CAMPO_FILTRO, NUMERO, TD, TD_COMPACTA, TH, TH_COMPACTA } from './tabla'

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
 *
 * CONVENCIONES DE DISEÑO (2026-09-13) que aplica sola, para no repetirlas en
 * cada pantalla:
 *  · `alinear: 'der'` ya trae `tabular-nums`: toda columna de importes, kilos o
 *    cantidades se lee en vertical sin que bailen las cifras.
 *  · `truncar` corta el texto de la celda en una línea y deja el valor entero
 *    en el `title`; el tooltip sale del `csv` de la columna. Las razones
 *    sociales de Tango son largas y antes rompían la fila.
 *  · Los grises secundarios (vacío, paginador, esqueleto) salen de
 *    `text-secundario`, que es el piso de contraste de la app.
 *  · En el celular (menos de 768 px) cada fila es una TARJETA (relevamiento de
 *    responsividad, 2026-09-26): la primera columna de título y las demás como
 *    etiqueta y valor, los botones (`sinCsv` sin título) al pie. Una tabla de
 *    diez columnas en 375 px obligaba a scrollear al costado sin saber que había
 *    más. `sinTarjetas` la deja como tabla.
 */



export interface ColumnaHistorial<T> {
  /** Título de la columna; también el encabezado en el CSV. */
  titulo: string
  celda: (fila: T) => ReactNode
  /** Números. Alinea a la derecha y aplica `tabular-nums`. */
  alinear?: 'der'
  /** Valor plano para el CSV. Sin esto, exporta la celda solo si es texto o número. */
  csv?: (fila: T) => string | number | null | undefined
  /** Fuera del CSV (columnas de botones). */
  sinCsv?: boolean
  /** Texto largo: una sola línea, con el valor completo en el tooltip. */
  truncar?: boolean
  /** Ancho máximo de la celda, en px. Solo tiene sentido con `truncar`. */
  anchoMax?: number
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
  /** Celdas más apretadas. Para tablas de diez o más columnas. */
  compacta?: boolean
  /** En el celular, seguir mostrando la tabla en vez de tarjetas. */
  sinTarjetas?: boolean
  className?: string
}

const valorCSV = <T,>(c: ColumnaHistorial<T>, fila: T): string | number | null | undefined => {
  if (c.csv) return c.csv(fila)
  const v = c.celda(fila)
  return typeof v === 'string' || typeof v === 'number' ? v : ''
}

export { TH, TD, CAMPO_FILTRO, NUMERO }

/** Tooltip de una celda truncada: el mismo valor plano que va al CSV. */
const tituloDe = <T,>(c: ColumnaHistorial<T>, fila: T): string | undefined => {
  if (!c.truncar) return undefined
  const v = valorCSV(c, fila)
  return v === null || v === undefined || v === '' ? undefined : String(v)
}

export default function HistorialTable<T>({
  columnas, filas, claveDe, titulo, resumen, cargando = false, error = false, onReintentar,
  vacio = 'No hay registros en este período.', anchoMinimo, filaResaltada, porPagina, exportar, compacta = false, sinTarjetas = false, className = '',
}: Props<T>) {
  const esCelular = useIsMobile()
  const enTarjetas = esCelular && !sinTarjetas
  const th = compacta ? TH_COMPACTA : TH
  const td = compacta ? TD_COMPACTA : TD

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
            <p className="text-sm text-gray-900">No pudimos cargar estos datos.</p>
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
            <td key={c.titulo + j} className={td}>
              <span className="block h-3.5 rounded bg-[#EDEBE3] animate-pulse" style={{ width: j === 0 ? '70%' : '45%' }} />
            </td>
          ))}
        </tr>
      ))
    }
    if (filas.length === 0) {
      return (
        <tr>
          <td colSpan={columnas.length} className="px-3 py-10 text-center">
            <Inbox size={22} className="mx-auto text-inerte mb-2" />
            <p className="text-sm text-secundario">{vacio}</p>
          </td>
        </tr>
      )
    }
    return visibles.map((fila) => (
      <tr key={claveDe(fila)} className={filaResaltada?.(fila) ? 'bg-accent/5' : ''}>
        {columnas.map((c, i) => (
          <td
            key={c.titulo + i}
            // Para que `truncate` funcione, la celda necesita `max-w-0`: sin eso
            // el ancho máximo de un <td> lo ignora el layout automático de la
            // tabla y la columna crece con el contenido. Pero `max-w-0` sola
            // deja a la columna sin peso y el navegador le roba el espacio a
            // las vecinas, así que el ancho preferido va en el <th> (ver abajo).
            className={`${td} ${c.alinear === 'der' ? NUMERO : ''} ${c.truncar || c.anchoMax ? 'max-w-0' : ''}`}
            style={c.anchoMax ? { maxWidth: c.anchoMax } : undefined}
          >
            {c.truncar
              ? <span className="block truncate" title={tituloDe(c, fila)}>{c.celda(fila)}</span>
              : c.celda(fila)}
          </td>
        ))}
      </tr>
    ))
  }

  // Celular: una tarjeta por fila.
  const [cabeza, ...resto] = columnas
  const acciones = resto.filter((c) => c.sinCsv && !c.titulo)
  const campos = resto.filter((c) => !(c.sinCsv && !c.titulo))
  const tarjetas = () => {
    if (error) {
      return (
        <div className="py-10 text-center">
          <TriangleAlert size={22} className="mx-auto text-amber-500 mb-2" />
          <p className="text-sm text-gray-900">No pudimos cargar estos datos.</p>
          {onReintentar && (
            <button type="button" onClick={onReintentar}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent border border-accent/40 rounded-lg px-3 py-2 hover:bg-accent/10 transition-colors">
              <RotateCw size={14} /> Reintentar
            </button>
          )}
        </div>
      )
    }
    if (cargando) {
      return [0, 1, 2].map((i) => (
        <div key={`esqueleto-${i}`} aria-hidden className="border border-[#E7E5DC] rounded-xl p-3 space-y-2">
          <span className="block h-4 w-2/3 rounded bg-[#EDEBE3] animate-pulse" />
          <span className="block h-3.5 w-1/2 rounded bg-[#EDEBE3] animate-pulse" />
        </div>
      ))
    }
    if (filas.length === 0) {
      return (
        <div className="py-10 text-center">
          <Inbox size={22} className="mx-auto text-inerte mb-2" />
          <p className="text-sm text-secundario">{vacio}</p>
        </div>
      )
    }
    return visibles.map((fila) => (
      <article key={claveDe(fila)} className={`border border-[#E7E5DC] rounded-xl p-3 min-w-0 ${filaResaltada?.(fila) ? 'bg-accent/5' : ''}`}>
        {cabeza && (
          <div className="text-[15px] font-semibold text-gray-900 min-w-0 break-words">{cabeza.celda(fila)}</div>
        )}
        {campos.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {campos.map((c, i) => (
              <div key={c.titulo + i} className="contents">
                <dt className="text-secundario">{c.titulo}</dt>
                <dd className={`min-w-0 break-words text-gray-900 ${c.alinear === 'der' ? NUMERO : 'text-right'}`}>{c.celda(fila)}</dd>
              </div>
            ))}
          </dl>
        )}
        {acciones.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#E7E5DC] flex flex-wrap items-center justify-end gap-2">
            {acciones.map((c, i) => <div key={i}>{c.celda(fila)}</div>)}
          </div>
        )}
      </article>
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
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-secundario border border-[#D3D1C7] rounded-lg px-2.5 py-1.5 hover:text-accent hover:border-accent transition-colors">
                <Download size={13} /> Exportar
              </button>
            )}
          </div>
        </div>
      )}

      {enTarjetas ? (
        <div className="space-y-2">{tarjetas()}</div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full" style={anchoMinimo ? { minWidth: anchoMinimo } : undefined}>
          <thead>
            {/* El ancho preferido de una columna acotada va en el <th>: es lo
                que devuelve el peso que le saca `max-w-0` a la celda. */}
            <tr>{columnas.map((c, i) => (
              <th
                key={c.titulo + i}
                className={`${th} ${c.alinear === 'der' ? 'text-right' : ''} whitespace-nowrap`}
                style={c.anchoMax ? { width: c.anchoMax, maxWidth: c.anchoMax } : undefined}
              >
                {c.titulo}
              </th>
            ))}</tr>
          </thead>
          <tbody>{cuerpo()}</tbody>
        </table>
      </div>
      )}

      {paginas > 1 && !cargando && !error && (
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[#E7E5DC]">
          <p className="text-xs text-secundario tabular-nums">
            {paginaActual * porPagina! + 1}–{Math.min((paginaActual + 1) * porPagina!, filas.length)} de {filas.length}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPagina(paginaActual - 1)} disabled={paginaActual === 0} aria-label="Página anterior"
              className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-secundario hover:border-accent hover:text-accent disabled:text-inerte disabled:hover:border-[#D3D1C7] disabled:hover:text-inerte transition-colors">
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs text-secundario px-1 tabular-nums">{paginaActual + 1} / {paginas}</span>
            <button type="button" onClick={() => setPagina(paginaActual + 1)} disabled={paginaActual >= paginas - 1} aria-label="Página siguiente"
              className="w-8 h-8 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-secundario hover:border-accent hover:text-accent disabled:text-inerte disabled:hover:border-[#D3D1C7] disabled:hover:text-inerte transition-colors">
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-secundario pointer-events-none" />
          <input {...INPUT_BUSQUEDA_PROPS} value={buscador.valor} onChange={(e) => buscador.onChange(e.target.value)}
            placeholder={buscador.placeholder ?? 'Buscar…'} aria-label={buscador.placeholder ?? 'Buscar'}
            className={`${CAMPO_FILTRO} w-full pl-8`} />
        </div>
      )}
      {children}
    </div>
  )
}
