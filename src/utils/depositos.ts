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

/**
 * "21 · PRIMITERRA CRISTIAN" (usuario vinculado) o "33 · NOAIN 01" (nombre de Tango).
 *
 * En MAYÚSCULA desde el 2026-09-20 (pedido de Ariel): los nombres llegan de dos
 * lados —el usuario de la app y la descripción del depósito en Tango— y cada
 * uno con su forma, así que la lista era un mosaico de "Ivan Almiron",
 * "CRISTIAN CURUCHET" y "Gerez Ricardo Fabián". Mayúscula pareja es
 * presentación: no toca el dato ni lo que sale impreso.
 *
 * Lo que NO se puede arreglar acá es el orden apellido/nombre: del texto no se
 * deduce cuál es cuál. Eso se corrige en el nombre del usuario (Usuarios) o en
 * la descripción del depósito en Tango, que son las dos fuentes.
 */
export const etiquetaDeposito = (d: Pick<DepositoTango, 'codigo' | 'nombre' | 'usuarioNombre'>): string =>
  `${d.codigo} · ${nombreDeposito(d).toUpperCase()}`

/** Nombre "de persona" para los docs (choferNombre): el del usuario si lo hay, si no el de Tango. */
export const nombreDeposito = (d: Pick<DepositoTango, 'nombre' | 'usuarioNombre'>): string =>
  d.usuarioNombre?.trim() || d.nombre

/**
 * Depósitos que salen a repartir, activos: primero los `destacados` (los que
 * tienen movimiento hoy) y después el resto, cada grupo **por nombre**.
 *
 * Antes iban por código de depósito, que es un número que nadie recuerda: para
 * encontrar a alguien en una lista de cuarenta había que leerla entera
 * (2026-09-20, pedido de Ariel). Por nombre se busca como se piensa.
 */
export function ordenarDepositosReparto(depositos: DepositoTango[], destacados: Set<string> = new Set()): DepositoTango[] {
  const porNombre = (a: DepositoTango, b: DepositoTango) =>
    nombreDeposito(a).localeCompare(nombreDeposito(b), 'es', { numeric: true, sensitivity: 'base' })
  const reparto = depositos.filter((d) => d.tipo === 'repartidor' && d.activo && !d.inhabilitado)
  const con = reparto.filter((d) => destacados.has(identidadDeposito(d))).sort(porNombre)
  const sin = reparto.filter((d) => !destacados.has(identidadDeposito(d))).sort(porNombre)
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
