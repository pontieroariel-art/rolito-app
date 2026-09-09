import type { ChequeRendido, EntregaTesoreria, Liquidacion, PlantaId, Rendicion, RetencionRendida } from '@/types'
import { sumaImportes } from './medios'
import { PLANTA_INFO } from './constants'
import { claveCheque, claveRetencion, esRecibido } from './valoresEnPapel'

// Entrega de caja a tesorería (2026-09-09): lo que la ventanilla junta en el
// día (efectivo y valores de las liquidaciones de repartidores que recibió y
// de sus propios cierres de caja) viaja a tesorería con acta y doble firma.
// Todo puro. OJO con el doble conteo: el cierre de caja de un cajero
// (`Rendicion.efectivoContado`) YA incluye el efectivo de las liquidaciones
// que ese cajero cerró (`recibido.efectivo`), así que una liquidación cubierta
// por un cierre (`rendicion.liquidacionesIds`) no vuelve a sumar.

/** "ET-DT-000045" desde el id `{fecha}_{planta}_{numero}` (sin releer el doc). */
export function codigoDeEntregaId(id: string): string {
  const [, planta, n] = id.split('_')
  const info = PLANTA_INFO[planta as PlantaId]
  return info ? `ET-${info.prefijoCodigo}-${String(Number(n)).padStart(6, '0')}` : id
}

export interface Monto { efectivo: number; cheques: { cantidad: number; total: number }; retenciones: { cantidad: number; total: number } }
export const MONTO_CERO: Monto = { efectivo: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } }

/** Liquidaciones y cierres de la planta que todavía no salieron en ninguna entrega (nacen con `entregaId: null`; los docs viejos sin el campo no cuentan). */
export function pendientesDeEntrega(liquidaciones: Liquidacion[], rendiciones: Rendicion[], plantaId: PlantaId): { liquidaciones: Liquidacion[]; rendiciones: Rendicion[] } {
  return {
    liquidaciones: liquidaciones.filter((l) => l.plantaId === plantaId && l.entregaId === null),
    rendiciones:   rendiciones.filter((r) => r.plantaId === plantaId && r.entregaId === null),
  }
}

export type EntregaArmada = Pick<EntregaTesoreria, 'liquidacionIds' | 'rendicionIds' | 'liquidaciones' | 'rendiciones' | 'efectivo' | 'cheques' | 'retenciones'>

const sinDecision = <T extends { recibido?: boolean; motivoNoEntregado?: string }>(v: T): T => {
  const { recibido: _r, motivoNoEntregado: _m, ...resto } = v
  return resto as T
}

/** Arma el contenido de la entrega deduplicando el efectivo de las liquidaciones ya incluidas en un cierre de caja. Solo viajan los valores que efectivamente llegaron a caja; tesorería los vuelve a tildar. */
export function armarEntrega(liquidaciones: Liquidacion[], rendiciones: Rendicion[]): EntregaArmada {
  const cubiertas = new Set(rendiciones.flatMap((r) => r.liquidacionesIds ?? []))
  const liqs = liquidaciones.map((l) => ({
    id: l.id, codigo: l.codigo ?? null, fecha: l.fecha, choferId: l.choferId, choferNombre: l.choferNombre,
    efectivoRecibido: l.efectivoRecibido, incluidaEnCierre: cubiertas.has(l.id),
  }))
  const rends = rendiciones.map((r) => ({ id: r.id, codigo: r.codigo, fecha: r.fecha, sujetoId: r.sujetoId, sujetoNombre: r.sujetoNombre, efectivoContado: r.efectivoContado }))
  const cierresCaja = rendiciones.reduce((s, r) => s + r.efectivoContado, 0)
  const liquidacionesSueltas = liqs.filter((l) => !l.incluidaEnCierre).reduce((s, l) => s + l.efectivoRecibido, 0)

  const cheques = new Map<string, ChequeRendido>()
  const retenciones = new Map<string, RetencionRendida>()
  for (const fuente of [...rendiciones, ...liquidaciones]) {
    for (const ch of fuente.cheques ?? []) if (esRecibido(ch)) cheques.set(claveCheque(ch), sinDecision(ch))
    for (const re of fuente.retenciones ?? []) if (esRecibido(re)) retenciones.set(claveRetencion(re), sinDecision(re))
  }
  return {
    liquidacionIds: liqs.map((l) => l.id), rendicionIds: rends.map((r) => r.id),
    liquidaciones: liqs, rendiciones: rends,
    efectivo: { cierresCaja, liquidacionesSueltas, teorico: cierresCaja + liquidacionesSueltas },
    cheques: [...cheques.values()], retenciones: [...retenciones.values()],
  }
}

const montoDe = (efectivo: number, cheques: { importe: number }[], retenciones: { importe: number }[]): Monto => ({
  efectivo, cheques: { cantidad: cheques.length, total: sumaImportes(cheques) }, retenciones: { cantidad: retenciones.length, total: sumaImportes(retenciones) },
})
const sumarMontos = (xs: Monto[]): Monto => xs.reduce((a, b) => ({
  efectivo: a.efectivo + b.efectivo,
  cheques: { cantidad: a.cheques.cantidad + b.cheques.cantidad, total: a.cheques.total + b.cheques.total },
  retenciones: { cantidad: a.retenciones.cantidad + b.retenciones.cantidad, total: a.retenciones.total + b.retenciones.total },
}), MONTO_CERO)

export interface EsperadoTesoreria {
  esperado:   Monto   // todo lo que cerró caja (liquidaciones + cierres), deduplicado
  pendiente:  Monto   // lo que todavía no salió en ninguna entrega
  entregado:  Monto   // entregas firmadas por caja que tesorería aún no confirmó
  confirmado: Monto   // entregas confirmadas por tesorería (efectivo contado, valores recibidos)
}

/** Lo que tesorería tiene que recibir de una planta (o de todas, sin planta) en el período, y en qué estado está. */
export function esperadoTesoreria(liquidaciones: Liquidacion[], rendiciones: Rendicion[], entregas: EntregaTesoreria[], plantaId?: PlantaId): EsperadoTesoreria {
  const liqs = liquidaciones.filter((l) => l.entregaId !== undefined && (!plantaId || l.plantaId === plantaId))
  const rends = rendiciones.filter((r) => r.entregaId !== undefined && (!plantaId || r.plantaId === plantaId))
  const ents = entregas.filter((e) => !plantaId || e.plantaId === plantaId)
  const todo = armarEntrega(liqs, rends)
  const pend = armarEntrega(liqs.filter((l) => l.entregaId === null), rends.filter((r) => r.entregaId === null))
  return {
    esperado:   montoDe(todo.efectivo.teorico, todo.cheques, todo.retenciones),
    pendiente:  montoDe(pend.efectivo.teorico, pend.cheques, pend.retenciones),
    entregado:  sumarMontos(ents.filter((e) => e.estado === 'entregada').map((e) => montoDe(e.efectivoEntregado, e.cheques, e.retenciones))),
    confirmado: sumarMontos(ents.filter((e) => e.estado === 'confirmada').map((e) => montoDe(e.efectivoContado ?? 0, e.cheques.filter(esRecibido), e.retenciones.filter(esRecibido)))),
  }
}
