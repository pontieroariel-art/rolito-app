import type { OrderStatus, Rendicion, RollupPedidosDia } from '@/types'

// Lógica pura del panel de control del super_admin (`/admin`, 2026-09-10):
// qué tono lleva cada tile (ok / atención / error / neutro) y cómo se lee
// cada señal. Sin Firebase: los datos entran ya leídos (ver
// services/backofficeEstadoService.ts y hooks/useEstadoBackoffice.ts) y acá
// solo se interpretan. Todo testeado en backofficeEstado.test.ts.

export type Tono = 'ok' | 'atencion' | 'error' | 'neutro'

/** Umbrales a partir de los cuales una integración pasa a "error". */
export const UMBRALES = {
  /** Heartbeat del bridge de Tango en la VM (config/tango.bridgeListenerLastSeen), minutos. */
  bridgeMin:     5,
  /** Sync de clientes y de precios: corren a diario (5:00 / 5:30); más de un día + margen es atraso. */
  clientesHoras: 26,
  preciosHoras:  26,
  /** Sync de saldos: cada hora de 6 a 22. Fuera de ese horario no se evalúa. */
  saldosHoras:   2,
  saldosDesde:   6,
  saldosHasta:   22,
} as const

/** Conteo de "cosas pendientes": 0 está bien, algo pendiente pide atención (o es error si `grave`). */
export function tonoConteo(n: number | null | undefined, grave = false): Tono {
  if (n == null) return 'neutro'
  if (n === 0) return 'ok'
  return grave ? 'error' : 'atencion'
}

/** El peor de varios tonos (error > atención > ok > neutro). */
export function peorTono(...tonos: Tono[]): Tono {
  if (tonos.includes('error')) return 'error'
  if (tonos.includes('atencion')) return 'atencion'
  if (tonos.includes('ok')) return 'ok'
  return 'neutro'
}

/** "hace 5 min", "hace 3 h", "hace 2 d" — o "nunca". */
export function haceTexto(fecha: Date | null | undefined, ahora: Date): string {
  if (!fecha) return 'nunca'
  const min = Math.max(0, Math.round((ahora.getTime() - fecha.getTime()) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 48) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}

export interface Atraso {
  horas: number | null
  tono:  Tono
  texto: string
}

/** Última corrida de una sync contra su máximo tolerado. Sin corrida = error (nunca corrió). */
export function atrasoSync(ultima: Date | null | undefined, ahora: Date, maxHoras: number): Atraso {
  if (!ultima) return { horas: null, tono: 'error', texto: 'nunca' }
  const horas = (ahora.getTime() - ultima.getTime()) / 3_600_000
  return { horas, tono: horas > maxHoras ? 'error' : 'ok', texto: haceTexto(ultima, ahora) }
}

/** Heartbeat del bridge: más de `maxMin` minutos sin señal = caído. */
export function estadoBridge(lastSeen: Date | null | undefined, ahora: Date, maxMin: number = UMBRALES.bridgeMin): Atraso {
  if (!lastSeen) return { horas: null, tono: 'error', texto: 'sin señal' }
  const min = (ahora.getTime() - lastSeen.getTime()) / 60_000
  return { horas: min / 60, tono: min > maxMin ? 'error' : 'ok', texto: haceTexto(lastSeen, ahora) }
}

/** La sync de saldos solo corre de 6 a 22 (hora local de la oficina). */
export function saldosEnHorario(ahora: Date): boolean {
  const h = ahora.getHours()
  return h >= UMBRALES.saldosDesde && h < UMBRALES.saldosHasta
}

/** Saldos: fuera de horario no se juzga (neutro); adentro, atraso normal. */
export function atrasoSaldos(ultima: Date | null | undefined, ahora: Date): Atraso {
  const a = atrasoSync(ultima, ahora, UMBRALES.saldosHoras)
  if (!saldosEnHorario(ahora) && ultima) return { ...a, tono: 'neutro' }
  return a
}

/** Cierres de caja que tesorería todavía no revisó. */
export function rendicionesSinValidar(rendiciones: Pick<Rendicion, 'validacion'>[]): number {
  return rendiciones.filter((r) => !r.validacion).length
}

export interface PedidosHoy {
  total:     number
  porEstado: Record<OrderStatus, number>
}

const ESTADOS_PEDIDO: OrderStatus[] = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado']

/** Pedidos del día desde el rollup (sin rollup todavía = todo en cero). */
export function pedidosHoy(rollup: RollupPedidosDia | null | undefined): PedidosHoy {
  const porEstado = {} as Record<OrderStatus, number>
  for (const e of ESTADOS_PEDIDO) porEstado[e] = rollup?.porEstado?.[e] ?? 0
  return { total: rollup?.total ?? 0, porEstado }
}

export interface ConteosOutbox {
  enCurso:             number | null
  error:               number | null
  consultasPendientes: number | null
  consultasError:      number | null
  altasError:          number | null
}

/** Cola hacia Tango: cualquier error es error; cosas en curso son normales (atención solo si se acumulan). */
export function resumenOutbox(c: ConteosOutbox, maxEnCurso = 20): { tono: Tono; errores: number } {
  const errores = (c.error ?? 0) + (c.consultasError ?? 0) + (c.altasError ?? 0)
  if (errores > 0) return { tono: 'error', errores }
  if (c.enCurso == null && c.consultasPendientes == null) return { tono: 'neutro', errores }
  const enCurso = (c.enCurso ?? 0) + (c.consultasPendientes ?? 0)
  return { tono: enCurso > maxEnCurso ? 'atencion' : 'ok', errores }
}

/** Facturación electrónica: apagada es neutro; rechazadas o inciertas piden mirar. */
export function resumenArca(habilitado: boolean | null, rechazadas: number | null, inciertas: number | null): { tono: Tono; problemas: number } {
  const problemas = (rechazadas ?? 0) + (inciertas ?? 0)
  if (problemas > 0) return { tono: 'error', problemas }
  if (habilitado === false) return { tono: 'neutro', problemas }
  if (habilitado == null || rechazadas == null) return { tono: 'neutro', problemas }
  return { tono: 'ok', problemas }
}

/** COT de ARBA: en error es error; pendientes (todavía sin presentar) piden atención. */
export function resumenCot(habilitado: boolean | null, pendientes: number | null, error: number | null): { tono: Tono } {
  if ((error ?? 0) > 0) return { tono: 'error' }
  if (habilitado === false) return { tono: 'neutro' }
  if ((pendientes ?? 0) > 0) return { tono: 'atencion' }
  if (pendientes == null) return { tono: 'neutro' }
  return { tono: 'ok' }
}

