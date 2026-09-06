import type { DepositoTango } from '@/types'

// Depósitos de reparto (expedición por depósito de Tango, 2026-09-06).
//
// En Tango cada repartidor es un depósito en tránsito. La app trabaja con esa
// identidad en carga, descarga y liquidación; el usuario de la app vinculado
// es opcional (un tercerizado puede cargar sin usuario). Como las colecciones
// de expedición ya se indexan por `choferId`, la IDENTIDAD de un depósito en
// esos docs es el uid de su usuario si lo tiene, o un id sintético `dep:33` si
// no — así las consultas y las reglas de lectura del chofer siguen sirviendo
// sin índices nuevos.

export const PREFIJO_IDENTIDAD_DEPOSITO = 'dep:'

export const identidadDeposito = (d: Pick<DepositoTango, 'codigo' | 'uid'>): string =>
  d.uid ? d.uid : `${PREFIJO_IDENTIDAD_DEPOSITO}${d.codigo}`

export const esIdentidadSintetica = (id: string): boolean => id.startsWith(PREFIJO_IDENTIDAD_DEPOSITO)

/** "21 · Primiterra Cristian" (usuario vinculado) o "33 · NOAIN 01" (nombre de Tango). */
export const etiquetaDeposito = (d: Pick<DepositoTango, 'codigo' | 'nombre' | 'usuarioNombre'>): string =>
  `${d.codigo} · ${d.usuarioNombre?.trim() || d.nombre}`

/** Nombre "de persona" para los docs (choferNombre): el del usuario si lo hay, si no el de Tango. */
export const nombreDeposito = (d: Pick<DepositoTango, 'nombre' | 'usuarioNombre'>): string =>
  d.usuarioNombre?.trim() || d.nombre

/** Depósitos que salen a repartir, activos, ordenados: primero los `destacados` (con movimiento hoy), después por código. */
export function ordenarDepositosReparto(depositos: DepositoTango[], destacados: Set<string> = new Set()): DepositoTango[] {
  const porCodigo = (a: DepositoTango, b: DepositoTango) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })
  const reparto = depositos.filter((d) => d.tipo === 'repartidor' && d.activo && !d.inhabilitado)
  const con = reparto.filter((d) => destacados.has(identidadDeposito(d))).sort(porCodigo)
  const sin = reparto.filter((d) => !destacados.has(identidadDeposito(d))).sort(porCodigo)
  return [...con, ...sin]
}

/** Depósito de un usuario de la app (chofer o supervisor vinculado), si lo tiene. */
export const depositoDeUsuario = (depositos: DepositoTango[], uid: string | null | undefined): DepositoTango | undefined =>
  uid ? depositos.find((d) => d.uid === uid) : undefined

/** Depósito a partir de la identidad guardada en un doc (uid o `dep:33`). */
export function depositoDeIdentidad(depositos: DepositoTango[], identidad: string): DepositoTango | undefined {
  if (esIdentidadSintetica(identidad)) return depositos.find((d) => d.codigo === identidad.slice(PREFIJO_IDENTIDAD_DEPOSITO.length))
  return depositos.find((d) => d.uid === identidad)
}
