// Tipos comunes del writer SQL (remitos y recibos directo en la base de Tango).
// Ver docs/tango/INTEGRACION.md §20/§21 y las trazas reales en docs/tango/sql/.
//
// El writer no depende de un driver concreto: recibe un `EjecutorSql` (en la VM
// será `mssql`; en los tests, un fake). Todas las sentencias van parametrizadas
// con el tipo SQL explícito, copiado de lo que manda el propio Tango (varchar(n),
// numeric(22,7), datetime, bit, int, smallint, float).

export type TipoSql =
  | { kind: 'varchar'; length: number }
  | { kind: 'numeric'; precision: number; scale: number }
  | { kind: 'datetime' }
  | { kind: 'bit' }
  | { kind: 'int' }
  | { kind: 'smallint' }
  | { kind: 'float' }
  | { kind: 'text' }

export interface ParametroSql {
  nombre: string
  tipo: TipoSql
  valor: string | number | boolean | Date | null
}

export interface SentenciaSql {
  /** Para el log y los tests: qué hace ("INSERT STA14", "UPDATE STA19 stock"). */
  etiqueta: string
  sql: string
  params: ParametroSql[]
}

/** Lo mínimo que el writer necesita de la conexión. `query` devuelve las filas. */
export interface EjecutorSql {
  query<T = Record<string, unknown>>(sql: string, params?: ParametroSql[]): Promise<T[]>
}

// Helpers de tipado, para escribir los parámetros como los manda Tango.
export const varchar = (nombre: string, valor: string | null, length: number): ParametroSql => ({ nombre, tipo: { kind: 'varchar', length }, valor })
export const numeric = (nombre: string, valor: number, precision = 22, scale = 7): ParametroSql => ({ nombre, tipo: { kind: 'numeric', precision, scale }, valor })
export const datetime = (nombre: string, valor: Date): ParametroSql => ({ nombre, tipo: { kind: 'datetime' }, valor })
export const bit = (nombre: string, valor: boolean): ParametroSql => ({ nombre, tipo: { kind: 'bit' }, valor })
export const int = (nombre: string, valor: number | null): ParametroSql => ({ nombre, tipo: { kind: 'int' }, valor })
export const smallint = (nombre: string, valor: number): ParametroSql => ({ nombre, tipo: { kind: 'smallint' }, valor })
export const float = (nombre: string, valor: number): ParametroSql => ({ nombre, tipo: { kind: 'float' }, valor })

/** Fecha "de comprobante" de Tango: el día a las 00:00 (así la guarda en FECHA_MOV / FECHA_EMIS). */
export function soloDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Hora como la guarda Tango en HORA_COMP / HORA_INGRESO: 'HHMMSS'. */
export function horaHHMMSS(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
}

/** Fecha nula de Tango (FECHA_ANU de un comprobante vigente). */
export const FECHA_NULA_TANGO = new Date(1800, 0, 1)

/** Número de comprobante como lo guarda Tango: letra + punto de venta (5) + número (8). Ej. 'R0000100480100'. */
export function numeroComprobanteTango(letra: string, puntoVenta: number, numero: number): string {
  return `${letra}${String(puntoVenta).padStart(5, '0')}${String(numero).padStart(8, '0')}`
}

/** Arma un INSERT parametrizado a partir de pares columna → parámetro (misma forma que usa Tango). */
export function insert(etiqueta: string, tabla: string, columnas: ParametroSql[], conIdentity = false): SentenciaSql {
  const cols = columnas.map((c) => `"${c.nombre}"`).join(',')
  const vals = columnas.map((c) => `@${c.nombre}`).join(',')
  return {
    etiqueta,
    sql: `INSERT INTO "${tabla}" (${cols}) VALUES (${vals})${conIdentity ? '; SELECT SCOPE_IDENTITY() AS ID' : ''}`,
    params: columnas,
  }
}
