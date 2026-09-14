import type { DescargaCamion } from '../types'

// Rectificar un conteo mal cargado (2026-09-13, paso 8 del control de fugas).
//
// `descargasCamion` es inmutable a propósito (update y delete en false): el
// conteo es la prueba del control y no se reescribe. Pero con gente contando de
// parado, con guantes y con el chofer esperando, un número mal tipeado va a
// pasar — y cargar "otra descarga" SUMA en la liquidación en vez de reemplazar,
// que es peor que el error original.
//
// Entonces la corrección es un documento NUEVO que apunta al viejo
// (`rectificaA`) con motivo obligatorio, y todo lo que lee descargas toma la
// rectificación EN LUGAR de la original. Mismo patrón que el repo ya usa para
// corregir sin reescribir (`anulacion` dentro de la venta,
// `anulacionesPosteriores` en los cierres).
//
// OJO con Tango: la descarga original ya encoló la transferencia camión →
// planta y NO existe contra-movimiento (no hay buildError para
// `transferenciaDeposito` ni estado "cancelado" en la cola). Por eso la
// rectificación NO se encola (ver functions/triggers/tangoOutbox) y el ajuste
// de stock lo hace la oficina a mano, avisada por push — igual que con los
// remitos que anula el chofer.

/** Las descargas que valen: sin las que fueron rectificadas por otra. */
export function descargasVigentes<T extends { id: string; rectificaA?: string }>(descargas: T[]): T[] {
  const rectificadas = new Set(
    descargas.map((d) => d.rectificaA).filter((id): id is string => !!id),
  )
  return descargas.filter((d) => !rectificadas.has(d.id))
}

/** ¿Esta descarga quedó reemplazada por una corrección posterior? */
export const fueRectificada = (
  descarga: { id: string },
  descargas: Array<{ rectificaA?: string }>,
): boolean => descargas.some((d) => d.rectificaA === descarga.id)

/**
 * Lo que se contó en una descarga, listo para precargar el formulario de
 * corrección. No rompe el conteo ciego: es el propio número que cargó muelle,
 * no el teórico.
 */
export function conteoDe(d: DescargaCamion): { sanas: Record<string, number>; rotas: Record<string, number> } {
  const mapa = (items: DescargaCamion['items']) =>
    Object.fromEntries(items.map((i) => [i.productoId, i.cantidad]))
  return { sanas: mapa(d.items), rotas: mapa(d.bolsasRotas) }
}
