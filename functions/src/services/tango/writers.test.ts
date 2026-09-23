import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enviarFactura, enviarNotaCredito, enviarRemito, type ConfigTango, type ContextoWriter } from './writers'
import type { PayloadVenta } from './pedido'

/**
 * Los writers del worker (remito → pedido de Tango; factura y NC → Facturador):
 * qué rechazan antes de tocar Tango, cómo resuelven ids y depósito, la
 * idempotencia por referencia y cómo interpretan la respuesta. El cliente de
 * Tango es un doble que responde por proceso y registra lo que se le pidió.
 * El consumidor final sin ficha está en writers.consumidorFinal.test.ts.
 */

const PEDIDOS = 19845, CLIENTES = 2117

function tangoFalso(opciones: {
  sinMoneda?: boolean; sinDeposito?: boolean; sinArticulo?: string; pedidoPrevio?: Record<string, unknown>; creado?: Record<string, unknown>
  ficha?: Record<string, unknown> | Error; facturador?: Record<string, unknown> | Error
} = {}) {
  const llamadas: { metodo: string; args: unknown[] }[] = []
  const anotar = (metodo: string, ...args: unknown[]) => { llamadas.push({ metodo, args }) }
  const tango = {
    resolverId: vi.fn(async (_c: number, clave: string) => {
      anotar('resolverId', clave)
      if (clave.startsWith('moneda:')) return opciones.sinMoneda ? null : 1
      if (clave.startsWith('deposito:')) return opciones.sinDeposito ? null : 22
      if (clave.startsWith('articulo:')) return clave.endsWith(opciones.sinArticulo ?? '\u0000') ? null : 11
      return null
    }),
    getByFilter: vi.fn(async (_c: number, proceso: number, filtro: string) => { anotar('getByFilter', proceso, filtro); return opciones.pedidoPrevio ? [opciones.pedidoPrevio] : [] }),
    create: vi.fn(async (_c: number, proceso: number, body: unknown) => { anotar('create', proceso, body); return opciones.creado ?? { Succeeded: true, SavedId: 555 } }),
    getById: vi.fn(async (_c: number, proceso: number, id: unknown) => {
      anotar('getById', proceso, id)
      if (proceso === PEDIDOS) return { NRO_PEDIDO: 'P-0009 ' }
      if (proceso === CLIENTES) { if (opciones.ficha instanceof Error) throw opciones.ficha; return opciones.ficha ?? { COND_VTA: 5, COD_VENDED: 'JP', NRO_LISTA: 301, ID_CATEGORIA_IVA: 1 } }
      return undefined
    }),
    registrarComprobantes: vi.fn(async (_c: number, comprobantes: unknown[]) => {
      anotar('registrar', comprobantes)
      if (opciones.facturador instanceof Error) throw opciones.facturador
      return opciones.facturador ?? { Succeeded: true, Comprobantes: [{ numeroComprobante: 'A0110400000001', estado: 'Ok' }] }
    }),
  }
  return { tango: tango as unknown as ContextoWriter['tango'], llamadas }
}

const cfg: ConfigTango = {
  articulos: { bolsa_10kg: 'PTHIBOLROLI0010', barra: 'PTHIBARRA' },
  depositos: { ch1: '03', cam1: '04' }, depositosPlanta: { torcuato: '01' }, camiones: { ch1: 'SERGIO ALVAREZ' },
  pedido: { talonarioId: 7, condicionVentaId: 2, listaPreciosId: { contado: 300, promo: 302 } },
  facturador: {
    redonhielo: {
      talonarios: { A: 20, B: 21 }, talonariosNC: { A: 40, B: 41 }, condicionVenta: { contado: 1 }, listaPrecio: { contado: 2, promo: 3 }, contracuenta: 20,
      vendedor: 'AP', codigoTasaIva21: 1, cuentas: { contado_efectivo: '1', contado_transferencia: '5' }, codigoAlicuotaPercepcionIIBB: 12, depositoVentanilla: '01',
    },
    rolito: { talonarios: { A: 30, B: 31 }, condicionVenta: 1, listaPrecio: 3, contracuenta: 20, vendedor: 'AP', sinIva: true, cuentas: { contado_efectivo: '1' } },
  },
}
const ventaCtaCte: PayloadVenta = {
  canal: 'contado', formaPago: 'cuenta_corriente', total: 100, camionId: 'cam1', choferId: 'ch1', choferNombre: 'Pedro', clienteId: 'cli1', clienteNombre: 'ACME',
  clienteCodigoTango: 'FC.280', clienteIdGva14Tango: 500, firmanteNombre: 'Juan', fecha: { seconds: 1788381042 },
  comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 15 },
  items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10 kg', cantidad: 10, precioUnitario: 10 }],
  cambios: [{ productoId: 'cambio_barra', nombre: 'Cambio barra', cantidad: 1 }],
}
const ventaReal: PayloadVenta = {
  canal: 'contado', formaPago: 'contado_efectivo', total: 1, camionId: 'cam1', choferId: 'ch1', clienteId: 'cli1', choferNombre: 'Pedro', firmanteNombre: 'Juan',
  clienteCodigoTango: 'FC.280', clienteIdGva14Tango: 500,
  items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 1, precioUnitario: 1 }],
  factura: { cbteTipo: 1, numero: 1, puntoVenta: 1104, estado: 'emitida', cae: '86351147350772', caeFchVto: '20260912', importes: { fecha: '20260902', neto: 1, total: 1.27, iva: 0.21, tributos: 0.06 } },
  fecha: { seconds: 1788381042 },
}
const item = (extra: Partial<ContextoWriter['item']> = {}): ContextoWriter['item'] => ({ origenColeccion: 'ventasCamion', origenId: 'v1', empresa: 'redonhielo', ...extra })
const logs: string[] = []
const ctx = (tango: ContextoWriter['tango'], extra: Partial<ContextoWriter> = {}): ContextoWriter => ({ tango, cfg, company: 1, item: item(), log: (m) => { logs.push(m) }, ...extra })
beforeEach(() => { logs.length = 0 })

describe('enviarRemito: la venta que no factura ARCA entra como pedido', () => {
  it('rechaza antes de llamar a Tango: cliente sin vincular, artículo sin mapear, sin renglones, sin depósito', async () => {
    const { tango, llamadas } = tangoFalso()
    expect(await enviarRemito({ ...ventaCtaCte, clienteIdGva14Tango: undefined }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('sin vincular a Tango') })
    expect(await enviarRemito({ ...ventaCtaCte, items: [{ productoId: 'escamas', cantidad: 1 }] }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('config/tango.articulos para: escamas') })
    expect(await enviarRemito({ ...ventaCtaCte, items: [{ productoId: 'bolsa_10kg', cantidad: 0 }], cambios: [] }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('no tiene renglones') })
    expect(await enviarRemito({ ...ventaCtaCte, choferId: 'nadie', camionId: null }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('config/tango.depositos.nadie') })
    expect(llamadas).toEqual([])
  })

  it('camino feliz: resuelve moneda, depósito y artículos, arma el pedido con la referencia idempotente y devuelve el número de pedido como remito', async () => {
    const { tango, llamadas } = tangoFalso()
    const r = await enviarRemito(ventaCtaCte, ctx(tango))
    expect(r).toEqual({ ok: true, resultado: { savedId: 555, pedidoNumero: 'P-0009', remitoNumero: 'P-0009' } })
    // El depósito sale del mapa uid → código (no hay depositoTango en el doc).
    expect(llamadas.filter((l) => l.metodo === 'resolverId').map((l) => l.args[0])).toEqual(['moneda:PES', 'deposito:03', 'articulo:PTHIBOLROLI0010', 'articulo:PTHIBARRA'])
    expect(llamadas.find((l) => l.metodo === 'getByFilter')?.args).toEqual([PEDIDOS, "WHERE AXV_PEDIDO.LEYENDA_1 = 'ROLITO:VC:v1'"])
    const pedido = llamadas.find((l) => l.metodo === 'create')!.args[1] as Record<string, unknown>
    expect(pedido).toMatchObject({
      ID_GVA14: 500, ID_MONEDA: 1, ID_STA22: 22, ID_GVA43_TALON_PED: 7, ID_GVA01: 2, ID_GVA10: 300, ESTADO: 2, COMPROMETE_STOCK: true,
      LEYENDA_1: 'ROLITO:VC:v1', LEYENDA_2: 'Remito app 01105-00000015 - Contado', LEYENDA_3: 'Chofer Pedro - 03 SERGIO ALVAREZ', LEYENDA_4: 'Firmo: Juan',
    })
    // Renglones: la venta a precio, el cambio a $0 cayendo al artículo base.
    expect(pedido.RENGLON_DTO).toEqual([
      expect.objectContaining({ ID_STA11: 11, CANTIDAD_PEDIDA: 10, PRECIO: 10, ID_STA22: 22 }),
      expect.objectContaining({ ID_STA11: 11, CANTIDAD_PEDIDA: 1, PRECIO: 0 }),
    ])
    expect(logs.at(-1)).toContain('pedido creado en Tango')
  })

  it('el depósito explícito del doc (expedición por depósito) manda sobre el mapa de config; la ventanilla usa el de la planta', async () => {
    const { tango, llamadas } = tangoFalso()
    await enviarRemito({ ...ventaCtaCte, depositoTango: ' 21 ' }, ctx(tango))
    expect(llamadas.find((l) => String(l.args[0]).startsWith('deposito:'))?.args[0]).toBe('deposito:21')
    llamadas.length = 0
    await enviarRemito({ ...ventaCtaCte, choferId: undefined, camionId: null, plantaId: 'torcuato', cajaId: 'caja1', cajaNombre: 'Nico' }, ctx(tango, { item: item({ origenColeccion: 'ventasVentanilla', origenId: 'w1' }) }))
    expect(llamadas.find((l) => String(l.args[0]).startsWith('deposito:'))?.args[0]).toBe('deposito:01')
    const pedido = llamadas.find((l) => l.metodo === 'create')!.args[1] as Record<string, unknown>
    expect(pedido).toMatchObject({ LEYENDA_1: 'ROLITO:VV:w1', LEYENDA_3: 'Caja Nico - Torcuato' })
  })

  it('idempotencia: si Tango ya tiene un pedido con esa referencia, no crea otro y devuelve el existente', async () => {
    const { tango, llamadas } = tangoFalso({ pedidoPrevio: { ID_GVA21: 900, NRO_PEDIDO: 'P-0001' } })
    expect(await enviarRemito(ventaCtaCte, ctx(tango))).toEqual({ ok: true, resultado: { savedId: 900, pedidoNumero: 'P-0001', remitoNumero: 'P-0001', yaExistia: true } })
    expect(llamadas.some((l) => l.metodo === 'create')).toBe(false)
  })

  it('cada maestro que Tango no tiene se informa con nombre: moneda, depósito, artículo', async () => {
    expect(await enviarRemito(ventaCtaCte, ctx(tangoFalso({ sinMoneda: true }).tango))).toEqual({ ok: false, error: 'Tango no devolvió la moneda PES' })
    expect(await enviarRemito(ventaCtaCte, ctx(tangoFalso({ sinDeposito: true }).tango))).toEqual({ ok: false, error: expect.stringContaining('no tiene el depósito 03') })
    expect(await enviarRemito(ventaCtaCte, ctx(tangoFalso({ sinArticulo: 'PTHIBARRA' }).tango))).toEqual({ ok: false, error: 'Tango no tiene el artículo PTHIBARRA en la empresa 1' })
  })

  it('sin SavedId en la respuesta es error; si no se puede leer el número, el remito lleva el id', async () => {
    expect(await enviarRemito(ventaCtaCte, ctx(tangoFalso({ creado: { Succeeded: false, Message: 'x' } }).tango))).toEqual({ ok: false, error: expect.stringContaining('no devolvió SavedId') })
    const { tango } = tangoFalso()
    ;(tango.getById as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'))
    expect(await enviarRemito(ventaCtaCte, ctx(tango))).toEqual({ ok: true, resultado: { savedId: 555, pedidoNumero: null, remitoNumero: '555' } })
    expect(logs.some((l) => l.includes('no se pudo leer el número'))).toBe(true)
  })

  it('un error de red en cualquier paso vuelve como ok:false con el mensaje, sin relanzar', async () => {
    const { tango } = tangoFalso()
    ;(tango.resolverId as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Tango respondió 502 en GetByFilter'))
    expect(await enviarRemito(ventaCtaCte, ctx(tango))).toEqual({ ok: false, error: 'Tango respondió 502 en GetByFilter' })
  })
})

describe('enviarFactura: la factura de la app al Facturador', () => {
  it('sin la config de la empresa, o sin vendedor genérico, dice exactamente qué falta', async () => {
    const { tango } = tangoFalso()
    expect(await enviarFactura(ventaReal, ctx(tango, { item: item({ empresa: 'otra' }) }))).toEqual({ ok: false, error: expect.stringContaining('Falta config/tango.facturador.otra') })
    const sinVendedor = { ...cfg, facturador: { redonhielo: { ...cfg.facturador!.redonhielo, vendedor: '' } } }
    expect(await enviarFactura(ventaReal, ctx(tango, { cfg: sinVendedor }))).toEqual({ ok: false, error: expect.stringContaining('facturador.redonhielo.vendedor') })
  })

  it('el Facturador exige depósito: ventanilla sin planta mapeada y camión sin depósito son errores distintos', async () => {
    const { tango } = tangoFalso()
    const sinPlanta = { ...cfg, depositosPlanta: {}, facturador: { redonhielo: { ...cfg.facturador!.redonhielo, depositoVentanilla: undefined } } }
    expect(await enviarFactura({ ...ventaReal, camionId: null, choferId: undefined, plantaId: 'merlo' }, ctx(tango, { cfg: sinPlanta }))).toEqual({ ok: false, error: expect.stringContaining('depósito Tango de la planta merlo') })
    expect(await enviarFactura({ ...ventaReal, choferId: 'x', camionId: 'y' }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('depósito Tango del chofer') })
  })

  it('camino feliz: la ficha del cliente manda vendedor (su supervisor) y lista; registra con CAE y devuelve el número', async () => {
    const { tango, llamadas } = tangoFalso()
    const r = await enviarFactura(ventaReal, ctx(tango, { item: item({ conCaePropio: true }) }))
    expect(r).toEqual({ ok: true, resultado: { facturaNumero: 'A0110400000001', comprobanteNumero: 'A0110400000001', yaExistia: false, fiscal: true } })
    expect(llamadas.find((l) => l.metodo === 'getById')?.args).toEqual([CLIENTES, 500])
    const comprobantes = llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[]
    expect(comprobantes).toHaveLength(1)
    expect(comprobantes[0]).toMatchObject({
      codigoTipoComprobante: 'FAC', numeroComprobante: 'A0110400000001', codigoTalonario: 20, cAE: '86351147350772', codigoCliente: 'FC.280',
      codigoVendedor: 'JP', codigoListaPrecio: 301, codigoDeposito: '03', codigoCondicionDeVenta: 1, total: 1.27, leyenda3: 'Chofer Pedro - 03 SERGIO ALVAREZ',
    })
    expect(logs.at(-1)).toMatch(/factura A0110400000001 registrada .* con CAE/)
  })

  it('si la ficha no se puede leer se sigue con el vendedor genérico; cuenta corriente sin condición pactada ni config es error', async () => {
    const { tango, llamadas } = tangoFalso({ ficha: new Error('GetById 500') })
    const r = await enviarFactura(ventaReal, ctx(tango))
    expect(r).toMatchObject({ ok: true })
    expect((llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[])[0]).toMatchObject({ codigoVendedor: 'AP', codigoListaPrecio: 2 })
    expect(logs.some((l) => l.includes('no se pudo leer la ficha'))).toBe(true)
    const ctaCte = { ...ventaReal, formaPago: 'cuenta_corriente' }
    expect(await enviarFactura(ctaCte, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('no tiene condición de venta en Tango') })
    // Con la ficha, la cuota lleva la condición pactada del cliente (COND_VTA 5).
    const conFicha = tangoFalso()
    await enviarFactura(ctaCte, ctx(conFicha.tango))
    expect((conFicha.llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[])[0]).toMatchObject({ codigoCondicionDeVenta: 5, cuotasCuentaCorriente: [{ importe: 1.27 }] })
  })

  it('la promo (factura X) entra con la letra de la categoría de IVA del cliente; sin categoría legible no se registra', async () => {
    const promo: PayloadVenta = { ...ventaReal, canal: 'promo', factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 9 }, items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 2, precioUnitario: 1000 }] }
    const ri = tangoFalso({ ficha: { ID_CATEGORIA_IVA: 1 } })
    const r = await enviarFactura(promo, ctx(ri.tango, { item: item({ empresa: 'rolito' }), company: 3 }))
    expect(r).toMatchObject({ ok: true, resultado: { fiscal: false } })
    expect((ri.llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[])[0]).toMatchObject({ numeroComprobante: 'A0000300000009', codigoTalonario: 30, totalIva: 0 })
    const cf = tangoFalso({ ficha: { ID_CATEGORIA_IVA: 4 } })
    await enviarFactura(promo, ctx(cf.tango, { item: item({ empresa: 'rolito' }), company: 3 }))
    expect((cf.llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[])[0]).toMatchObject({ numeroComprobante: 'B0000300000009', codigoTalonario: 31 })
    expect(await enviarFactura(promo, ctx(tangoFalso({ ficha: {} }).tango, { item: item({ empresa: 'rolito' }), company: 3 }))).toEqual({ ok: false, error: expect.stringContaining('categoría de IVA') })
  })

  it('un item que dice conCaePropio con una venta sin CAE no se registra (Tango pediría otro CAE)', async () => {
    const { tango, llamadas } = tangoFalso()
    const sinCae = { ...ventaReal, factura: undefined, comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 9 } }
    expect(await enviarFactura(sinCae, ctx(tango, { item: item({ conCaePropio: true }) }))).toEqual({ ok: false, error: expect.stringContaining('no trae CAE') })
    expect(llamadas.some((l) => l.metodo === 'registrar')).toBe(false)
  })

  it('el Facturador rechaza con el detalle por comprobante; el duplicado 51016 se toma como ya registrado', async () => {
    const rechazo = tangoFalso({ facturador: { Succeeded: false, Message: 'Hubo errores', Comprobantes: [{ numeroComprobante: 'A0110400000001', estado: 'Error', mensaje: '(78038) talonario inexistente' }] } })
    expect(await enviarFactura(ventaReal, ctx(rechazo.tango))).toEqual({ ok: false, error: 'Facturador rechazó A0110400000001: (78038) talonario inexistente | Hubo errores' })
    const dup = tangoFalso({ facturador: { Succeeded: false, Comprobantes: [{ numeroComprobante: 'A0110400000001', estado: 'Error', mensaje: '(51016) Ya existe el número de comprobante' }] } })
    expect(await enviarFactura(ventaReal, ctx(dup.tango))).toEqual({ ok: true, resultado: { facturaNumero: 'A0110400000001', comprobanteNumero: 'A0110400000001', yaExistia: true, fiscal: true } })
    expect(logs.at(-1)).toContain('ya estaba registrada')
    expect(await enviarFactura(ventaReal, ctx(tangoFalso({ facturador: new Error('Tango respondió 503') }).tango))).toEqual({ ok: false, error: 'Tango respondió 503' })
  })
})

describe('enviarNotaCredito: la NC que anula la factura', () => {
  const nc = {
    ...ventaReal,
    notaCredito: { estado: 'emitida', cbteTipo: 3, puntoVenta: 1104, numero: 2, cae: '99', caeFchVto: '20260920', importes: { fecha: '20260910', neto: 1, iva: 0.21, tributos: 0.06, total: 1.27 }, cbtesAsoc: [{ Tipo: 1, PtoVta: 1104, Nro: 1 }] },
    anulacion: { motivo: 'cliente_equivocado', nota: 'era otro', solicitadoPor: 'Nico', resueltaPor: 'Fac' },
  }

  it('registra la NC con su talonario, CAE y la referencia a la factura', async () => {
    const { tango, llamadas } = tangoFalso({ facturador: { Succeeded: true, Comprobantes: [{ numeroComprobante: 'A0110400000002', estado: 'Ok' }] } })
    const r = await enviarNotaCredito(nc, ctx(tango, { item: item({ origenColeccion: 'anulacionesVentanilla', conCaePropio: true }) }))
    expect(r).toEqual({ ok: true, resultado: { notaCreditoNumero: 'A0110400000002', comprobanteNumero: 'A0110400000002', yaExistia: false, fiscal: true } })
    expect((llamadas.find((l) => l.metodo === 'registrar')!.args[0] as Record<string, unknown>[])[0]).toMatchObject({
      codigoTipoComprobante: 'N/C', numeroComprobante: 'A0110400000002', codigoTalonario: 40, cAE: '99', numeroDeComprobanteDeReferencia: 'A0110400000001',
      leyenda1: 'ROLITO:NC:v1', leyenda3: 'cliente_equivocado - era otro', leyenda4: 'Autorizo: Fac', leyenda5: 'Pidio: Nico',
    })
    expect(logs.at(-1)).toContain('nota de crédito A0110400000002 registrada')
  })

  it('sin NC emitida por ARCA, o con un total distinto al de la factura, no se registra', async () => {
    const { tango, llamadas } = tangoFalso()
    expect(await enviarNotaCredito({ ...nc, notaCredito: { ...nc.notaCredito, cae: null } }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('nota de crédito emitida por ARCA') })
    expect(await enviarNotaCredito({ ...nc, notaCredito: { ...nc.notaCredito, importes: { ...nc.notaCredito.importes, total: 5 } } }, ctx(tango))).toEqual({ ok: false, error: expect.stringContaining('no coincide con el de la factura') })
    expect(llamadas.some((l) => l.metodo === 'registrar')).toBe(false)
  })
})
