import { Fragment, type ReactNode } from 'react'
import Badge, { type TonoBadge } from '@/components/common/Badge'
import { TH, TD } from '@/components/common/tabla'
import { formatoARS } from '@/utils/money'
import { ChipEmpresa } from '@/components/common/TablaConteoBilletes'
import type { EstadoCaja, EstadoCalle, FilaCalle, PlataVentas, PorEmpresaYTotal } from '@/utils/tesoreriaLive'

// Piezas compartidas por los dos tableros en vivo (Ventas y Tesorería,
// 2026-09-16). Los miran directores en el momento (Ariel: "ultra sencillo,
// fácil de entender, sin cosas raras"), así que hay UNA sola forma de mostrar
// la plata y la mercadería: tres columnas fijas, Redonhielo (azul), Rolito
// (violeta) y Total (negro), en el cuadro de arriba y en cada tabla.

const INPUT = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

export const COLOR = { redonhielo: '#14538C', rolito: '#6B3F94', total: '#111827' }
export const EMPRESAS = [
  { id: 'redonhielo' as const, nombre: 'Redonhielo', clase: 'text-[#14538C]' },
  { id: 'rolito' as const,     nombre: 'Rolito',     clase: 'text-[#6B3F94]' },
]

export function EncabezadoLive({ icono, titulo, bajada, dia, hoy, onDia, ultimoCambio }: {
  icono: ReactNode
  titulo: string
  bajada: string
  dia: string
  hoy: string
  onDia: (d: string) => void
  ultimoCambio: Date | null
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">{icono} {titulo}</h1>
        <p className="text-secundario text-sm">{bajada}</p>
      </div>
      <div className="flex items-center gap-3">
        {ultimoCambio && dia === hoy && <span className="inline-flex items-center gap-1.5 text-xs text-[#0F6B4E]"><span className="w-2 h-2 rounded-full bg-[#1D9E75] animate-pulse" /> en vivo · {ultimoCambio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
        <input type="date" value={dia} max={hoy} onChange={(e) => onDia(e.target.value)} className={INPUT} aria-label="Día" />
      </div>
    </div>
  )
}

// ── El cuadro: filas × (Redonhielo · Rolito · Total) ─────────────────────────

export interface FilaCuadro {
  etiqueta: string
  valores: PorEmpresaYTotal
  /** Cantidad (ventas, recibos, cheques) que se muestra chiquita al lado del importe. */
  cantidades?: PorEmpresaYTotal
  /** La fila que importa: número grande. */
  destacada?: boolean
  /** Informativa (no se rinde): en gris. */
  secundaria?: boolean
  /** Importes por defecto; `String` para unidades. */
  formato?: (n: number) => string
  /** Una nota chica bajo la etiqueta ("no se rinden"). */
  nota?: string
}

export const sumaEmpresas = (redonhielo: number, rolito: number): PorEmpresaYTotal => ({ redonhielo, rolito, total: redonhielo + rolito })

/**
 * Un bloque con título y una tabla de tres columnas. Es la misma pieza arriba
 * de las dos pantallas y dentro de cada fila desplegada, para que el ojo
 * siempre encuentre Redonhielo, Rolito y Total en el mismo lugar.
 */
export function CuadroEmpresas({ titulo, filas, extra, compacto }: { titulo?: string; filas: FilaCuadro[]; extra?: ReactNode; compacto?: boolean }) {
  const celda = (f: FilaCuadro, n: number, cant: number | undefined, esTotal: boolean, clase: string, key: string) => {
    const fmt = f.formato ?? formatoARS
    const vacio = n === 0 && !cant
    const tam = f.destacada ? (compacto ? 'text-lg' : 'text-2xl md:text-3xl') : (compacto ? 'text-sm' : 'text-base')
    return (
      <td key={key} className={`${compacto ? 'px-3 py-1.5' : 'px-4 py-2.5'} text-right align-baseline`}>
        <span className={`font-bold tabular-nums leading-none ${tam} ${vacio ? 'text-secundario' : f.secundaria ? 'text-secundario' : esTotal ? 'text-gray-900' : clase}`}>{vacio ? '—' : fmt(n)}</span>
        {cant !== undefined && cant > 0 && <span className="ml-1.5 text-xs text-secundario tabular-nums">({cant})</span>}
      </td>
    )
  }
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
      {(titulo || extra) && (
        <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#E7E5DC]">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">{titulo}</h2>
          {extra}
        </header>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-[#E7E5DC]">
              <th className={`${compacto ? 'px-3' : 'px-4'} py-2 text-left text-xs font-semibold uppercase tracking-wide text-secundario`}></th>
              {EMPRESAS.map((e) => <th key={e.id} className={`${compacto ? 'px-3' : 'px-4'} py-2 text-right`}><ChipEmpresa empresa={e.id} /></th>)}
              <th className={`${compacto ? 'px-3' : 'px-4'} py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-900`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.etiqueta} className={`border-b border-[#E7E5DC] last:border-0 ${f.destacada ? 'bg-[#F8F7F2]' : ''}`}>
                <td className={`${compacto ? 'px-3 py-1.5' : 'px-4 py-2.5'} align-baseline`}>
                  <span className={`${f.destacada ? 'text-sm font-semibold text-gray-900' : 'text-sm text-gray-900'} ${f.secundaria ? 'text-secundario' : ''}`}>{f.etiqueta}</span>
                  {f.nota && <span className="block text-[11px] text-secundario">{f.nota}</span>}
                </td>
                {EMPRESAS.map((e) => celda(f, f.valores[e.id], f.cantidades?.[e.id], false, e.clase, e.id))}
                {celda(f, f.valores.total, f.cantidades?.total, true, '', 'total')}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Tres celdas de una tabla: Redonhielo · Rolito · Total (mismo orden y colores que el cuadro). */
export function CeldasEmpresas({ valores, formato = formatoARS, cantidades }: { valores: PorEmpresaYTotal; formato?: (n: number) => string; cantidades?: PorEmpresaYTotal }) {
  const c = (n: number, cant: number | undefined, clase: string, negrita: boolean) => (
    <td className={`${TD} text-right tabular-nums ${negrita ? 'font-bold' : 'font-semibold'} ${n ? clase : 'text-secundario'}`}>
      {n ? formato(n) : '—'}{cant ? <span className="ml-1 text-[11px] font-normal text-secundario">({cant})</span> : null}
    </td>
  )
  return (
    <>
      {EMPRESAS.map((e) => <Fragment key={e.id}>{c(valores[e.id], cantidades?.[e.id], e.clase, false)}</Fragment>)}
      {c(valores.total, cantidades?.total, 'text-gray-900', true)}
    </>
  )
}

/** Encabezados de tabla con las tres columnas de empresa, para las tablas de las dos pantallas. */
export function ThEmpresas() {
  return (
    <>
      {EMPRESAS.map((e) => <th key={e.id} className={`${TH} text-right`}><ChipEmpresa empresa={e.id} /></th>)}
      <th className={`${TH} text-right text-gray-900`}>Total</th>
    </>
  )
}

/** Unidades partidas por empresa en una sola celda: el total arriba, el reparto chiquito abajo. */
export function CantidadPartida({ v }: { v: PorEmpresaYTotal }) {
  if (!v.total) return <span className="text-secundario">—</span>
  return (
    <span className="inline-block text-right">
      <span className="block font-semibold tabular-nums text-gray-900">{v.total.toLocaleString('es-AR')}</span>
      <span className="block text-[11px] tabular-nums text-secundario whitespace-nowrap"><span className={EMPRESAS[0].clase}>{v.redonhielo.toLocaleString('es-AR')}</span> · <span className={EMPRESAS[1].clase}>{v.rolito.toLocaleString('es-AR')}</span></span>
    </span>
  )
}

export function BotonDetalle({ abierto, onClick, etiqueta = 'Detalle' }: { abierto: boolean; onClick: () => void; etiqueta?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={abierto}
      className="inline-flex items-center gap-1 min-h-[44px] px-2 -my-2 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg whitespace-nowrap">
      {abierto ? '▾ Ocultar' : `▸ ${etiqueta}`}
    </button>
  )
}

export const ventasTxt = (p: PlataVentas): string => (p.cantidad ? `${p.cantidad} · ${formatoARS(p.total)}` : '—')
export const importeOGuion = (n: number): string => (n ? formatoARS(n) : '—')
export const num = (n: number): string => (n ? n.toLocaleString('es-AR') : '—')

const ESTADO_CALLE: Record<EstadoCalle, { texto: string; tono: TonoBadge }> = {
  sin_carga:  { texto: 'Sin carga',   tono: 'neutro' },
  cargado:    { texto: 'Cargado',     tono: 'confirmado' },
  vendiendo:  { texto: 'Vendiendo',   tono: 'pendiente' },
  volvio:     { texto: 'Volvió',      tono: 'enCamino' },
  descargado: { texto: 'Descargado',  tono: 'enCamino' },
  liquidado:  { texto: 'Liquidado',   tono: 'entregado' },
}
export function BadgeCalle({ estado }: { estado: EstadoCalle }) {
  const e = ESTADO_CALLE[estado]
  return <Badge tono={e.tono}>{e.texto}</Badge>
}

const ESTADO_CAJA: Record<EstadoCaja, { texto: string; tono: TonoBadge }> = {
  sin_turno: { texto: 'Sin turno',            tono: 'neutro' },
  abierta:   { texto: 'Caja abierta',         tono: 'pendiente' },
  en_camino: { texto: 'Sobre en camino',      tono: 'enCamino' },
  recibida:  { texto: 'Recibido',             tono: 'entregado' },
  cerrada:   { texto: 'Cerrada · sin validar', tono: 'confirmado' },
  validada:  { texto: 'Validada',             tono: 'entregado' },
}
export function BadgeCaja({ estado }: { estado: EstadoCaja }) {
  const e = ESTADO_CAJA[estado]
  return <Badge tono={e.tono}>{e.texto}</Badge>
}

// ── Las tres tarjetas grandes de arriba ──────────────────────────────────────

export interface TarjetaEmpresa { importe: number; cantidad?: number; lineas: Array<[string, string]> }

const TARJETA = {
  redonhielo: { fondo: 'bg-[#EEF4FA] border-[#BFD8EE]', titulo: 'text-[#14538C]', numero: 'text-[#14538C]' },
  rolito:     { fondo: 'bg-[#F3EEF9] border-[#D8C8EA]', titulo: 'text-[#6B3F94]', numero: 'text-[#6B3F94]' },
  total:      { fondo: 'bg-[#F8F7F2] border-[#D3D1C7]', titulo: 'text-gray-900',  numero: 'text-gray-900' },
}

/**
 * Lo primero que se lee: Redonhielo, Rolito y Total en tres tarjetas grandes,
 * cada una con su color de fondo suave. Si tenés cinco segundos, alcanza con esto.
 */
export function TarjetasEmpresa({ etiqueta, redonhielo, rolito, total }: { etiqueta: string; redonhielo: TarjetaEmpresa; rolito: TarjetaEmpresa; total: TarjetaEmpresa }) {
  const tarjeta = (id: 'redonhielo' | 'rolito' | 'total', t: TarjetaEmpresa) => {
    const c = TARJETA[id]
    return (
      <div key={id} className={`rounded-2xl border p-4 md:p-5 ${c.fondo} ${id === 'total' ? 'md:col-span-1' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          {id === 'total'
            ? <span className={`text-xs font-bold uppercase tracking-wider ${c.titulo}`}>Total</span>
            : <ChipEmpresa empresa={id} />}
          <span className="text-xs text-secundario">{etiqueta}</span>
        </div>
        <p className={`mt-2 text-3xl md:text-4xl font-bold tabular-nums leading-none ${t.importe ? c.numero : 'text-secundario'}`}>
          {t.importe ? formatoARS(t.importe) : '—'}
          {t.cantidad ? <span className="ml-2 text-sm font-medium text-secundario">({t.cantidad})</span> : null}
        </p>
        <div className="mt-3 space-y-1">
          {t.lineas.map(([k, v]) => (
            <p key={k} className="flex justify-between gap-3 text-sm"><span className="text-secundario">{k}</span><b className="tabular-nums text-gray-900">{v}</b></p>
          ))}
        </div>
      </div>
    )
  }
  return (
    <section className="grid md:grid-cols-3 gap-3">
      {tarjeta('redonhielo', redonhielo)}
      {tarjeta('rolito', rolito)}
      {tarjeta('total', total)}
    </section>
  )
}

// ── Barra de avance de un producto ───────────────────────────────────────────

/**
 * De lo que se cargó, cuánto se vendió (azul Redonhielo, violeta Rolito) y
 * cuánto volvió (gris); lo que queda claro sigue en el camión. Sin carga, nada.
 */
export function BarraProducto({ cargado, vendido, descargado }: { cargado: number; vendido: PorEmpresaYTotal; descargado: number }) {
  if (!cargado) return <span className="text-secundario">—</span>
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / cargado) * 100))}%`
  const vendidoPct = Math.round((vendido.total / cargado) * 100)
  return (
    <div className="flex items-center gap-2 min-w-[160px]" title={`Vendido ${vendido.total} de ${cargado} (${vendidoPct} %) · volvió ${descargado}`}>
      <div className="flex-1 h-2.5 rounded-full bg-[#ECEAE2] overflow-hidden flex">
        <span className="h-full bg-[#2C7CC4]" style={{ width: pct(vendido.redonhielo) }} />
        <span className="h-full bg-[#8A4FBF]" style={{ width: pct(vendido.rolito) }} />
        <span className="h-full bg-[#B9B6A8]" style={{ width: pct(descargado) }} />
      </div>
      <span className="text-xs tabular-nums text-secundario w-9 text-right">{vendidoPct} %</span>
    </div>
  )
}

// ── Los camiones, paso a paso ────────────────────────────────────────────────

const PASOS: Array<{ estado: EstadoCalle; etiqueta: string; tono: string }> = [
  { estado: 'cargado',    etiqueta: 'Cargados',          tono: 'text-[#14538C]' },
  { estado: 'vendiendo',  etiqueta: 'Vendiendo',         tono: 'text-[#8A5203]' },
  { estado: 'volvio',     etiqueta: 'Volvieron',         tono: 'text-[#0F6E56]' },
  { estado: 'descargado', etiqueta: 'Contados por muelle', tono: 'text-[#0F6E56]' },
  { estado: 'liquidado',  etiqueta: 'Liquidados',        tono: 'text-[#0B5A3C]' },
]

/** Cuántos camiones hay en cada paso del día, de izquierda a derecha. */
export function PasosCamiones({ filas }: { filas: FilaCalle[] }) {
  const conRemito = filas.filter((f) => f.remitos > 0)
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Camiones · {conRemito.length} salieron hoy</h2>
      <div className="bg-white border border-[#D3D1C7] rounded-xl px-2 py-2 flex flex-wrap items-stretch">
        {PASOS.map((p, i) => {
          const n = conRemito.filter((f) => f.estado === p.estado).length
          return (
            <Fragment key={p.estado}>
              {i > 0 && <span className="self-center text-inerte px-1 hidden sm:inline">›</span>}
              <div className={`flex-1 min-w-[120px] rounded-lg px-3 py-2 ${n ? 'bg-[#F8F7F2]' : ''}`}>
                <p className={`text-2xl font-bold tabular-nums leading-none ${n ? p.tono : 'text-secundario'}`}>{n}</p>
                <p className="text-xs text-secundario mt-1">{p.etiqueta}</p>
              </div>
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
