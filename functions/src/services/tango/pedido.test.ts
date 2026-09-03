import { describe, it, expect } from 'vitest'
import {
  armarPedido, renglonesDeVenta, referenciaPedido, fechaDe, fechaISO,
  numeroComprobanteInterno, prop, idDeFila, type PayloadVenta,
} from './pedido'

const venta: PayloadVenta = {
  canal: 'contado', camionId: 'cam1', choferId: 'ch1', choferNombre: 'Pedro Gómez',
  clienteId: 'cli1', clienteNombre: 'Kiosco La Esquina', clienteIdGva14Tango: 4321,
  items: [
    { productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 5, precioUnitario: 3000 },
    { productoId: 'barra', nombre: 'Barra de hielo', cantidad: 2, precioUnitario: 8000 },
  ],
  cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Hielo bolsa 10kg (cambio)', cantidad: 1, precioUnitario: 0 }],
  total: 31000, formaPago: 'cuenta_corriente', firmanteNombre: 'Juan Pérez',
  fecha: { seconds: Math.floor(new Date('2026-09-03T15:00:00-03:00').getTime() / 1000) },
  comprobanteInterno: { tipo: 'remito', puntoVenta: 2, numero: 15 },
}
const item = { origenColeccion: 'ventasCamion', origenId: 'venta123', empresa: 'redonhielo' }
const articulos: Record<string, string> = { bolsa_10kg: 'PTHIBOLROLI0010', barra: 'PTHIBARRA' }
const codigo = (id: string) => articulos[id] ?? null

describe('referencia y formatos', () => {
  it('la referencia es determinística por colección + id', () => {
    expect(referenciaPedido('ventasCamion', 'abc')).toBe('ROLITO:VC:abc')
    expect(referenciaPedido('ventasVentanilla', 'abc')).toBe('ROLITO:VV:abc')
  })
  it('fechaDe acepta Timestamp admin/cliente, Date e ISO', () => {
    const d = new Date('2026-09-03T15:00:00-03:00')
    expect(fechaDe({ toDate: () => d })).toBe(d)
    expect(fechaDe({ seconds: d.getTime() / 1000 }).getTime()).toBe(d.getTime())
    expect(fechaDe({ _seconds: d.getTime() / 1000 }).getTime()).toBe(d.getTime())
    expect(fechaDe(d.toISOString()).getTime()).toBe(d.getTime())
    expect(fechaISO(d)).toBe('2026-09-03')
  })
  it('numeroComprobanteInterno formatea 00002-00000015 y null sin número', () => {
    expect(numeroComprobanteInterno({ puntoVenta: 2, numero: 15 })).toBe('00002-00000015')
    expect(numeroComprobanteInterno(undefined)).toBeNull()
  })
  it('prop tolera PascalCase/camelCase; idDeFila toma el primer ID_*', () => {
    expect(prop({ SavedId: 7 }, 'savedId')).toBe(7)
    expect(prop({ value: { a: 1 } }, 'value')).toEqual({ a: 1 })
    expect(idDeFila({ COD_STA11: 'X', ID_STA11: 99 })).toBe(99)
    expect(idDeFila({ ID_MONEDA: 1 }, 'ID_MONEDA')).toBe(1)
  })
})

describe('renglonesDeVenta', () => {
  it('mapea ítems y cambios; el cambio cae al artículo base con precio 0', () => {
    const { renglones, faltantes } = renglonesDeVenta(venta, codigo)
    expect(faltantes).toEqual([])
    expect(renglones).toHaveLength(3)
    expect(renglones[0]).toMatchObject({ codigoArticulo: 'PTHIBOLROLI0010', cantidad: 5, precio: 3000 })
    expect(renglones[2]).toMatchObject({ codigoArticulo: 'PTHIBOLROLI0010', cantidad: 1, precio: 0 })
  })
  it('prefiere el artículo propio del cambio (CAMBIOHIELO10KG) si está configurado', () => {
    const { renglones } = renglonesDeVenta(venta, (id) => ({ ...articulos, cambio_bolsa_10kg: 'CAMBIOHIELO10KG' })[id] ?? null)
    expect(renglones[2].codigoArticulo).toBe('CAMBIOHIELO10KG')
  })
  it('reporta los productos sin código sin inventar nada', () => {
    const { renglones, faltantes } = renglonesDeVenta(venta, (id) => (id === 'barra' ? 'PTHIBARRA' : null))
    expect(faltantes).toEqual(['bolsa_10kg', 'cambio_bolsa_10kg'])
    expect(renglones).toHaveLength(1)
  })
})

describe('armarPedido', () => {
  const ids = { idGva14: 4321, idMoneda: 1, idDeposito: 76, articulos: { PTHIBOLROLI0010: 1815, PTHIBARRA: 1302 } }
  const { renglones } = renglonesDeVenta(venta, codigo)

  it('arma el PedidoData con cliente habitual, moneda, depósito del repartidor y renglones', () => {
    const p = armarPedido(venta, item, ids, renglones, { etiquetaCamion: '03 SERGIO ALVAREZ' })
    expect(p).toMatchObject({
      FECHA_PEDIDO: '2026-09-03', ID_GVA14: 4321, ES_CLIENTE_HABITUAL: true, ID_MONEDA: 1, ID_STA22: 76,
      PORCENTAJE_DESCUENTO_GENERAL: 0, ESTADO: 2, COMPROMETE_STOCK: true, LEYENDA_1: 'ROLITO:VC:venta123',
    })
    expect(p.LEYENDA_2).toBe('Remito app 00002-00000015 - Contado')
    expect(p.LEYENDA_3).toBe('Chofer Pedro Gómez - 03 SERGIO ALVAREZ')
    expect(p.RENGLON_DTO).toHaveLength(3)
    expect((p.RENGLON_DTO as unknown[])[0]).toEqual({
      ID_STA11: 1815, MODULO_UNIDAD_MEDIDA: 'GV', CANTIDAD_PEDIDA: 5, CANTIDAD_A_FACTURAR: 5,
      CANTIDAD_A_DESCARGAR: 5, PRECIO: 3000, PORCENTAJE_BONIFICACION: 0, ID_STA22: 76,
    })
    expect(p).not.toHaveProperty('ID_GVA43_TALON_PED')
  })
  it('sin depósito no manda ID_STA22; con talonario/vendedor/lista los incluye', () => {
    const p = armarPedido(venta, item, { ...ids, idDeposito: null, talonarioId: 27, vendedorId: 3, listaPreciosId: 12 }, renglones, { estadoPedido: 1, comprometeStock: false })
    expect(p).not.toHaveProperty('ID_STA22')
    expect(p).toMatchObject({ ID_GVA43_TALON_PED: 27, ID_GVA23: 3, ID_GVA10: 12, ESTADO: 1, COMPROMETE_STOCK: false })
  })
  it('las leyendas se recortan a 60 caracteres', () => {
    const p = armarPedido({ ...venta, choferNombre: 'X'.repeat(80) }, item, ids, renglones)
    expect((p.LEYENDA_3 as string).length).toBe(60)
  })
})
