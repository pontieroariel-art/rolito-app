// Pipeline de taller de heladeras — data-driven contra el catálogo
// config/pasosTaller (ver pasosTallerService.ts), no una secuencia fija en
// código. Dos pipelines conviven (tipoPipeline 'fabricacion' /
// 'reacondicionamiento'), cada uno con sus propios pasos ordenados por
// `orden` y linkeados por `siguientePasoId`.
//
// Invariantes que garantiza este archivo (por construcción, sin necesidad
// de validar "no saltear/repetir paso" a mano):
// - Agarrar nunca cambia pasoActualId, solo setea enProceso.
// - Soltar (paso sin requiereAprobacion) o aprobar (paso con
//   requiereAprobacion) siempre avanza a paso.siguientePasoId, o a
//   'disponible' si era el último paso activo.
// - Rechazar (solo pasos con requiereAprobacion) siempre vuelve a
//   heladera.primerPasoId y suma un ciclo.
//
// Este archivo es la fuente de verdad del lado del cliente. Las reglas de
// Firestore (firestore.rules) replican la misma lógica leyendo el mismo
// catálogo con get() — cualquier cambio acá tiene que reflejarse ahí también.

import { AreaHeladera, Heladera, PasoTaller, TipoPipelineHeladera } from '../types'

export type CatalogoPasos = Record<string, PasoTaller>

export const pasoDe = (catalogo: CatalogoPasos, id: string | null | undefined): PasoTaller | undefined =>
  id ? catalogo[id] : undefined

export const pasoActual = (heladera: Heladera, catalogo: CatalogoPasos): PasoTaller | undefined =>
  pasoDe(catalogo, heladera.pasoActualId)

// Pasos activos de un pipeline, ordenados — para el tablero y para calcular
// el primer paso al dar de alta una heladera.
export const pasosOrdenados = (catalogo: CatalogoPasos, tipoPipeline: TipoPipelineHeladera): PasoTaller[] =>
  Object.values(catalogo)
    .filter((p) => p.tipoPipeline === tipoPipeline && p.activo)
    .sort((a, b) => a.orden - b.orden)

export const primerPasoActivo = (catalogo: CatalogoPasos, tipoPipeline: TipoPipelineHeladera): PasoTaller | undefined =>
  pasosOrdenados(catalogo, tipoPipeline)[0]

// ── Reglas de transición (mismas que validan las Firestore rules) ─────────

export function puedeAgarrar(heladera: Heladera, catalogo: CatalogoPasos, areaActor: AreaHeladera): boolean {
  const paso = pasoActual(heladera, catalogo)
  return heladera.estado === 'en_taller' && !heladera.enProceso && !!paso && paso.area === areaActor
}

// Paso "simple" — una sola salida (avanza al siguiente, o a disponible).
export function puedeSoltar(heladera: Heladera, catalogo: CatalogoPasos, uidActor: string): boolean {
  const paso = pasoActual(heladera, catalogo)
  return heladera.estado === 'en_taller' && heladera.enProceso?.uid === uidActor && !!paso && !paso.requiereAprobacion
}

// Paso "de aprobación" (ej. control de calidad) — dos salidas posibles.
export function puedeResolverAprobacion(heladera: Heladera, catalogo: CatalogoPasos, uidActor: string): boolean {
  const paso = pasoActual(heladera, catalogo)
  return heladera.estado === 'en_taller' && heladera.enProceso?.uid === uidActor && !!paso?.requiereAprobacion
}

export function puedeLiberar(heladera: Heladera): boolean {
  return heladera.estado === 'en_taller' && !!heladera.enProceso
}
