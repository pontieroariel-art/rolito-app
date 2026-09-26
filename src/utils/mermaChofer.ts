import type { DescargaCamion, EntregaFabrica, RemitoCarga, VentaCamion } from '@/types'
import { mercaderiaDelViaje } from '@/utils/liquidacion'
import { explicarProducto } from '@/utils/rotasCambios'

// Merma y faltantes por chofer (2026-09-26, pedido de Ariel: "son bolsas, es
// dinero al fin y al cabo"). Reporte de GESTIÓN: lo ven super_admin, logística
// y gerencia, nunca los medidos (chofer, muelle, caja).
//
// Por viaje, con la MISMA cuenta que la liquidación y Tango (mercaderiaDelViaje):
//   · rotas en el camión = rotas que contó el muelle − cambios que registró el
//     chofer (las de los cambios las rompió el cliente, no cuentan). No se le
//     cobran al chofer: van a merma (99), pero se miden.
//   · faltantes = lo que no volvió ni sano ni roto → diferencia del chofer (98).
// Solo cuentan los viajes con la descarga contada: sin conteo no hay nada que
// medir todavía. La plata se valúa a precio de lista (la 301, la del COT), para
// que sea pareja entre choferes.

export interface ViajeParaMerma {
  remito:    RemitoCarga
  ventas:    VentaCamion[]
  descargas: DescargaCamion[]
  entregasFabrica: Pick<EntregaFabrica, 'productos'>[]
}

export interface ProductoMerma {
  productoId: string
  nombre:     string
  carga:      number
  rotasCamion: number
  faltan:     number
  importeRotas:  number
  importeFaltan: number
  explicacion: string[]
}

export interface ViajeMerma {
  remitoId:  string
  codigo:    string
  fecha:     Date
  choferId:  string
  choferNombre: string
  contado:   boolean
  cargadas:  number
  rotasCamion: number
  faltan:    number
  importeRotas:  number
  importeFaltan: number
  productos: ProductoMerma[]
}

export interface ChoferMerma {
  choferId:  string
  choferNombre: string
  viajes:    number
  viajesSinContar: number
  cargadas:  number
  rotasCamion: number
  faltan:    number
  importeRotas:  number
  importeFaltan: number
  importeTotal:  number
  /** Rotas en el camión sobre lo cargado, en %. */
  pctRotas:  number
  detalle:   ViajeMerma[]
}

export interface ResumenMerma {
  choferes:  ChoferMerma[]
  total: Omit<ChoferMerma, 'choferId' | 'choferNombre' | 'detalle'>
  /** Productos sin precio en la lista: su plata no se suma (se avisa en pantalla). */
  sinPrecio: string[]
}

const redondear = (n: number) => Math.round(n)

export function analizarViaje(v: ViajeParaMerma, precios: Record<string, number> | null | undefined, sinPrecio: Set<string>): ViajeMerma {
  const contado = v.descargas.length > 0
  const m = mercaderiaDelViaje([v.remito], v.ventas, [], v.descargas, v.entregasFabrica)
  const productos: ProductoMerma[] = m.productos.map((p) => {
    const rotasCamion = contado ? Math.max(0, (p.rotas ?? 0) - p.cambios) : 0
    const faltan = contado ? Math.max(0, -p.diferencia) : 0
    const precio = precios?.[p.productoId]
    if ((rotasCamion || faltan) && !(typeof precio === 'number' && precio > 0)) sinPrecio.add(p.nombre)
    const pu = typeof precio === 'number' && precio > 0 ? precio : 0
    return {
      productoId: p.productoId, nombre: p.nombre, carga: p.carga, rotasCamion, faltan,
      importeRotas: redondear(rotasCamion * pu), importeFaltan: redondear(faltan * pu),
      explicacion: contado ? explicarProducto(p) : [],
    }
  })
  const suma = (k: 'carga' | 'rotasCamion' | 'faltan' | 'importeRotas' | 'importeFaltan') => productos.reduce((s, p) => s + p[k], 0)
  return {
    remitoId: v.remito.id, codigo: v.remito.codigo, fecha: v.remito.fecha.toDate(),
    choferId: v.remito.choferId, choferNombre: v.remito.choferNombre, contado,
    cargadas: suma('carga'), rotasCamion: suma('rotasCamion'), faltan: suma('faltan'),
    importeRotas: suma('importeRotas'), importeFaltan: suma('importeFaltan'),
    productos: productos.filter((p) => p.carga || p.rotasCamion || p.faltan),
  }
}

export function resumirMerma(viajes: ViajeParaMerma[], precios: Record<string, number> | null | undefined): ResumenMerma {
  const sinPrecio = new Set<string>()
  const porChofer = new Map<string, ChoferMerma>()
  for (const v of viajes) {
    const a = analizarViaje(v, precios, sinPrecio)
    const clave = a.choferId || a.choferNombre
    let c = porChofer.get(clave)
    if (!c) {
      c = { choferId: a.choferId, choferNombre: a.choferNombre, viajes: 0, viajesSinContar: 0, cargadas: 0, rotasCamion: 0, faltan: 0, importeRotas: 0, importeFaltan: 0, importeTotal: 0, pctRotas: 0, detalle: [] }
      porChofer.set(clave, c)
    }
    c.detalle.push(a)
    if (!a.contado) { c.viajesSinContar++; continue }
    c.viajes++
    c.cargadas += a.cargadas; c.rotasCamion += a.rotasCamion; c.faltan += a.faltan
    c.importeRotas += a.importeRotas; c.importeFaltan += a.importeFaltan
  }
  const choferes = [...porChofer.values()].map((c) => ({
    ...c,
    importeTotal: c.importeRotas + c.importeFaltan,
    pctRotas: c.cargadas > 0 ? (c.rotasCamion / c.cargadas) * 100 : 0,
    detalle: c.detalle.sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
  })).sort((a, b) => b.importeTotal - a.importeTotal || b.rotasCamion + b.faltan - (a.rotasCamion + a.faltan) || a.choferNombre.localeCompare(b.choferNombre))
  const t = choferes.reduce((s, c) => ({
    viajes: s.viajes + c.viajes, viajesSinContar: s.viajesSinContar + c.viajesSinContar, cargadas: s.cargadas + c.cargadas,
    rotasCamion: s.rotasCamion + c.rotasCamion, faltan: s.faltan + c.faltan, importeRotas: s.importeRotas + c.importeRotas,
    importeFaltan: s.importeFaltan + c.importeFaltan, importeTotal: s.importeTotal + c.importeTotal, pctRotas: 0,
  }), { viajes: 0, viajesSinContar: 0, cargadas: 0, rotasCamion: 0, faltan: 0, importeRotas: 0, importeFaltan: 0, importeTotal: 0, pctRotas: 0 })
  t.pctRotas = t.cargadas > 0 ? (t.rotasCamion / t.cargadas) * 100 : 0
  return { choferes, total: t, sinPrecio: [...sinPrecio].sort() }
}
