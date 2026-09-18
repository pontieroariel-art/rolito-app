import { describe, expect, it } from 'vitest'
import {
  armarCierreMercaderia, calcularFaltante, cuadrarEnvases, mercaderiaDelViaje,
  ventasDelViaje, viajeDeVenta,
  type DescargaParaCierre, type RemitoParaCierre, type VentaParaCierre,
} from './cierreMercaderia'

const item = (productoId: string, cantidad: number, nombre = productoId) => ({ productoId, nombre, cantidad })

const remito = (over: Partial<RemitoParaCierre> = {}): RemitoParaCierre => ({
  id: 'r1', codigo: 'RC-DT-000001', plantaId: 'torcuato', choferId: 'u1', choferNombre: 'Mira',
  items: [item('b3', 100, 'Bolsa 3 kg')], palletsCarga: 0, ...over,
})

describe('mercadería del viaje (2026-09-18)', () => {
  it('cuadrado: carga 100, vendió 80, volvieron 20 → sin diferencia', () => {
    const m = mercaderiaDelViaje(
      [remito()],
      [{ canal: 'contado', items: [item('b3', 80, 'Bolsa 3 kg')] }],
      [],
      [{ id: 'd1', items: [item('b3', 20, 'Bolsa 3 kg')] }],
    )
    expect(m.productos).toHaveLength(1)
    expect(m.productos[0]).toMatchObject({ carga: 100, ventaContado: 80, devolucionTeorica: 20, descarga: 20, diferencia: 0 })
  })

  it('separa contado de promo y descuenta los cambios del teórico', () => {
    const ventas: VentaParaCierre[] = [
      { canal: 'contado', items: [item('b3', 50)], cambios: [item('cambio_b3', 5, 'Cambio b3')] },
      { canal: 'promo',   items: [item('b3', 10)] },
    ]
    const m = mercaderiaDelViaje([remito()], ventas, [], [{ id: 'd1', items: [item('b3', 35)] }])
    expect(m.productos[0]).toMatchObject({ ventaContado: 50, ventaPromo: 10, cambios: 5, devolucionTeorica: 35, diferencia: 0 })
    expect(m.cambios.registrados).toBe(5)
  })

  it('suma el registro viejo de cambiosCamion normalizando el prefijo cambio_', () => {
    const m = mercaderiaDelViaje([remito()], [], [item('cambio_b3', 4, 'Cambio Bolsa 3 kg')], [])
    expect(m.productos).toHaveLength(1)
    expect(m.productos[0]).toMatchObject({ productoId: 'b3', nombre: 'Bolsa 3 kg', cambios: 4, devolucionTeorica: 96 })
  })

  it('una venta anulada con NC no cuenta: esa mercadería tenía que volver', () => {
    const m = mercaderiaDelViaje(
      [remito()],
      [{ canal: 'contado', items: [item('b3', 80)], anulacion: { estado: 'anulada' } }],
      [],
      [{ id: 'd1', items: [item('b3', 100)] }],
    )
    expect(m.productos[0]).toMatchObject({ ventaContado: 0, devolucionTeorica: 100, diferencia: 0 })
  })

  it('un conteo rectificado se reemplaza por la corrección, no se suma', () => {
    const descargas: DescargaParaCierre[] = [
      { id: 'd1', items: [item('b3', 5)] },
      { id: 'd2', rectificaA: 'd1', items: [item('b3', 20)] },
    ]
    const m = mercaderiaDelViaje([remito()], [{ canal: 'contado', items: [item('b3', 80)] }], [], descargas)
    expect(m.productos[0]).toMatchObject({ descarga: 20, diferencia: 0 })
  })

  it('las rotas del muelle quedan por producto (fase B del stock)', () => {
    const m = mercaderiaDelViaje(
      [remito()], [], [],
      [{ id: 'd1', items: [item('b3', 97)], bolsasRotas: [item('cambio_b3', 3, 'Cambio Bolsa 3 kg')] }],
    )
    expect(m.productos[0].rotas).toBe(3)
    expect(m.cambios.rotasRecibidas).toBe(3)
  })

  it('un producto que se vendió sin figurar en la carga aparece igual, como faltante', () => {
    const m = mercaderiaDelViaje([remito()], [{ canal: 'contado', items: [item('esc', 10, 'Escamas')] }], [], [])
    const escamas = m.productos.find((p) => p.productoId === 'esc')
    expect(escamas).toMatchObject({ carga: 0, devolucionTeorica: -10, diferencia: 10 })
  })
})

describe('faltante del cierre', () => {
  const productos = (difs: Array<[string, number]>) =>
    difs.map(([nombre, diferencia]) => ({
      productoId: nombre, nombre, carga: 0, ventaContado: 0, ventaPromo: 0, cambios: 0,
      devolucionTeorica: 0, descarga: 0, diferencia, rotas: 0,
    }))

  it('un sobrante NO compensa un faltante', () => {
    const f = calcularFaltante(productos([['Bolsa 3 kg', -12], ['Escamas', 12]]), { habilitado: true, bolsas: 10 })
    expect(f).toMatchObject({ bolsasFaltantes: 12, bolsasSobrantes: 12, grave: true, umbral: 10 })
    expect(f.productos).toEqual([{ productoId: 'Bolsa 3 kg', nombre: 'Bolsa 3 kg', faltan: 12 }])
  })

  it('debajo del umbral no es grave', () => {
    expect(calcularFaltante(productos([['b3', -5]]), { habilitado: true, bolsas: 10 }).grave).toBe(false)
  })

  it('con el control apagado nada es grave', () => {
    expect(calcularFaltante(productos([['b3', -500]]), { habilitado: false, bolsas: 10 }).grave).toBe(false)
  })
})

describe('cuadre de envases', () => {
  it('implícitos del remito: 4 puntales por pallet, aro solo en la tarima de madera', () => {
    const c = cuadrarEnvases([remito({ envases: { tarimasMadera: 2, palletsMetal: 1, racks: [7, 9] } })], [])
    expect(c.salieron).toMatchObject({ tarimasMadera: 2, palletsMetal: 1, puntales: 12, aros: 2, sombreros: 3, racks: [7, 9] })
    expect(c.racksFaltantes).toEqual([7, 9])
  })

  it('un remito viejo sin envases se lee como pallets de metal', () => {
    const c = cuadrarEnvases([remito({ envases: null, palletsCarga: 3 })], [])
    expect(c.salieron).toMatchObject({ tarimasMadera: 0, palletsMetal: 3, puntales: 12, aros: 0, sombreros: 3 })
  })

  it('descarga legacy (completos/parciales/vacíos) y racks sobrantes', () => {
    const c = cuadrarEnvases(
      [remito({ envases: { tarimasMadera: 0, palletsMetal: 0, racks: [1] } })],
      [{ id: 'd1', palletsCompletos: 1, palletsParciales: 1, palletsVacios: 0 }, { id: 'd2', envases: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, racks: [5] } }],
    )
    expect(c.volvieron).toMatchObject({ palletsMetal: 2, puntales: 8, sombreros: 2, racks: [5] })
    expect(c.racksFaltantes).toEqual([1])
    expect(c.racksSobrantes).toEqual([5])
  })
})

describe('armarCierreMercaderia', () => {
  it('arma el doc con los datos del remito y solo las descargas vigentes', () => {
    const cierre = armarCierreMercaderia({
      remito: remito({ depositoTango: '06' }),
      ventas: [{ canal: 'contado', items: [item('b3', 80, 'Bolsa 3 kg')] }],
      cambios: [],
      descargas: [
        { id: 'd1', codigo: 'DC-DT-000001', items: [item('b3', 5, 'Bolsa 3 kg')] },
        { id: 'd2', codigo: 'DC-DT-000002', rectificaA: 'd1', items: [item('b3', 15, 'Bolsa 3 kg')] },
      ],
      umbral: { habilitado: true, bolsas: 3 },
      diaReparto: '2026-09-18',
      contadaPor: { uid: 'm1', nombre: 'Muelle' },
      contadaEn: 1234,
    })
    expect(cierre).toMatchObject({
      id: 'r1', remitoId: 'r1', remitoCodigo: 'RC-DT-000001', plantaId: 'torcuato',
      choferId: 'u1', depositoTango: '06', depositoTangoNombre: null, diaReparto: '2026-09-18', contadaEn: 1234,
    })
    expect(cierre.descargaIds).toEqual(['d2'])
    expect(cierre.descargaCodigos).toEqual(['DC-DT-000002'])
    expect(cierre.faltante).toMatchObject({ bolsasFaltantes: 5, grave: true })
  })

  it('sin conteo todavía, la devolución teórica entera sale como faltante (el cierre nace recién al contar)', () => {
    const cierre = armarCierreMercaderia({
      remito: remito(), ventas: [], cambios: [], descargas: [],
      diaReparto: '2026-09-18', contadaPor: { uid: 'm1', nombre: 'Muelle' }, contadaEn: 1,
    })
    expect(cierre.faltante.bolsasFaltantes).toBe(100)
    expect(cierre.descargaIds).toEqual([])
  })
})

describe('a qué viaje pertenece una venta', () => {
  const ts = (iso: string) => ({ toDate: () => new Date(iso) })
  const viaje = (id: string, iso: string, camionId = 'c1') => ({ id, camionId, choferId: 'u1', fecha: ts(iso) })

  it('lo que dice la venta manda', () => {
    expect(viajeDeVenta({ remitoId: 'r9', camionId: 'c1', fecha: ts('2026-09-18T12:00:00-03:00') }, [viaje('r1', '2026-09-18T05:00:00-03:00')])).toBe('r9')
  })

  it('sin remitoId: el último viaje del camión que ya había salido', () => {
    const viajes = [viaje('r1', '2026-09-18T05:00:00-03:00'), viaje('r2', '2026-09-18T13:00:00-03:00')]
    expect(viajeDeVenta({ camionId: 'c1', fecha: ts('2026-09-18T10:00:00-03:00') }, viajes)).toBe('r1')
    expect(viajeDeVenta({ camionId: 'c1', fecha: ts('2026-09-18T15:00:00-03:00') }, viajes)).toBe('r2')
  })

  it('una venta anterior a la salida (reloj corrido) cae en el primer viaje del día', () => {
    expect(viajeDeVenta({ camionId: 'c1', fecha: ts('2026-09-18T04:00:00-03:00') }, [viaje('r1', '2026-09-18T05:00:00-03:00')])).toBe('r1')
  })

  it('no mezcla días: una venta del 19 no cae en el viaje del 18', () => {
    expect(viajeDeVenta({ camionId: 'c1', fecha: ts('2026-09-19T10:00:00-03:00') }, [viaje('r1', '2026-09-18T05:00:00-03:00')])).toBeNull()
  })

  it('sin camión se resuelve por chofer; sin ninguno de los dos no se ubica', () => {
    const viajes = [viaje('r1', '2026-09-18T05:00:00-03:00')]
    expect(viajeDeVenta({ choferId: 'u1', fecha: ts('2026-09-18T10:00:00-03:00') }, viajes)).toBe('r1')
    expect(viajeDeVenta({ fecha: ts('2026-09-18T10:00:00-03:00') }, viajes)).toBeNull()
  })

  it('ventasDelViaje separa las de otro camión', () => {
    const viajes = [viaje('r1', '2026-09-18T05:00:00-03:00'), viaje('r2', '2026-09-18T05:00:00-03:00', 'c2')]
    const ventas = [
      { camionId: 'c1', fecha: ts('2026-09-18T10:00:00-03:00') },
      { camionId: 'c2', fecha: ts('2026-09-18T10:00:00-03:00') },
      { remitoId: 'r1', fecha: ts('2026-09-18T11:00:00-03:00') },
    ]
    expect(ventasDelViaje(ventas, viajes, 'r1')).toHaveLength(2)
  })
})
