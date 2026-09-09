/**
 * Fecha de emisión de los comprobantes en deuda (2026-09-09, pedido de los cobradores).
 *
 * Las Live de deudas (17953 / 17955) devuelven SIEMPRE las columnas de su diseño
 * de fábrica, y ahí no está la fecha de emisión (agregarla en pantalla no cambia
 * lo que devuelve la API — comprobado, INTEGRACION.md §10). La trae la Live
 * "Detalle de comprobantes" (17943, un renglón por artículo facturado), que se
 * consulta por rango de FECHA DE EMISIÓN y comparte el `ID_GVA12` con las de
 * deudas. Como una fecha de emisión no cambia nunca, se guarda en
 * `tangoEmisiones/{empresa}` (mapa ID_GVA12 → yyyy-mm-dd) y cada corrida solo
 * pide los últimos días; si igual queda algún comprobante sin fecha, se amplía
 * la ventana una vez. El mapa se poda a los comprobantes que siguen en deuda.
 */

import type { Empresa } from './empresas'
import { prop } from './pedido'

export const PROCESO_DETALLE_COMPROBANTES_DEFAULT = 17943
/** Días hacia atrás que se vuelven a pedir en cada corrida (por si Tango cargó comprobantes con fecha anterior). */
export const SOLAPE_DIAS = 3
/** Ventana máxima hacia atrás para buscar comprobantes que quedaron sin fecha. */
export const BACKFILL_MAX_DIAS = 400

export interface MapaEmisiones {
  /** ID_GVA12 (como texto) → fecha de emisión yyyy-mm-dd. */
  fechas: Record<string, string>
  /** Último día (yyyy-mm-dd) hasta el que se pidió el detalle de comprobantes. */
  hastaFecha?: string
}

export const rutaEmisiones = (empresa: Empresa): string => `tangoEmisiones/${empresa}`

export const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const ddMMyyyy = (d: Date): string => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
export const restarDias = (d: Date, dias: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() - dias)
export const deIso = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))

/** Filas de la Live 17943 → ID_GVA12 → fecha (yyyy-mm-dd). Varios renglones por comprobante: la primera fecha gana. */
export function fechasDeFilasDetalle(filas: Record<string, unknown>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of filas) {
    const id = prop(f, 'ID_GVA12')
    const fecha = prop(f, 'FECHA_DE_EMISION')
    if (typeof id !== 'number' || typeof fecha !== 'string' || fecha.length < 10) continue
    const k = String(id)
    if (!out[k]) out[k] = fecha.slice(0, 10)
  }
  return out
}

interface ConFechaEmision { fechaEmision?: string; fechaVencimiento?: string; idComprobanteTango?: number }

/**
 * Completa `fechaEmision` en los comprobantes que no la tienen, por ID_GVA12.
 * Devuelve los que siguen sin fecha (con su vencimiento, para acotar la búsqueda).
 */
export function completarEmision(comprobantes: ConFechaEmision[], fechas: Record<string, string>): ConFechaEmision[] {
  const faltantes: ConFechaEmision[] = []
  for (const c of comprobantes) {
    if (c.fechaEmision) continue
    const fecha = c.idComprobanteTango !== undefined ? fechas[String(c.idComprobanteTango)] : undefined
    if (fecha) c.fechaEmision = fecha
    else faltantes.push(c)
  }
  return faltantes
}

/** Solo las fechas de los comprobantes que siguen en deuda: el mapa no crece sin límite. */
export function podarMapa(fechas: Record<string, string>, idsEnUso: Iterable<number | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of idsEnUso) {
    if (id === undefined) continue
    const k = String(id)
    if (fechas[k]) out[k] = fechas[k]
  }
  return out
}

/**
 * Qué rango pedirle a la Live de detalle en esta corrida (fechas de emisión):
 *  - normalmente, desde `hastaFecha` − SOLAPE_DIAS hasta hoy (nada si ya se pidió hoy);
 *  - si hay comprobantes sin fecha, desde el vencimiento más viejo de esos − 120 días
 *    (tope BACKFILL_MAX_DIAS), que es donde puede estar su emisión.
 */
export function rangoAPedir(mapa: MapaEmisiones | undefined, hoy: Date, faltantes: ConFechaEmision[]): { desde: Date; hasta: Date } | null {
  const piso = restarDias(hoy, BACKFILL_MAX_DIAS)
  if (faltantes.length) {
    const vtos = faltantes.map((c) => c.fechaVencimiento).filter((v): v is string => !!v && /^\d{4}-\d{2}-\d{2}/.test(v)).sort()
    const base = vtos.length ? restarDias(deIso(vtos[0]), 120) : piso
    return { desde: base < piso ? piso : base, hasta: hoy }
  }
  if (!mapa?.hastaFecha) return { desde: piso, hasta: hoy }
  if (mapa.hastaFecha >= iso(hoy)) return null
  const desde = restarDias(deIso(mapa.hastaFecha), SOLAPE_DIAS)
  return { desde: desde < piso ? piso : desde, hasta: hoy }
}
