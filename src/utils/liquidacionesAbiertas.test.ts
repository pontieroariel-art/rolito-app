import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { Cobranza, DescargaCamion, RemitoCarga, VentaCamion } from '@/types'
import { diasAbierta, gruposAbiertos, resumirAbierta, totalesAbiertas } from './liquidacionesAbiertas'

const ts = (iso: string) => Timestamp.fromDate(new Date(iso))

const remito = (o: Partial<Omit<RemitoCarga, 'fecha'>> & { fecha: string; choferId: string }): RemitoCarga => ({
  id: `r-${o.choferId}-${o.fecha}`, numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionLabel: 'AB 123 CD', choferNombre: o.choferId.toUpperCase(),
  items: [{ productoId: 'p1', nombre: 'Hielo bolsa 2kg', cantidad: 100, pallets: 1 }], palletsCarga: 1, estado: 'salido', creadoPor: { uid: 'caja', nombre: 'Caja' },
  ...o, fecha: ts(o.fecha),
} as unknown as RemitoCarga)

const cobranza = (o: { fecha: string; uid: string; origen: Cobranza['origen']; importe: number }): Cobranza => ({
  id: `c-${o.uid}-${o.fecha}-${o.importe}`, origen: o.origen, registradoPor: { uid: o.uid, nombre: o.uid.toUpperCase() }, clienteId: 'cli', clienteNombre: 'CLIENTE',
  importe: o.importe, formaPago: 'contado_efectivo', fecha: ts(o.fecha),
} as unknown as Cobranza)

describe('gruposAbiertos', () => {
  it('agrupa por VIAJE: dos salidas del mismo chofer en un día son dos rendiciones', () => {
    const remitos = [
      remito({ fecha: '2026-09-15T10:00:00', choferId: 'ana' }),
      remito({ fecha: '2026-09-15T14:00:00', choferId: 'ana', numero: 2 }),
      remito({ fecha: '2026-09-14T09:00:00', choferId: 'beto' }),
      remito({ fecha: '2026-09-13T09:00:00', choferId: 'carla' }),
    ]
    // El viaje de carla ya tiene las dos mitades cerradas y no aparece.
    const g = gruposAbiertos(remitos, [], [{ id: 'r-carla-2026-09-13T09:00:00' }], [{ remitoId: 'r-carla-2026-09-13T09:00:00' }])
    expect(g.map((x) => x.choferNombre)).toEqual(['BETO', 'ANA', 'ANA'])
    expect(g.every((x) => x.remitos.length === 1)).toBe(true)
    expect(g[1].plantaId).toBe('torcuato')
  })

  it('un viaje con la plata liquidada pero sin contar sigue abierto, y al revés también', () => {
    const r = remito({ fecha: '2026-09-15T10:00:00', choferId: 'ana' })
    const soloPlata = gruposAbiertos([r], [], [{ id: r.id }], [])
    expect(soloPlata).toHaveLength(1)

    const soloMercaderia = gruposAbiertos([r], [], [], [{ remitoId: r.id }])
    expect(soloMercaderia).toHaveLength(1)

    const lasDos = gruposAbiertos([r], [], [{ id: r.id }], [{ remitoId: r.id }])
    expect(lasDos).toHaveLength(0)
  })

  it('un cobrador sin remito también queda abierto; las cobranzas de mostrador no', () => {
    const cobranzas = [
      cobranza({ fecha: '2026-09-15T11:00:00', uid: 'super1', origen: 'supervisor', importe: 500 }),
      cobranza({ fecha: '2026-09-15T11:30:00', uid: 'cajero', origen: 'caja', importe: 900 }),
    ]
    const g = gruposAbiertos([], cobranzas, [])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ clave: '2026-09-15_super1', plantaId: null, choferNombre: 'SUPER1' })
    expect(g[0].cobranzas).toHaveLength(1)
  })

  it('las cobranzas del chofer se suman a su grupo del remito', () => {
    const g = gruposAbiertos([remito({ fecha: '2026-09-15T08:00:00', choferId: 'ana' })], [cobranza({ fecha: '2026-09-15T12:00:00', uid: 'ana', origen: 'cobrador', importe: 100 })], [])
    expect(g).toHaveLength(1)
    expect(g[0].remitos).toHaveLength(1)
    expect(g[0].cobranzas).toHaveLength(1)
  })
})

describe('diasAbierta', () => {
  it('cuenta días calendario, nunca negativo', () => {
    expect(diasAbierta('2026-09-15', '2026-09-15')).toBe(0)
    expect(diasAbierta('2026-09-13', '2026-09-15')).toBe(2)
    expect(diasAbierta('2026-09-16', '2026-09-15')).toBe(0)
  })
})

describe('resumirAbierta', () => {
  const g = gruposAbiertos([remito({ fecha: '2026-09-14T08:00:00', choferId: 'ana' })], [], [])[0]
  const venta = { id: 'v1', choferId: 'ana', clienteId: 'cli', clienteNombre: 'CLIENTE', canal: 'contado', formaPago: 'contado_efectivo', total: 30_000,
    items: [{ productoId: 'p1', nombre: 'Hielo bolsa 2kg', cantidad: 30, precio: 1000, subtotal: 30_000 }], fecha: ts('2026-09-14T10:00:00') } as unknown as VentaCamion

  it('sin descarga: todo lo que no se vendió está pendiente de devolver, y el camión sigue en la calle', () => {
    const r = resumirAbierta(g, { ventas: [venta], cambios: [], descargas: [], cobranzas: [] }, '2026-09-16')
    expect(r).toMatchObject({ estado: 'en_calle', diasAbierta: 2, cargaBultos: 100, bultosVendidos: 30, devolucionTeorica: 70, hayDescarga: false, bultosSinDevolver: 70, ventasCantidad: 1, ventasTotal: 30_000, efectivoARendir: 30_000 })
  })

  it('con descarga contada: solo cuenta lo que falta contra el teórico', () => {
    const descarga = { id: 'd1', choferId: 'ana', items: [{ productoId: 'p1', nombre: 'Hielo bolsa 2kg', cantidad: 65 }], bolsasRotas: [], registradoPor: { uid: 'm', nombre: 'Muelle' }, fecha: ts('2026-09-14T18:00:00') } as unknown as DescargaCamion
    const r = resumirAbierta(g, { ventas: [venta], cambios: [], descargas: [descarga], cobranzas: [] }, '2026-09-14')
    expect(r).toMatchObject({ estado: 'descargado', diasAbierta: 0, descargaContada: 65, bultosSinDevolver: 5, bultosSobrantes: 0 })
  })

  it('con regreso marcado y sin conteo: "volvió"', () => {
    const conRegreso = { ...g, remitos: [{ ...g.remitos[0], regreso: { uid: 'ana', nombre: 'ANA', hora: ts('2026-09-14T17:30:00') } }] as RemitoCarga[] }
    const r = resumirAbierta(conRegreso, { ventas: [], cambios: [], descargas: [], cobranzas: [] }, '2026-09-14')
    expect(r.estado).toBe('volvio')
    expect(r.regresoHora?.getHours()).toBe(17)
  })

  it('solo cobranzas: sin bultos, con la plata a rendir', () => {
    const cs = [cobranza({ fecha: '2026-09-15T11:00:00', uid: 'super1', origen: 'supervisor', importe: 1500 })]
    const gs = gruposAbiertos([], cs, [])[0]
    const r = resumirAbierta(gs, { ventas: [], cambios: [], descargas: [], cobranzas: gs.cobranzas }, '2026-09-15')
    expect(r).toMatchObject({ estado: 'solo_cobranzas', cargaBultos: 0, bultosSinDevolver: 0, cobranzasCantidad: 1, cobranzasTotal: 1500, efectivoARendir: 1500 })
  })
})

describe('totalesAbiertas', () => {
  it('suma abiertas, las de días anteriores, bultos y efectivo', () => {
    const base = { bultosSinDevolver: 0, efectivoARendir: 0, diasAbierta: 0 }
    const t = totalesAbiertas([
      { ...base, diasAbierta: 0, bultosSinDevolver: 5, efectivoARendir: 100 },
      { ...base, diasAbierta: 3, bultosSinDevolver: 70, efectivoARendir: 2500 },
    ] as never)
    expect(t).toEqual({ abiertas: 2, diasAnteriores: 1, bultosSinDevolver: 75, efectivoARendir: 2600 })
  })
})
