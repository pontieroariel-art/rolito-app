// Sincronización de PRECIOS y LISTAS desde Tango → app (Tango es la fuente
// maestra, decisión de Ariel 2026-09-03). Ver docs/tango/INTEGRACION.md §17.
//
// De dónde sale cada cosa (API de ABM vía Tango Connect):
//   - Listas de precios: process 984 (GVA10) → nro, nombre, incluye IVA.
//   - Precio de cada artículo en cada lista: la ficha del artículo (process 87,
//     GetById) trae `GVA17[]` = { NRO_DE_LIS, PRECIO } y, anidado, `GVA13[]` =
//     precios ESPECIALES por cliente { COD_CLIENT, NRO_LISTA, PRECIO }.
//   - Lista asignada a cada cliente: ficha del cliente (process 2117, Get
//     paginado) → GVA10_NRO_DE_LIS.
//
// Resultado en Firestore:
//   preciosTango/{empresa} = { actualizadoEn, company, productos, listas:
//     { [nroLista]: { nombre, incluyeIva, precios: { [productoId]: precio } } },
//     especiales: { [claveCliente]: { [productoId]: precio } } }
//   users/{uid}.listaTango = { redonhielo: nro, rolito: nro }
//
// Solo los productos del catálogo de la app (config/tango.articulos, sin los
// `cambio_*`): son ~11 artículos por empresa, así que la corrida entera son
// unas 30 consultas. La empresa de cada canal: contado → redonhielo, promo →
// rolito.

import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { TangoClient, PROCESOS, FILTROS } from './client'
import { prop } from './pedido'
import type { ConfigTango } from './writers'

export const EMPRESAS = ['redonhielo', 'rolito'] as const
export type Empresa = (typeof EMPRESAS)[number]

/** Firestore no admite '.' en nombres de campo: 'FC.280' → 'FC_280'. */
export const claveCliente = (codigoTango: string) => String(codigoTango).replace(/\./g, '_')

export interface ListaTango {
  nombre: string
  incluyeIva: boolean
  precios: Record<string, number>
}

export interface PreciosTangoDoc {
  company: number
  productos: Record<string, string>
  listas: Record<string, ListaTango>
  especiales: Record<string, Record<string, number>>
  resumen: { listas: number; productos: number; especiales: number; errores: string[] }
}

const PAGE = 500

async function todasLasFilas(tango: TangoClient, company: number, proceso: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let i = 0, pages = 1
  do {
    const data = await tango.request(company, 'GET', 'Get', { process: proceso, pageSize: PAGE, pageIndex: i, view: '' })
    out.push(...TangoClient.filas(data))
    const rd = prop(data, 'resultData') as Record<string, unknown> | undefined
    pages = Number(prop(rd, 'totalPages') ?? 1)
    i++
  } while (i < pages)
  return out
}

/** Precios de una empresa: listas + precio por producto en cada lista + especiales por cliente. */
export async function leerPreciosEmpresa(tango: TangoClient, company: number, articulos: Record<string, string>): Promise<PreciosTangoDoc> {
  const errores: string[] = []
  const listas: Record<string, ListaTango> = {}
  for (const l of await todasLasFilas(tango, company, PROCESOS.listas)) {
    const nro = String(prop(l, 'NRO_DE_LIS') ?? '')
    if (!nro) continue
    listas[nro] = { nombre: String(prop(l, 'NOMBRE_LIS') ?? '').trim(), incluyeIva: prop(l, 'INCLUY_IVA') === true, precios: {} }
  }

  const especiales: Record<string, Record<string, number>> = {}
  const productos: Record<string, string> = {}
  for (const [productoId, cod] of Object.entries(articulos)) {
    if (productoId.startsWith('cambio_')) continue
    productos[productoId] = cod
    try {
      const id = await tango.resolverId(company, `articulo:${cod}`, PROCESOS.articulos, FILTROS.articulo(cod), 'ID_STA11')
      if (id == null) { errores.push(`${productoId}: artículo ${cod} no existe en la empresa ${company}`); continue }
      const ficha = await tango.getById(company, PROCESOS.articulos, id)
      const gva17 = (prop(ficha, 'GVA17') ?? []) as Record<string, unknown>[]
      for (const p of gva17) {
        const nro = String(prop(p, 'NRO_DE_LIS') ?? '')
        const precio = Number(prop(p, 'PRECIO'))
        if (!nro || !Number.isFinite(precio)) continue
        listas[nro] ??= { nombre: `Lista ${nro}`, incluyeIva: false, precios: {} }
        listas[nro].precios[productoId] = precio
        for (const e of (prop(p, 'GVA13') ?? []) as Record<string, unknown>[]) {
          const cod = String(prop(e, 'COD_CLIENT') ?? '').trim()
          const pe = Number(prop(e, 'PRECIO'))
          if (!cod || !Number.isFinite(pe)) continue
          ;(especiales[claveCliente(cod)] ??= {})[productoId] = pe
        }
      }
    } catch (e) {
      errores.push(`${productoId}: ${(e as Error).message}`)
    }
  }
  return {
    company, productos, listas, especiales,
    resumen: { listas: Object.keys(listas).length, productos: Object.keys(productos).length, especiales: Object.keys(especiales).length, errores },
  }
}

/** Lista asignada a cada cliente (COD_GVA14 → NRO_LISTA) en una empresa. */
export async function leerListasDeClientes(tango: TangoClient, company: number): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const c of await todasLasFilas(tango, company, PROCESOS.clientes)) {
    const cod = String(prop(c, 'COD_GVA14') ?? '').trim()
    const nro = Number(prop(c, 'GVA10_NRO_DE_LIS') ?? prop(c, 'NRO_LISTA'))
    if (cod && Number.isFinite(nro) && nro > 0) out.set(cod, nro)
  }
  return out
}

export interface ResumenSync {
  empresas: Record<string, PreciosTangoDoc['resumen'] & { clientesConLista: number }>
  usuariosActualizados: number
}

/**
 * Corrida completa: precios de las dos empresas + lista de cada cliente.
 * Escribe preciosTango/{empresa} y users/{uid}.listaTango.
 */
export async function sincronizarPreciosTango(db: Firestore, tango: TangoClient, cfg: ConfigTango): Promise<ResumenSync> {
  const articulos = cfg.articulos ?? {}
  const resumen: ResumenSync = { empresas: {}, usuariosActualizados: 0 }
  const listasPorCliente: Record<string, Map<string, number>> = {}
  const docsPorEmpresa: Record<string, PreciosTangoDoc> = {}

  for (const empresa of EMPRESAS) {
    const company = cfg.companies?.[empresa]
    if (!Number.isInteger(company)) { resumen.empresas[empresa] = { listas: 0, productos: 0, especiales: 0, errores: [`config/tango.companies.${empresa} no está configurado`], clientesConLista: 0 }; continue }
    const doc = await leerPreciosEmpresa(tango, company as number, articulos)
    docsPorEmpresa[empresa] = doc
    await db.doc(`preciosTango/${empresa}`).set({ ...doc, actualizadoEn: FieldValue.serverTimestamp() })
    listasPorCliente[empresa] = await leerListasDeClientes(tango, company as number)
    resumen.empresas[empresa] = { ...doc.resumen, clientesConLista: listasPorCliente[empresa].size }
  }

  // Para cada cliente vinculado (codigoTango) se guarda en su ficha:
  //   listaTango       = { redonhielo: nro, rolito: nro }
  //   listaTangoNombre = { redonhielo: 'HABITUALES', ... }
  //   preciosTango     = { redonhielo: { productoId: precio }, rolito: {...} }
  // Los precios ya vienen resueltos (especial del cliente > su lista; 0 = sin
  // precio, no se guarda) para que el propio cliente los vea en su perfil y en
  // el pedido sin tener acceso a preciosTango/*, que trae los precios de todos.
  const clientes = await db.collection('users').where('rol', '==', 'cliente').get()
  let batch = db.batch(), ops = 0
  for (const d of clientes.docs) {
    const cod = String(d.data().codigoTango ?? '').trim()
    if (!cod) continue
    const listaTango: Record<string, number> = {}
    const listaTangoNombre: Record<string, string> = {}
    const preciosTango: Record<string, Record<string, number>> = {}
    for (const empresa of EMPRESAS) {
      const n = listasPorCliente[empresa]?.get(cod)
      if (n === undefined) continue
      listaTango[empresa] = n
      const doc = docsPorEmpresa[empresa]
      const lista = doc?.listas[String(n)]
      if (lista) listaTangoNombre[empresa] = lista.nombre
      preciosTango[empresa] = resolverPreciosCliente(doc, cod, n)
    }
    if (!Object.keys(listaTango).length) continue
    const data = d.data()
    const nuevo = { listaTango, listaTangoNombre, preciosTango }
    const actual = { listaTango: data.listaTango, listaTangoNombre: data.listaTangoNombre, preciosTango: data.preciosTango }
    if (JSON.stringify(actual) === JSON.stringify(nuevo)) continue
    batch.update(d.ref, nuevo)
    resumen.usuariosActualizados++
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  if (ops) await batch.commit()
  return resumen
}

/** Precio final de cada producto para un cliente: especial > lista; sin 0. */
export function resolverPreciosCliente(doc: PreciosTangoDoc | undefined, codigoCliente: string, nroLista: number): Record<string, number> {
  const out: Record<string, number> = {}
  if (!doc) return out
  const especiales = doc.especiales[claveCliente(codigoCliente)] ?? {}
  const lista = doc.listas[String(nroLista)]?.precios ?? {}
  for (const productoId of Object.keys(doc.productos)) {
    const valido = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
    const precio = valido(especiales[productoId]) ? especiales[productoId] : lista[productoId]
    if (valido(precio)) out[productoId] = precio
  }
  return out
}
