import type { CambioCamion, CierreMercaderia, Cobranza, DescargaCamion, Liquidacion, PlantaId, RemitoCarga, VentaCamion } from '@/types'
import { calcularLiquidacion } from './liquidacion'
import { viajeDeVenta } from './viajeDeVenta'
import { toDateStr } from './helpers'

// Liquidaciones abiertas (2026-09-16, pedido de la oficina: "no tenemos un
// apartado donde figuren las liquidaciones abiertas: mercadería pendiente de
// devolución y plata pendiente a rendir"). Una liquidación está abierta cuando
// hay un remito de carga o cobranzas de calle de una persona en un día y NO
// existe su liquidación. Desde el 2026-09-18 se agrupa por VIAJE y el cierre son
// DOS documentos independientes: la plata que liquida caja y la mercadería que
// escribe el servidor al contarse la descarga. Un viaje puede tener una sola
// pendiente: el que volvió de noche tiene la mercadería contada y la plata sin
// liquidar, y el que quedó varado, al revés. Los remitos nunca cambian a
// 'liquidado': lo que dice si el viaje está cerrado son esos dos docs.
// Acá vive lo puro: agrupar y resumir. Los datos los trae
// `services/liquidacionesAbiertasService.ts`.

export interface GrupoAbierto {
  /**
   * El id del doc que falta: `{remitoId}` cuando es un viaje, o
   * `${fecha}_${choferId}` para los cobradores y supervisores, que no tienen
   * camión y siguen rindiendo por día.
   */
  clave:        string
  /** El viaje, cuando lo hay. Un chofer puede hacer dos en un día. */
  remitoId?:    string
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
  /**
   * Las dos mitades, por separado (2026-09-18). Un viaje puede tener una sola
   * pendiente: el camión que volvió de noche tiene la mercadería contada y la
   * plata sin liquidar, y el que quedó varado, al revés.
   */
  plataPendiente:      boolean
  mercaderiaPendiente: boolean
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
export function gruposAbiertos(
  remitos: RemitoCarga[],
  cobranzas: Cobranza[],
  liquidaciones: Pick<Liquidacion, 'id'>[],
  /** Los cierres de mercadería que ya existen (2026-09-18): sin esto, un viaje contado seguiría figurando como si nadie hubiera tocado nada. */
  cierres: Pick<CierreMercaderia, 'remitoId'>[] = [],
): GrupoAbierto[] {
  const conPlata = new Set(liquidaciones.map((l) => l.id))
  const conMercaderia = new Set(cierres.map((c) => c.remitoId))
  const grupos = new Map<string, GrupoAbierto>()

  // Un grupo por VIAJE: un chofer con dos salidas en el día tiene dos
  // rendiciones, y una puede estar cerrada y la otra no.
  for (const r of remitos) {
    grupos.set(r.id, {
      clave: r.id,
      remitoId: r.id,
      fecha: toDateStr(r.fecha.toDate()),
      choferId: r.choferId,
      choferNombre: r.choferNombre,
      plantaId: r.plantaId,
      remitos: [r],
      cobranzas: [],
    })
  }

  // Las cobranzas de calle van al viaje en el que se hicieron. Las que no tienen
  // viaje (supervisores, cobradores sin camión) arman su grupo por día.
  const viajesPorChofer = new Map<string, GrupoAbierto[]>()
  for (const g of grupos.values()) {
    const lista = viajesPorChofer.get(g.choferId)
    if (lista) lista.push(g); else viajesPorChofer.set(g.choferId, [g])
  }
  for (const c of cobranzas) {
    if (!esCalle(c)) continue
    const uid = c.registradoPor.uid
    const candidatos = viajesPorChofer.get(uid) ?? []
    const id = viajeDeVenta({ remitoId: c.remitoId, camionId: undefined, choferId: uid, fecha: c.fecha }, candidatos.map((g) => g.remitos[0]))
    const delViaje = id ? grupos.get(id) : null
    if (delViaje) { delViaje.cobranzas.push(c); continue }
    const fecha = toDateStr(c.fecha.toDate())
    const clave = `${fecha}_${uid}`
    let g = grupos.get(clave)
    if (!g) { g = { clave, fecha, choferId: uid, choferNombre: c.registradoPor.nombre, plantaId: null, remitos: [], cobranzas: [] }; grupos.set(clave, g) }
    g.cobranzas.push(c)
  }

  // Abierto = le falta alguna de las dos mitades. Un grupo sin viaje (cobrador)
  // no tiene mercadería que cerrar: alcanza con su plata.
  return [...grupos.values()]
    .filter((g) => {
      const faltaPlata = !conPlata.has(g.clave)
      const faltaMercaderia = !!g.remitoId && !conMercaderia.has(g.remitoId)
      return faltaPlata || faltaMercaderia
    })
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
  /** Qué mitades ya están cerradas (2026-09-18). Por defecto, ninguna. */
  cerradas: { plata?: boolean; mercaderia?: boolean } = {},
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
    plataPendiente: !cerradas.plata,
    // Un grupo sin viaje (cobrador, supervisor) no tiene mercadería que cerrar.
    mercaderiaPendiente: !!g.remitoId && !cerradas.mercaderia,
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
