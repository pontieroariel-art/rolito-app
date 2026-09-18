import type { CambioCamion, Cobranza, DescargaCamion, Liquidacion, PlantaId, RemitoCarga, VentaCamion } from '@/types'
import { calcularLiquidacion } from './liquidacion'
import { toDateStr } from './helpers'

// Liquidaciones abiertas (2026-09-16, pedido de la oficina: "no tenemos un
// apartado donde figuren las liquidaciones abiertas: mercadería pendiente de
// devolución y plata pendiente a rendir"). Una liquidación está abierta cuando
// hay un remito de carga o cobranzas de calle de una persona en un día y NO
// existe `liquidaciones/{fecha}_{choferId}`. Los remitos nunca cambian a
// 'liquidado': lo que dice si el día está cerrado es ese documento.
// Acá vive lo puro: agrupar y resumir. Los datos los trae
// `services/liquidacionesAbiertasService.ts`.

export interface GrupoAbierto {
  /** `${fecha}_${choferId}`, igual que el id de la liquidación que falta. */
  clave:        string
  fecha:        string          // yyyy-MM-dd (día local)
  choferId:     string
  choferNombre: string
  plantaId:     PlantaId | null // null: solo cobranzas, sin remito
  remitos:      RemitoCarga[]
  /** Cobranzas de calle ya vistas al agrupar (para no volver a pedirlas). */
  cobranzas:    Cobranza[]
}

export type EstadoAbierta = 'en_calle' | 'volvio' | 'descargado' | 'solo_cobranzas'

export interface LiquidacionAbierta extends GrupoAbierto {
  diasAbierta:        number
  estado:             EstadoAbierta
  regresoHora:        Date | null
  cargaBultos:        number
  bultosVendidos:     number
  /** Lo que tendría que volver al depósito según carga − ventas − cambios. */
  devolucionTeorica:  number
  descargaContada:    number
  hayDescarga:        boolean
  /** Con descarga contada: bolsas que faltan. Sin descarga: todo lo que falta devolver. */
  bultosSinDevolver:  number
  bultosSobrantes:    number
  ventasCantidad:     number
  ventasTotal:        number
  cobranzasCantidad:  number
  cobranzasTotal:     number
  efectivoARendir:    number
}

const esCalle = (c: Cobranza) => c.origen !== 'caja'

/**
 * Agrupa remitos y cobranzas de calle por persona y día, y saca los días que ya
 * tienen liquidación cerrada. Ordena de la más vieja a la más nueva.
 */
export function gruposAbiertos(remitos: RemitoCarga[], cobranzas: Cobranza[], liquidaciones: Pick<Liquidacion, 'id'>[]): GrupoAbierto[] {
  const cerradas = new Set(liquidaciones.map((l) => l.id))
  const grupos = new Map<string, GrupoAbierto>()
  const grupo = (fecha: string, choferId: string, nombre: string): GrupoAbierto => {
    const clave = `${fecha}_${choferId}`
    let g = grupos.get(clave)
    if (!g) { g = { clave, fecha, choferId, choferNombre: nombre, plantaId: null, remitos: [], cobranzas: [] }; grupos.set(clave, g) }
    return g
  }
  for (const r of remitos) {
    const g = grupo(toDateStr(r.fecha.toDate()), r.choferId, r.choferNombre)
    g.remitos.push(r)
    g.plantaId ??= r.plantaId
  }
  for (const c of cobranzas) {
    if (!esCalle(c)) continue
    grupo(toDateStr(c.fecha.toDate()), c.registradoPor.uid, c.registradoPor.nombre).cobranzas.push(c)
  }
  return [...grupos.values()]
    .filter((g) => !cerradas.has(g.clave))
    .map((g) => ({ ...g, remitos: g.remitos.slice().sort((a, b) => a.numero - b.numero) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.choferNombre.localeCompare(b.choferNombre, 'es'))
}

/** Días entre la fecha del grupo y hoy (0 = hoy). */
export const diasAbierta = (fecha: string, hoy: string): number => {
  const a = new Date(fecha + 'T12:00:00'), b = new Date(hoy + 'T12:00:00')
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

/** Resume un grupo con los docs del día de esa persona (mismo cálculo que la liquidación). */
export function resumirAbierta(
  g: GrupoAbierto,
  docs: { ventas: VentaCamion[]; cambios: CambioCamion[]; descargas: DescargaCamion[]; cobranzas: Cobranza[] },
  hoy: string,
): LiquidacionAbierta {
  const calc = calcularLiquidacion(g.remitos, docs.ventas, docs.cambios, docs.descargas, docs.cobranzas)
  const hayDescarga = docs.descargas.length > 0
  const cargaBultos = calc.productos.reduce((s, p) => s + p.carga, 0)
  const bultosVendidos = calc.productos.reduce((s, p) => s + p.ventaContado + p.ventaPromo + p.cambios, 0)
  const devolucionTeorica = calc.productos.reduce((s, p) => s + Math.max(0, p.devolucionTeorica), 0)
  const descargaContada = calc.productos.reduce((s, p) => s + p.descarga, 0)
  const faltan = calc.productos.reduce((s, p) => s + Math.max(0, -p.diferencia), 0)
  const sobran = calc.productos.reduce((s, p) => s + Math.max(0, p.diferencia), 0)
  const regreso = g.remitos.map((r) => r.regreso?.hora.toDate() ?? null).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const estado: EstadoAbierta = !g.remitos.length ? 'solo_cobranzas' : hayDescarga ? 'descargado' : regreso ? 'volvio' : 'en_calle'
  return {
    ...g,
    diasAbierta: diasAbierta(g.fecha, hoy),
    estado,
    regresoHora: regreso,
    cargaBultos,
    bultosVendidos,
    devolucionTeorica,
    descargaContada,
    hayDescarga,
    bultosSinDevolver: hayDescarga ? faltan : devolucionTeorica,
    bultosSobrantes: hayDescarga ? sobran : 0,
    ventasCantidad: docs.ventas.length,
    ventasTotal: calc.importes.total,
    cobranzasCantidad: calc.cobranzasCalle?.cantidad ?? 0,
    cobranzasTotal: calc.cobranzasCalle?.total ?? 0,
    efectivoARendir: calc.efectivoARendir,
  }
}

export interface TotalesAbiertas {
  abiertas:          number
  diasAnteriores:    number
  bultosSinDevolver: number
  efectivoARendir:   number
}

export const totalesAbiertas = (filas: LiquidacionAbierta[]): TotalesAbiertas => ({
  abiertas:          filas.length,
  diasAnteriores:    filas.filter((f) => f.diasAbierta > 0).length,
  bultosSinDevolver: filas.reduce((s, f) => s + f.bultosSinDevolver, 0),
  efectivoARendir:   filas.reduce((s, f) => s + f.efectivoARendir, 0),
})
