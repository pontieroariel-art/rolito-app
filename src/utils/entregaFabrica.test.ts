import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { armarEntregaFabrica, entregasFabricaDelViaje, esEntregaSinComprobante, renglonesFabrica, unidadesEntregadas } from './entregaFabrica'
import { calcularLiquidacion } from './liquidacion'
import type { DescargaCamion, RemitoCarga } from '@/types'

const ts = (iso: string) => Timestamp.fromDate(new Date(iso))

describe('entrega con remito de fábrica (Coto/Carrefour, 2026-09-23)', () => {
  it('solo va por este camino el pedido sellado por el server y de un cliente registrado', () => {
    expect(esEntregaSinComprobante({ entregaSinComprobante: true, clientId: 'coto' })).toBe(true)
    expect(esEntregaSinComprobante({ entregaSinComprobante: false, clientId: 'coto' })).toBe(false)
    expect(esEntregaSinComprobante({ clientId: 'coto' })).toBe(false)
    expect(esEntregaSinComprobante({ entregaSinComprobante: true, clientId: 'externo' })).toBe(false)
  })

  it('los renglones descartan lo que no está en el catálogo y lo que quedó en cero', () => {
    expect(renglonesFabrica([
      { name: 'Hielo bolsa 2kg', quantity: 460, productoId: 'bolsa_2kg' },
      { name: 'Algo raro', quantity: 3 },
      { name: 'Hielo bolsa 3kg', quantity: 0, productoId: 'bolsa_3kg' },
    ])).toEqual([{ productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 460 }])
  })

  it('la entrega lleva el viaje del chofer (remito y camión) y el día', () => {
    const e = armarEntregaFabrica(
      [{ name: 'Hielo bolsa 2kg', quantity: 460, productoId: 'bolsa_2kg' }],
      { uid: 'gallo', nombre: 'GALLO', camionId: 'otro' },
      { id: 'rem1', codigo: 'RC-DT-000104', camionId: 'cam1' },
      ts('2026-09-23T14:00:00-03:00'), '2026-09-23',
    )
    expect(e).toMatchObject({ choferId: 'gallo', remitoId: 'rem1', remitoCodigo: 'RC-DT-000104', camionId: 'cam1', dia: '2026-09-23' })
    expect(unidadesEntregadas([e])).toBe(460)
    // Sin remito de carga queda sin viaje, con el camión del chofer.
    const sin = armarEntregaFabrica([], { uid: 'gallo', nombre: 'GALLO', camionId: 'cam9' }, null, ts('2026-09-23T14:00:00-03:00'), '2026-09-23')
    expect(sin).toMatchObject({ remitoId: null, remitoCodigo: null, camionId: 'cam9', productos: [] })
  })

  it('se atribuyen al viaje como una venta: por remitoId, y sin remito por camión y día', () => {
    const viajes = [
      { id: 'v1', camionId: 'cam1', choferId: 'gallo', fecha: ts('2026-09-23T05:00:00-03:00') },
      { id: 'v2', camionId: 'cam1', choferId: 'gallo', fecha: ts('2026-09-23T12:00:00-03:00') },
    ]
    const conRemito = armarEntregaFabrica([], { uid: 'gallo', nombre: 'G' }, { id: 'v2', codigo: 'x', camionId: 'cam1' }, ts('2026-09-23T13:00:00-03:00'), '2026-09-23')
    const sinRemito = armarEntregaFabrica([], { uid: 'gallo', nombre: 'G', camionId: 'cam1' }, null, ts('2026-09-23T08:00:00-03:00'), '2026-09-23')
    const pedidos = [{ entregaFabrica: conRemito }, { entregaFabrica: sinRemito }, { entregaFabrica: undefined }]
    expect(entregasFabricaDelViaje(pedidos, viajes, 'v2')).toEqual([conRemito])
    expect(entregasFabricaDelViaje(pedidos, viajes, 'v1')).toEqual([sinRemito])
    expect(entregasFabricaDelViaje(pedidos, viajes, null)).toHaveLength(2)
  })

  it('en la liquidación descuenta de la devolución teórica como una venta, sin plata', () => {
    const remito = { id: 'v1', items: [{ productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 2300 }], envases: { tarimasMadera: 0, palletsMetal: 5, racks: [] } } as unknown as RemitoCarga
    const descarga = { id: 'd1', remitoId: 'v1', items: [{ productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 1840 }], bolsasRotas: [], envases: { tarimasMadera: 0, palletsMetal: 5, puntales: 20, aros: 0, sombreros: 5, racks: [] }, fecha: ts('2026-09-23T18:00:00-03:00') } as unknown as DescargaCamion
    const entrega = armarEntregaFabrica([{ name: 'Hielo bolsa 2kg', quantity: 460, productoId: 'bolsa_2kg' }], { uid: 'gallo', nombre: 'G' }, { id: 'v1', codigo: 'x', camionId: 'cam1' }, ts('2026-09-23T14:00:00-03:00'), '2026-09-23')
    const calc = calcularLiquidacion([remito], [], [], [descarga], [], [entrega])
    const p = calc.productos.find((x) => x.productoId === 'bolsa_2kg')!
    expect(p).toMatchObject({ carga: 2300, entregasFabrica: 460, devolucionTeorica: 1840, descarga: 1840, diferencia: 0 })
    expect(calc.importes.total).toBe(0)
    expect(calc.efectivoARendir).toBe(0)
  })
})
