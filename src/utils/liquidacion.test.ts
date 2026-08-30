import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { calcularLiquidacion } from './liquidacion'
import {
  CambioCamion, CanalVenta, Cobranza, DescargaCamion, DescargaCamionItem,
  FormaPago, RemitoCarga, VentaCamion, VentaCamionItem,
} from '../types'

// La liquidación del repartidor es la lógica de plata más sensible de la app
// (replica la hoja "Liquidación de repartidores" del sistema viejo). Estos
// tests fijan el comportamiento por producto (carga − ventas − cambios =
// devolución teórica vs descarga), el cuadre de envases, y las tres formas de
// plata (contado efectivo/transferencia/cta.cte. + cobranzas de calle).

const TS = Timestamp.fromMillis(0)

// ── Factories: completas por defecto, se sobreescribe solo lo que varía ──
function remito(items: RemitoCarga['items'], palletsCarga = 0): RemitoCarga {
  return {
    id: 'rc1', numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato',
    camionId: 'cam1', camionLabel: 'AB123CD · Iveco', choferId: 'ch1', choferNombre: 'Juan',
    items, palletsCarga, estado: 'emitido',
    creadoPor: { uid: 'caja1', nombre: 'Caja Torcuato' }, fecha: TS,
  }
}

function item(productoId: string, nombre: string, cantidad: number): VentaCamionItem {
  return { productoId, nombre, cantidad, precioUnitario: 100 }
}

function venta(
  canal: CanalVenta, formaPago: FormaPago, items: VentaCamionItem[], total: number,
): VentaCamion {
  return {
    id: 'v1', canal, camionId: 'cam1', choferId: 'ch1', choferNombre: 'Juan',
    clienteId: 'cli1', clienteNombre: 'Kiosco', items, total, formaPago, fecha: TS,
  }
}

function cambio(productoId: string, nombre: string, cantidad: number): CambioCamion {
  return {
    id: 'cb1', camionId: 'cam1', choferId: 'ch1', choferNombre: 'Juan',
    clienteId: 'cli1', clienteNombre: 'Kiosco', productoId, nombre, cantidad, fecha: TS,
  }
}

function di(productoId: string, nombre: string, cantidad: number): DescargaCamionItem {
  return { productoId, nombre, cantidad }
}

function descarga(over: Partial<DescargaCamion> = {}): DescargaCamion {
  return {
    id: 'd1', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AB123CD · Iveco',
    choferId: 'ch1', choferNombre: 'Juan', items: [], bolsasRotas: [],
    palletsCompletos: 0, palletsParciales: 0, palletsVacios: 0,
    registradoPor: { uid: 'muelle1', nombre: 'Muelle' }, fecha: TS, ...over,
  }
}

function cobranza(formaPago: Cobranza['formaPago'], importe: number): Cobranza {
  return {
    id: 'co1', origen: 'cobrador', registradoPor: { uid: 'ch1', nombre: 'Juan' },
    clienteId: 'cli1', clienteNombre: 'Kiosco', importe, formaPago, fecha: TS,
  }
}

describe('calcularLiquidacion — por producto', () => {
  it('carga − ventas − cambios = devolución teórica, y cuadra contra la descarga', () => {
    const r = calcularLiquidacion(
      [remito([item('hielo10', 'Hielo 10kg', 100)])],
      [
        venta('contado', 'contado_efectivo', [item('hielo10', 'Hielo 10kg', 60)], 6000),
        venta('promo',   'cuenta_corriente', [item('hielo10', 'Hielo 10kg', 20)], 0),
      ],
      [cambio('hielo10', 'Hielo 10kg', 5)],
      [descarga({ items: [di('hielo10', 'Hielo 10kg', 15)] })],
    )
    expect(r.productos).toHaveLength(1)
    const p = r.productos[0]
    expect(p.carga).toBe(100)
    expect(p.ventaContado).toBe(60)
    expect(p.ventaPromo).toBe(20)
    expect(p.cambios).toBe(5)
    expect(p.devolucionTeorica).toBe(15)   // 100 − 60 − 20 − 5
    expect(p.descarga).toBe(15)
    expect(p.diferencia).toBe(0)           // descarga − devolución teórica
  })

  it('marca diferencia negativa cuando en la descarga falta mercadería', () => {
    const r = calcularLiquidacion(
      [remito([item('hielo10', 'Hielo 10kg', 100)])],
      [venta('contado', 'contado_efectivo', [item('hielo10', 'Hielo 10kg', 60)], 6000)],
      [],
      [descarga({ items: [di('hielo10', 'Hielo 10kg', 37)] })],   // teórico 40, volvieron 37
    )
    expect(r.productos[0].devolucionTeorica).toBe(40)
    expect(r.productos[0].diferencia).toBe(-3)
  })

  it('incluye un producto vendido aunque no figure en la carga (carga 0)', () => {
    const r = calcularLiquidacion(
      [remito([item('hielo10', 'Hielo 10kg', 100)])],
      [venta('contado', 'contado_efectivo', [item('hielo5', 'Hielo 5kg', 8)], 800)],
      [],
      [],
    )
    const p5 = r.productos.find((x) => x.productoId === 'hielo5')
    expect(p5).toBeDefined()
    expect(p5?.carga).toBe(0)
    expect(p5?.ventaContado).toBe(8)
    expect(p5?.devolucionTeorica).toBe(-8)
  })

  it('suma la carga de varios remitos del mismo día', () => {
    const r = calcularLiquidacion(
      [
        remito([item('hielo10', 'Hielo 10kg', 100)]),
        remito([item('hielo10', 'Hielo 10kg', 40)]),
      ],
      [], [], [],
    )
    expect(r.productos[0].carga).toBe(140)
  })

  it('ordena los productos alfabéticamente por nombre', () => {
    const r = calcularLiquidacion(
      [remito([
        item('z', 'Zeta', 1),
        item('a', 'Alfa', 1),
        item('m', 'Mu', 1),
      ])],
      [], [], [],
    )
    expect(r.productos.map((p) => p.nombre)).toEqual(['Alfa', 'Mu', 'Zeta'])
  })
})

describe('calcularLiquidacion — envases (pallets)', () => {
  it('cuadra bases salidas contra completos + parciales + vacíos', () => {
    const r = calcularLiquidacion(
      [remito([item('hielo10', 'Hielo 10kg', 100)], 10)],
      [], [],
      [descarga({ palletsCompletos: 3, palletsParciales: 2, palletsVacios: 4 })],
    )
    expect(r.pallets.salidos).toBe(10)
    expect(r.pallets.completos).toBe(3)
    expect(r.pallets.parciales).toBe(2)
    expect(r.pallets.vacios).toBe(4)
    expect(r.pallets.diferencia).toBe(-1)   // 9 volvieron, salieron 10
  })
})

describe('calcularLiquidacion — cambios vs bolsas rotas', () => {
  it('cuenta cambios registrados por el chofer y rotas recibidas por muelle por separado', () => {
    const r = calcularLiquidacion(
      [remito([item('hielo10', 'Hielo 10kg', 100)])],
      [],
      [cambio('hielo10', 'Hielo 10kg', 5), cambio('hielo10', 'Hielo 10kg', 2)],
      [descarga({ bolsasRotas: [di('hielo10', 'Hielo 10kg', 6)] })],
    )
    expect(r.cambios.registrados).toBe(7)
    expect(r.cambios.rotasRecibidas).toBe(6)   // falta una rota → queda registrado
  })
})

describe('calcularLiquidacion — plata', () => {
  it('separa importes por forma de pago y los totaliza', () => {
    const r = calcularLiquidacion(
      [], [
        venta('contado', 'contado_efectivo',      [item('hielo10', 'Hielo 10kg', 10)], 1000),
        venta('contado', 'contado_transferencia', [item('hielo10', 'Hielo 10kg', 5)],   500),
        venta('contado', 'cuenta_corriente',       [item('hielo10', 'Hielo 10kg', 3)],   300),
      ], [], [],
    )
    expect(r.importes.contadoEfectivo).toBe(1000)
    expect(r.importes.contadoTransferencia).toBe(500)
    expect(r.importes.cuentaCorriente).toBe(300)
    expect(r.importes.total).toBe(1800)
  })

  it('las cobranzas de calle en efectivo suman a rendir; las de transferencia no', () => {
    const r = calcularLiquidacion(
      [], [venta('contado', 'contado_efectivo', [item('hielo10', 'Hielo 10kg', 10)], 1000)], [], [],
      [cobranza('contado_efectivo', 400), cobranza('contado_transferencia', 250)],
    )
    expect(r.cobranzasCalle?.cantidad).toBe(2)
    expect(r.cobranzasCalle?.efectivo).toBe(400)
    expect(r.cobranzasCalle?.transferencia).toBe(250)
    expect(r.cobranzasCalle?.total).toBe(650)
    // efectivo a rendir = venta contado efectivo (1000) + cobranza efectivo (400)
    expect(r.efectivoARendir).toBe(1400)
  })
})

describe('calcularLiquidacion — casos borde', () => {
  it('sin ningún movimiento devuelve todo en cero', () => {
    const r = calcularLiquidacion([], [], [], [])
    expect(r.productos).toEqual([])
    expect(r.importes.total).toBe(0)
    expect(r.pallets.diferencia).toBe(0)
    expect(r.cambios.registrados).toBe(0)
    expect(r.cobranzasCalle?.total).toBe(0)
    expect(r.efectivoARendir).toBe(0)
  })
})
