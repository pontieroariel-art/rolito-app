import { CambioCamion, Cobranza, DescargaCamion, RemitoCarga, VentaCamion } from '../types'
import { calcularLiquidacion, LiquidacionCalculada } from './liquidacion'
import { ventasVigentes } from './anulacionVenta'

// "Reparto en vivo" del supervisor: la liquidación del repartidor calculada al
// momento, camión por camión, con las mismas fuentes y la misma cuenta que usa
// caja al cerrar el día (utils/liquidacion.ts): carga − ventas − cambios = lo
// que le falta bajar. Puro: recibe las colecciones del día y agrupa por chofer.

export type EstadoCamion = 'cargando' | 'en_calle' | 'volvio'

export interface CamionEnVivo {
  choferId:     string
  choferNombre: string
  camionLabel:  string
  plantaId?:    string
  estado:       EstadoCamion
  /** Hora de salida por seguridad (o de entrega por muelle si todavía no salió). */
  salida:       Date | null
  /** Hora de la descarga contada por muelle, si ya volvió. */
  vuelta:       Date | null
  liquidacion:  LiquidacionCalculada
  /** Unidades cargadas y bajadas (ventas + cambios), sumando todos los productos. */
  cargado:      number
  bajado:       number
  /** Cantidad de ventas y de clientes distintos de hoy. */
  ventas:       number
  clientes:     number
  ultimaVenta:  Date | null
  /** Efectivo que lleva encima: ventas contado en efectivo + cobranzas de calle en efectivo. */
  efectivo:     number
  detalle: {
    ventas:    VentaCamion[]
    cambios:   CambioCamion[]
    cobranzas: Cobranza[]
    remitos:   RemitoCarga[]
    descargas: DescargaCamion[]
  }
}

export function agruparRepartoEnVivo(
  remitos:   RemitoCarga[],
  ventas:    VentaCamion[],
  cambios:   CambioCamion[],
  descargas: DescargaCamion[],
  cobranzasCalle: Cobranza[],
): CamionEnVivo[] {
  // Facturas anuladas con nota de crédito: fuera del reparto en vivo (2026-09-11).
  ventas = ventasVigentes(ventas)
  const choferes = new Map<string, { nombre: string }>()
  const nombrar = (id: string, nombre: string) => { if (id && !choferes.has(id)) choferes.set(id, { nombre }) }
  remitos.forEach((r) => nombrar(r.choferId, r.choferNombre))
  ventas.forEach((v) => nombrar(v.choferId, v.choferNombre))
  cambios.forEach((c) => nombrar(c.choferId, c.choferNombre))
  descargas.forEach((d) => nombrar(d.choferId, d.choferNombre))
  cobranzasCalle.forEach((c) => nombrar(c.registradoPor.uid, c.registradoPor.nombre))

  const out: CamionEnVivo[] = []
  for (const [choferId, { nombre }] of choferes) {
    const rs = remitos.filter((r) => r.choferId === choferId)
    const vs = ventas.filter((v) => v.choferId === choferId).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
    const cs = cambios.filter((c) => c.choferId === choferId)
    const ds = descargas.filter((d) => d.choferId === choferId)
    const cb = cobranzasCalle.filter((c) => c.registradoPor.uid === choferId)
    const liq = calcularLiquidacion(rs, vs, cs, ds, cb)

    const salidas = rs.map((r) => r.salida?.hora ?? r.entregadoPor?.hora).filter((h): h is NonNullable<typeof h> => !!h).map((h) => h.toDate())
    const salida = salidas.length ? new Date(Math.min(...salidas.map((d) => d.getTime()))) : null
    const vueltas = ds.map((d) => d.fecha.toDate())
    const vuelta = vueltas.length ? new Date(Math.max(...vueltas.map((d) => d.getTime()))) : null
    const estado: EstadoCamion = vuelta ? 'volvio' : (salida || vs.length ? 'en_calle' : 'cargando')

    const cargado = liq.productos.reduce((s, p) => s + p.carga, 0)
    const bajado = liq.productos.reduce((s, p) => s + p.ventaContado + p.ventaPromo + p.cambios, 0)
    const camionLabel = rs[0]?.camionLabel ?? ds[0]?.camionLabel ?? (vs[0]?.camionId ? vs[0].camionId : '')

    out.push({
      choferId, choferNombre: nombre, camionLabel, plantaId: rs[0]?.plantaId ?? ds[0]?.plantaId,
      estado, salida, vuelta, liquidacion: liq,
      cargado, bajado,
      ventas: vs.length,
      clientes: new Set(vs.map((v) => v.clienteId)).size,
      ultimaVenta: vs[0]?.fecha.toDate() ?? null,
      efectivo: liq.efectivoARendir,
      detalle: { ventas: vs, cambios: cs, cobranzas: cb, remitos: rs, descargas: ds },
    })
  }
  // En la calle primero (por última venta más reciente), después los que están cargando, al final los que volvieron.
  const orden: Record<EstadoCamion, number> = { en_calle: 0, cargando: 1, volvio: 2 }
  return out.sort((a, b) => orden[a.estado] - orden[b.estado] || (b.ultimaVenta?.getTime() ?? 0) - (a.ultimaVenta?.getTime() ?? 0) || a.choferNombre.localeCompare(b.choferNombre))
}
