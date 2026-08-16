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
import { tsToDate } from './helpers'

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

// ── Tiempo por paso ─────────────────────────────────────────────────────────

const DIA_MS = 86_400_000

export interface TiempoPorPaso {
  pasoId:       string
  pasoNombre:   string
  tipoPipeline: TipoPipelineHeladera
  muestras:     number
  promedioDias: number
}

// Reconstruye, a partir de historialAcciones, cuánto tardó cada heladera en
// cada paso por el que pasó: cada transición (paso_completado/paso_aprobado/
// paso_rechazado) trae `pasoId` = el paso que se acaba de DEJAR, así que la
// duración es su timestamp menos el de la transición anterior (o `creada`
// para el primer paso). No retroactivo: transiciones viejas sin `pasoId` no
// generan una muestra, pero sí siguen marcando el límite de tiempo para la
// transición siguiente.
export function calcularTiemposPorPaso(heladeras: Heladera[], catalogo: CatalogoPasos): TiempoPorPaso[] {
  const duracionesPorPaso = new Map<string, number[]>()

  for (const heladera of heladeras) {
    const eventos = [...heladera.historialAcciones].sort(
      (a, b) => tsToDate(a.timestamp).getTime() - tsToDate(b.timestamp).getTime(),
    )
    const creada = eventos.find((e) => e.accion === 'creada')
    if (!creada) continue

    let entradaMs = tsToDate(creada.timestamp).getTime()
    for (const evento of eventos) {
      if (!['paso_completado', 'paso_aprobado', 'paso_rechazado'].includes(evento.accion)) continue
      const salidaMs = tsToDate(evento.timestamp).getTime()
      if (evento.pasoId) {
        const lista = duracionesPorPaso.get(evento.pasoId) ?? []
        lista.push(salidaMs - entradaMs)
        duracionesPorPaso.set(evento.pasoId, lista)
      }
      entradaMs = salidaMs
    }
  }

  return Array.from(duracionesPorPaso.entries())
    // Un paso puede haberse borrado del catálogo después de que se usó —
    // sin nombre/pipeline no hay forma útil de etiquetarlo, se omite.
    .flatMap(([pasoId, duraciones]) => {
      const paso = catalogo[pasoId]
      if (!paso) return []
      return [{
        pasoId,
        pasoNombre:   paso.nombre,
        tipoPipeline: paso.tipoPipeline,
        muestras:     duraciones.length,
        promedioDias: duraciones.reduce((s, v) => s + v, 0) / duraciones.length / DIA_MS,
      }]
    })
    .sort((a, b) => b.promedioDias - a.promedioDias)
}
