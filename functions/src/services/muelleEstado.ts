/**
 * Estado público del muelle (2026-09-15): qué dársenas están ocupadas y por qué.
 *
 * Para qué: el camión que vuelve del reparto estaciona DIRECTO en una boca para
 * que le cuenten la descarga, y el chofer elige esa boca desde su teléfono. Pero el
 * chofer no puede leer los remitos de los demás ni la ventanilla (y no tiene por
 * qué), así que el servidor publica en `muelleEstado/{planta}` un resumen
 * sanitizado —número de boca, tipo y una etiqueta corta— y la app le muestra solo
 * las libres. Misma lógica que el TV del muelle usa para pintar cada boca.
 *
 * Prioridad por boca: un camión que volvió y espera conteo pisa a todo lo demás
 * (es la alerta roja); después el que está cargando; al final el turno de ventanilla.
 */
import { Timestamp } from 'firebase-admin/firestore'

export interface RemitoLite {
  estado:       string
  choferId:     string
  camionLabel?: string
  darsena?:     number
  regreso?:     { darsena?: number }
}
export interface DescargaLite { choferId: string }
/**
 * El camión que está CARGANDO es un borrador, no un remito (2026-09-18): el
 * remito nace recién cuando muelle entrega el camión. Si esto no se publicara,
 * al chofer que vuelve se le ofrecería como libre una boca con un camión adentro.
 */
export interface BorradorLite {
  estado:       string
  camionLabel?: string
  darsena?:     number
}
export interface VentaLite {
  estado:       string
  turnoEstado?: string
  darsena?:     number
  turno?:       number
}
export type Ocupacion = { tipo: 'carga' | 'regreso' | 'ventanilla'; etiqueta: string }

/** Patente sola: `camionLabel` viene como "AB123CD · Iveco" en los remitos. */
export const patenteDe = (label?: string): string => String(label ?? '').split('·')[0].trim()

export function calcularOcupadas(
  remitos: RemitoLite[],
  descargas: DescargaLite[],
  ventas: VentaLite[],
  borradores: BorradorLite[] = [],
): Record<string, Ocupacion> {
  const out: Record<string, Ocupacion> = {}
  const poner = (n: number | undefined, o: Ocupacion) => {
    if (typeof n !== 'number' || n < 1 || out[String(n)]) return
    out[String(n)] = o
  }
  // Un camión contado deja de "estar volviendo" aunque el remito siga 'salido'.
  const contados = new Set(descargas.map((d) => d.choferId))
  for (const r of remitos) {
    if (r.regreso?.darsena && !contados.has(r.choferId)) poner(r.regreso.darsena, { tipo: 'regreso', etiqueta: patenteDe(r.camionLabel) })
  }
  for (const b of borradores) {
    if (b.estado === 'pendiente' && b.darsena) poner(b.darsena, { tipo: 'carga', etiqueta: patenteDe(b.camionLabel) })
  }
  for (const v of ventas) {
    if (v.estado === 'pendiente_entrega' && v.turnoEstado === 'llamado' && v.darsena) poner(v.darsena, { tipo: 'ventanilla', etiqueta: `T-${v.turno ?? '?'}` })
  }
  return out
}

/** Día operativo en hora argentina (UTC-3 fijo, AR no tiene horario de verano). */
export function rangoDiaArt(ahora: number = Date.now()): { ymd: string; desde: Timestamp; hasta: Timestamp } {
  const art = new Date(ahora - 3 * 3600_000)
  const ymd = art.toISOString().slice(0, 10)
  const desde = new Date(`${ymd}T03:00:00Z`)                    // 00:00 ART
  const hasta = new Date(desde.getTime() + 24 * 3600_000)
  return { ymd, desde: Timestamp.fromDate(desde), hasta: Timestamp.fromDate(hasta) }
}
