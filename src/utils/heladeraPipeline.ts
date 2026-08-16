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

import { AccionHistorial, AreaHeladera, Heladera, PasoTaller, TipoPipelineHeladera } from '../types'
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

const TIPOS_TRANSICION = ['paso_completado', 'paso_aprobado', 'paso_rechazado']

export interface EventoConDuracion extends AccionHistorial {
  // Cuánto pasó desde que se entró al paso que este evento acaba de dejar
  // (gap con la transición anterior, o con `creada` si es la primera).
  // undefined si el evento no es una transición de paso, o si es una
  // transición vieja sin `pasoId` (no retroactivo).
  duracionMs?: number
}

// Recorre el historial de una heladera en orden cronológico y le suma a cada
// transición de pipeline (paso_completado/paso_aprobado/paso_rechazado, que
// traen `pasoId` = el paso recién DEJADO) cuánto duró ese paso. Comparten
// esta reconstrucción tanto el detalle por heladera (ficha del equipo) como
// el agregado por paso (Informes) — ver `calcularTiemposPorPaso`.
export function historialConDuraciones(heladera: Heladera): EventoConDuracion[] {
  const eventos = [...heladera.historialAcciones].sort(
    (a, b) => tsToDate(a.timestamp).getTime() - tsToDate(b.timestamp).getTime(),
  )
  const creada = eventos.find((e) => e.accion === 'creada')
  if (!creada) return eventos

  let entradaMs = tsToDate(creada.timestamp).getTime()
  return eventos.map((evento) => {
    if (!TIPOS_TRANSICION.includes(evento.accion)) return evento
    const salidaMs = tsToDate(evento.timestamp).getTime()
    const duracionMs = evento.pasoId ? salidaMs - entradaMs : undefined
    entradaMs = salidaMs
    return { ...evento, duracionMs }
  })
}

// Agregado por paso across todas las heladeras — para el gráfico de
// "cuellos de botella" en Informes. No retroactivo: transiciones viejas sin
// `pasoId` no generan una muestra, pero sí siguen marcando el límite de
// tiempo para la transición siguiente (ver `historialConDuraciones`).
export function calcularTiemposPorPaso(heladeras: Heladera[], catalogo: CatalogoPasos): TiempoPorPaso[] {
  const duracionesPorPaso = new Map<string, number[]>()

  for (const heladera of heladeras) {
    for (const evento of historialConDuraciones(heladera)) {
      if (!evento.pasoId || evento.duracionMs === undefined) continue
      const lista = duracionesPorPaso.get(evento.pasoId) ?? []
      lista.push(evento.duracionMs)
      duracionesPorPaso.set(evento.pasoId, lista)
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

// Formato legible para una duración puntual (a diferencia del promedio de
// Informes, que siempre se expresa en días): minutos/horas si fue rápido,
// días con un decimal si no.
export function formatDuracion(ms: number): string {
  const minutos = ms / 60_000
  if (minutos < 60) return `${Math.max(1, Math.round(minutos))} min`
  const horas = minutos / 60
  if (horas < 24) return `${Math.round(horas * 10) / 10} h`
  return `${Math.round((horas / 24) * 10) / 10} días`
}
