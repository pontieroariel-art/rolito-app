import { describe, it, expect } from 'vitest'
import { resolverClienteOcasional } from './writers'
import type { PayloadVenta } from './pedido'

// Venta de ventanilla a consumidor final sin ficha (2026-09-17): la primera
// factura B real (01104-00000001) quedó en la cola con "no trae
// clienteIdGva14Tango" porque el Facturador exige un cliente. Va sobre la
// cuenta genérica de la empresa.

const base: PayloadVenta = { clienteNombre: '.', clienteOcasional: { nombre: '.' }, total: 8470, formaPago: 'contado_efectivo', plantaId: 'torcuato' }
const item = { entidad: 'factura', empresa: 'redonhielo', origenColeccion: 'ventasVentanilla', origenId: 'v1', payload: base } as never
const log = () => {}

function tangoFalso(filas: Record<string, unknown>[], opciones: { filtroRebota?: boolean; padron?: Record<string, unknown>[] } = {}) {
  const llamadas: string[] = []
  const cache = new Map<string, unknown>()
  // Misma semántica que TangoClient.resolverId: caché por clave; con
  // filtroRebota simula el "multi-part identifier could not be bound".
  const resolverId = async (_c: unknown, clave: string, _p: unknown, f: string, campo: string) => {
    if (cache.has(clave)) return cache.get(clave)
    llamadas.push(f)
    if (opciones.filtroRebota) throw new Error('Tango succeeded=false en GetByFilter')
    const id = filas[0]?.[campo] ?? null
    if (id !== null) cache.set(clave, id)
    return id
  }
  const getAll = async () => { llamadas.push('getAll'); return opciones.padron ?? [] }
  return { llamadas, cliente: { resolverId, getAll } as never }
}

describe('resolverClienteOcasional', () => {
  it('con ficha (idGva14) no toca nada', async () => {
    const t = tangoFalso([])
    const r = await resolverClienteOcasional({ ...base, clienteIdGva14Tango: 500, clienteOcasional: null }, { tango: t.cliente, cfg: {}, company: 1, item, log })
    expect(r).toEqual({ payload: { ...base, clienteIdGva14Tango: 500, clienteOcasional: null } })
    expect(t.llamadas).toEqual([])
  })

  it('sin config dice exactamente qué falta', async () => {
    const r = await resolverClienteOcasional(base, { tango: tangoFalso([]).cliente, cfg: { facturador: { redonhielo: {} } }, company: 1, item, log })
    expect('error' in r && r.error).toMatch(/clienteConsumidorFinal\.codigo/)
  })

  it('resuelve el ID_GVA14 por el código una sola vez y completa el payload', async () => {
    const t = tangoFalso([{ ID_GVA14: 7, COD_CLIENT: 'CF.001' }])
    const ctx = { tango: t.cliente, cfg: { facturador: { redonhielo: { clienteConsumidorFinal: { codigo: 'CF.001' } } } }, company: 1, item, log }
    const r1 = await resolverClienteOcasional(base, ctx)
    expect('payload' in r1 && r1.payload).toMatchObject({ clienteIdGva14Tango: 7, clienteCodigoTango: 'CF.001', clienteNombre: 'CONSUMIDOR FINAL' })
    const r2 = await resolverClienteOcasional({ ...base, clienteNombre: 'Juan Pérez' }, ctx)
    expect('payload' in r2 && r2.payload.clienteNombre).toBe('Juan Pérez')
    expect(t.llamadas).toEqual(["WHERE COD_GVA14 = 'CF.001'"])   // la segunda sale de la caché
  })

  it('si el filtro rebota, recorre el padrón, encuentra el código y guarda el id en config', async () => {
    const t = tangoFalso([], { filtroRebota: true, padron: [{ COD_GVA14: 'PA.003', ID_GVA14: 1 }, { COD_GVA14: 'CF.000', ID_GVA14: 200 }] })
    const guardados: [string, number][] = []
    const ctx = { tango: t.cliente, cfg: { facturador: { redonhielo: { clienteConsumidorFinal: { codigo: 'CF.000' } } } }, company: 1, item, log, guardarIdConsumidorFinal: async (e: string, id: number) => { guardados.push([e, id]) } }
    const r = await resolverClienteOcasional(base, ctx)
    expect('payload' in r && r.payload.clienteIdGva14Tango).toBe(200)
    expect(t.llamadas).toEqual(["WHERE COD_GVA14 = 'CF.000'", 'getAll'])
    expect(guardados).toEqual([['redonhielo', 200]])
  })

  it('con idGva14 en la config no consulta la API; si el código no existe en Tango, error claro', async () => {
    const t = tangoFalso([])
    const ok = await resolverClienteOcasional(base, { tango: t.cliente, cfg: { facturador: { redonhielo: { clienteConsumidorFinal: { codigo: 'CF.001', idGva14: 9 } } } }, company: 1, item, log })
    expect('payload' in ok && ok.payload.clienteIdGva14Tango).toBe(9)
    expect(t.llamadas).toEqual([])
    const malo = await resolverClienteOcasional(base, { tango: t.cliente, cfg: { facturador: { redonhielo: { clienteConsumidorFinal: { codigo: 'NOEXISTE' } } } }, company: 1, item, log })
    expect('error' in malo && malo.error).toMatch(/no existe en Tango/)
  })
})
