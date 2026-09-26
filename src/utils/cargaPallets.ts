// Lógica pura de la pantalla de carga de pallets de producción (2026-09-14).
//
// La tablet de planta es vieja y el operario tiene guantes: acá vive lo que
// decide cada toque (armar / confirmar / ignorar) y el resumen del día que se
// muestra en gigante, sin nada de React, para poder testearlo y para que la
// pantalla solo pinte.
import type { PalletProduccion, ProductoHieloId } from '@/types'

/** Una tarjeta armada vuelve sola a la normalidad si nadie confirma en este tiempo. */
export const ARMADO_MS = 8_000
/**
 * Un segundo toque demasiado pegado al primero es un doble toque accidental
 * (dedo que rebota, guante), no una confirmación: se ignora.
 */
export const ANTI_DOBLE_TOQUE_MS = 400

export interface Armado {
  productoId: ProductoHieloId
  /** epoch ms del toque que armó la tarjeta */
  desde: number
  /** epoch ms hasta el que vale la confirmación */
  hasta: number
}

export type AccionToque = 'armar' | 'confirmar' | 'ignorar'

export function armar(productoId: ProductoHieloId, ahora: number): Armado {
  return { productoId, desde: ahora, hasta: ahora + ARMADO_MS }
}

/**
 * Qué hace un toque sobre una tarjeta:
 * - sin nada armado, o armado otro producto, o armado vencido → arma esta;
 * - misma tarjeta, dentro del plazo y pasado el anti-doble-toque → confirma;
 * - misma tarjeta demasiado rápido → se ignora.
 */
export function accionDelToque(armado: Armado | null, productoId: ProductoHieloId, ahora: number): AccionToque {
  if (!armado || armado.productoId !== productoId) return 'armar'
  if (ahora - armado.desde < ANTI_DOBLE_TOQUE_MS) return 'ignorar'
  if (ahora >= armado.hasta) return 'armar'
  return 'confirmar'
}

export type PalletMinimo = Pick<PalletProduccion, 'id' | 'productoId' | 'codigo'> & {
  fechaFabricacion: { toDate(): Date }
  anulacion?: unknown
}

/** Un pallet anulado por el encargado no cuenta en ningún total (2026-09-25). */
export function palletVigente(p: { anulacion?: unknown }): boolean {
  return !p.anulacion
}

/** Solo los pallets que cuentan: sin anular. */
export function palletsVigentes<T extends { anulacion?: unknown }>(pallets: T[]): T[] {
  return pallets.every(palletVigente) ? pallets : pallets.filter(palletVigente)
}

export interface UltimoPallet {
  productoId: ProductoHieloId
  codigo:     string
  hora:       Date
}

export interface ResumenDia {
  total:       number
  porProducto: Partial<Record<ProductoHieloId, number>>
  ultimo:      UltimoPallet | null
}

/**
 * Los pallets recién confirmados en esta tablet todavía no están en el
 * snapshot (createdAt es serverTimestamp y la consulta filtra por él): se
 * suman aparte hasta que el servidor los devuelve. Acá salen de la lista los
 * que ya aparecieron.
 */
export function pendientesSinConfirmar<T extends { id: string }>(pendientes: T[], pallets: { id: string }[]): T[] {
  if (pendientes.length === 0) return pendientes
  const vistos = new Set(pallets.map((p) => p.id))
  const quedan = pendientes.filter((p) => !vistos.has(p.id))
  return quedan.length === pendientes.length ? pendientes : quedan
}

/** Total del día, conteo por producto y último pallet, con los pendientes incluidos una sola vez. */
export function resumenDelDia(pallets: PalletMinimo[], pendientes: PalletMinimo[], inicioDia: Date): ResumenDia {
  const finDia = new Date(inicioDia)
  finDia.setDate(finDia.getDate() + 1)
  const desde = inicioDia.getTime()
  const hasta = finDia.getTime()

  const porProducto: Partial<Record<ProductoHieloId, number>> = {}
  let total = 0
  let ultimo: UltimoPallet | null = null
  const vistos = new Set<string>()

  const sumar = (p: PalletMinimo) => {
    if (vistos.has(p.id)) return
    vistos.add(p.id)
    if (!palletVigente(p)) return
    const hora = p.fechaFabricacion.toDate()
    const t = hora.getTime()
    if (t < desde || t >= hasta) return
    total += 1
    porProducto[p.productoId] = (porProducto[p.productoId] ?? 0) + 1
    if (!ultimo || t > ultimo.hora.getTime()) ultimo = { productoId: p.productoId, codigo: p.codigo, hora }
  }
  pallets.forEach(sumar)
  pendientes.forEach(sumar)

  return { total, porProducto, ultimo }
}

/** Código que va a salir con el próximo pallet, para mostrarlo en la tarjeta armada. */
export function codigoDePallet(prefijo: string, numero: number): string {
  return `${prefijo}-${String(numero).padStart(6, '0')}`
}

/**
 * Un pallet tarda minutos en armarse: si se confirma el mismo producto antes
 * de este tiempo desde el anterior, casi seguro es un doble cargado
 * (2026-09-25, pedido de Ariel). La ventana pregunta antes de confirmar.
 */
export const REPETIDO_MS = 60_000

/**
 * Hace cuántos segundos se cargó el último pallet vigente de ese producto, si
 * fue hace menos de REPETIDO_MS; si no, null. Cuenta los pendientes de esta
 * tablet (todavía sin confirmar por el servidor) y saltea los anulados.
 */
export function repetidoHaceSegundos(
  productoId: ProductoHieloId,
  listas: PalletMinimo[][],
  ahora: number,
): number | null {
  let ultimo = -Infinity
  for (const lista of listas) {
    for (const p of lista) {
      if (p.productoId !== productoId || !palletVigente(p)) continue
      const t = p.fechaFabricacion.toDate().getTime()
      if (t > ultimo) ultimo = t
    }
  }
  const dif = ahora - ultimo
  return dif >= 0 && dif < REPETIDO_MS ? Math.max(1, Math.round(dif / 1000)) : null
}
