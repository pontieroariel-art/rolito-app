import { describe, it, expect } from 'vitest'
import {
  egresoDeVentaPromo, transferenciaDeCargaDescarga, sentenciasMovimiento, sentenciaExisteMovimiento,
  escribirMovimientoStock, TRAZA, type ConfigTipoMovimiento, type DatosMovimiento,
} from './movimientoStock'
import type { EjecutorSql, ParametroSql } from './tipos'
import type { PayloadVenta } from '../pedido'

const articulos = { bolsa_10kg: 'PTHIBOLROLI0010', bolsa_3kg: 'PTHIBOLROLI0003' }
const cfgVpr: ConfigTipoMovimiento = { tipo: 'egreso', tComp: 'VPR', talonario: 900, incluyeCambios: true }
const cfgCar: ConfigTipoMovimiento = { tipo: 'transferencia', tComp: 'CAR', tcompInS: 'TI', talonario: 13 }
const usuario = { usuario: 'ROLITO', terminal: 'APP' }

const promo: PayloadVenta = {
  canal: 'promo', formaPago: 'contado_efectivo', choferId: 'ch1', choferNombre: 'Pedro', camionId: 'cam1',
  clienteCodigoTango: 'FC.280', clienteNombre: 'Kiosco Juan',
  items: [{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10', cantidad: 48, precioUnitario: 5200 }],
  cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio', cantidad: 2, precioUnitario: 0 }],
  total: 249600,
  fecha: { seconds: Math.floor(new Date(2026, 8, 7, 9, 15).getTime() / 1000) },
  comprobanteInterno: { tipo: 'facturaX', puntoVenta: 3, numero: 120 },
}

const datos: DatosMovimiento = {
  ncompInS: '00000001', numero: 1, proximoLeido: 1, sucursal: 900, nComp: ' 0090000000001',
  articulos: {
    PTHIBOLROLI0010: { idMedidaStock: 17, idMedidaVentas: 17, stockOrigen: 100, stockDestino: null },
    PTHIBOLROLI0003: { idMedidaStock: 17, idMedidaVentas: 17, stockOrigen: 30, stockDestino: null },
  },
}

const param = (ps: ParametroSql[], nombre: string) => ps.find((p) => p.nombre === nombre)?.valor

describe('egresoDeVentaPromo', () => {
  it('el ejemplo de Ariel: 48 vendidas + 2 de cambio = egreso de 50 del depósito del camión', () => {
    const m = egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', cfgVpr)
    expect(m.tipo).toBe('egreso')
    expect(m.tComp).toBe('VPR')
    expect(m.tcompInS).toBe('VS')
    expect(m.depositoOrigen).toBe('21')
    expect(m.depositoDestino).toBeUndefined()
    expect(m.renglones).toEqual([{ codArticu: 'PTHIBOLROLI0010', cantidad: 50 }])
    expect(m.referencia).toBe('ROLITO:VC:v1')
    expect(m.leyendas[0]).toBe('Fact X Rolito 00003-00000120 - contado_efectivo')
    expect(m.leyendas[1]).toBe('Chofer Pedro - dep 21')
    expect(m.codCliente).toBe('FC.280')
  })
  it('sin cambios cuando la config lo pide (fase B: el cambio sale por su propio comprobante)', () => {
    const m = egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', { ...cfgVpr, incluyeCambios: false })
    expect(m.renglones).toEqual([{ codArticu: 'PTHIBOLROLI0010', cantidad: 48 }])
  })
  it('promo "solo cambio" ($0): el egreso lleva solo las bolsas repuestas', () => {
    const m = egresoDeVentaPromo({ ...promo, items: [], total: 0 }, 'ventasVentanilla', 'v2', articulos, '01', cfgVpr)
    expect(m.renglones).toEqual([{ codArticu: 'PTHIBOLROLI0010', cantidad: 2 }])
    expect(m.referencia).toBe('ROLITO:VV:v2')
  })
  it('errores claros: sin renglones, sin mapeo, sin depósito, tipo equivocado', () => {
    expect(() => egresoDeVentaPromo({ ...promo, items: [], cambios: [] }, 'ventasCamion', 'v1', articulos, '21', cfgVpr)).toThrow(/renglones/)
    expect(() => egresoDeVentaPromo({ ...promo, items: [{ productoId: 'raro', cantidad: 1 }] }, 'ventasCamion', 'v1', articulos, '21', cfgVpr)).toThrow(/config\/tango.articulos/)
    expect(() => egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '', cfgVpr)).toThrow(/depósito/)
    expect(() => egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', cfgCar)).toThrow(/egreso/)
    expect(() => egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', { ...cfgVpr, talonario: 0 })).toThrow(/incompleto/)
  })
})

describe('transferenciaDeCargaDescarga', () => {
  const carga = { sentido: 'carga' as const, codigo: 'RC-000045', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'Camión 4', choferNombre: 'Pedro',
    items: [{ productoId: 'bolsa_10kg', cantidad: 400 }, { productoId: 'bolsa_3kg', cantidad: 100 }], fecha: new Date(2026, 8, 7, 6, 0) }
  it('carga: planta → camión', () => {
    const m = transferenciaDeCargaDescarga(carga, 'remitosCarga', 'rc1', articulos, '01', '21', cfgCar)
    expect(m).toMatchObject({ tipo: 'transferencia', tComp: 'CAR', tcompInS: 'TI', depositoOrigen: '01', depositoDestino: '21', referencia: 'ROLITO:RC:rc1' })
    expect(m.renglones).toHaveLength(2)
  })
  it('descarga: camión → planta', () => {
    const m = transferenciaDeCargaDescarga({ ...carga, sentido: 'descarga' }, 'descargasCamion', 'dc1', articulos, '01', '21', { ...cfgCar, tComp: 'DES' })
    expect(m).toMatchObject({ tComp: 'DES', depositoOrigen: '21', depositoDestino: '01', referencia: 'ROLITO:DC:dc1' })
  })
})

describe('sentenciasMovimiento — egreso', () => {
  const m = egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', cfgVpr)
  const ahora = new Date(2026, 8, 7, 9, 16, 5)
  const ss = sentenciasMovimiento(m, datos, usuario, ahora)

  it('talonario primero, después cabecera, renglón y saldo', () => {
    expect(ss.map((s) => s.etiqueta)).toEqual(['UPDATE STA17 proximo', 'INSERT STA14', 'INSERT STA20 PTHIBOLROLI0010', 'UPDATE STA19 stock PTHIBOLROLI0010'])
  })
  it('el talonario avanza con concurrencia optimista', () => {
    expect(ss[0].sql).toContain('"PROXIMO" = @ANTERIOR')
    expect(param(ss[0].params, 'TALONARIO')).toBe(900)
    expect(param(ss[0].params, 'ANTERIOR')).toBe(1)
    expect(param(ss[0].params, 'SIGUIENTE')).toBe(2)
  })
  it('la cabecera es la de un comprobante de stock, no la de un remito', () => {
    const p = ss[1].params
    expect(p).toHaveLength(60)
    expect(param(p, 'T_COMP')).toBe('VPR')
    expect(param(p, 'TCOMP_IN_S')).toBe('VS')
    expect(param(p, 'TALONARIO')).toBe(900)
    expect(param(p, 'N_COMP')).toBe(' 0090000000001')   // con el espacio adelante, como Tango
    expect(param(p, 'N_REMITO')).toBe('')
    expect(param(p, 'ESTADO_MOV')).toBe('')
    expect(param(p, 'MOTIVO_REM')).toBe('')
    expect(param(p, 'COD_PRO_CL')).toBe('FC.280')
    expect(param(p, 'COD_DEPOSI')).toBe('')            // el depósito va en el renglón (traza)
    expect(param(p, 'HORA_ANU')).toBeNull()
    expect(param(p, 'TERMINAL_ANU')).toBeNull()
    expect(param(p, 'LEYENDA1')).toBe('ROLITO:VC:v1')
    expect(param(p, 'LEYENDA2')).toBe('Fact X Rolito 00003-00000120 - contado_efectivo')
    expect(param(p, 'LEYENDA3')).toBe('Chofer Pedro - dep 21')
    expect(param(p, 'LEYENDA4')).toBe('Cliente FC.280 Kiosco Juan')
    expect(param(p, 'HORA_COMP')).toBe('091605')
    expect(param(p, 'ID_DIRECCION_ENTREGA')).toBeNull()
    expect((param(p, 'FECHA_MOV') as Date).getDate()).toBe(7)
  })
  it('el renglón sale del depósito sin pendiente de facturar', () => {
    const p = ss[2].params
    expect(p).toHaveLength(50)
    expect(param(p, 'TIPO_MOV')).toBe('S')
    expect(param(p, 'COD_DEPOSI')).toBe('21')
    expect(param(p, 'DEPOSI_DDE')).toBe('')
    expect(param(p, 'CANTIDAD')).toBe(50)
    expect(param(p, 'CANT_PEND')).toBe(0)
    expect(param(p, 'IMPUESTO_INTERNO_FIJO')).toBe(0)
    expect(param(p, 'ID_MEDIDA_STOCK')).toBe(17)
    expect(param(p, 'ID_MEDIDA_VENTAS')).toBeNull()
    expect(param(p, 'N_RENGL_S')).toBe(1)
    expect(param(p, 'NCOMP_IN_S')).toBe('00000001')
  })
  it('descuenta el saldo leído', () => {
    expect(param(ss[3].params, 'CANT_ANTERIOR')).toBe(100)
    expect(param(ss[3].params, 'CANT_NUEVA')).toBe(50)
  })
  it('todos los parámetros tienen tipo SQL explícito', () => {
    for (const s of ss) for (const p of s.params) expect(p.tipo.kind).toBeTruthy()
  })
})

describe('sentenciasMovimiento — transferencia', () => {
  const m = transferenciaDeCargaDescarga(
    { sentido: 'carga', items: [{ productoId: 'bolsa_10kg', cantidad: 400 }], fecha: new Date(2026, 8, 7) },
    'remitosCarga', 'rc1', articulos, '01', '21', cfgCar,
  )
  const d: DatosMovimiento = { ...datos, nComp: ' 0002500067900', numero: 67900, proximoLeido: 67900, sucursal: 25,
    articulos: { PTHIBOLROLI0010: { idMedidaStock: 17, idMedidaVentas: 17, stockOrigen: 5000, stockDestino: 0 } } }
  const ss = sentenciasMovimiento(m, d, usuario)

  it('dos renglones por artículo (E en destino, S en origen) y dos updates de saldo, destino primero', () => {
    expect(ss.map((s) => s.etiqueta)).toEqual([
      'UPDATE STA17 proximo', 'INSERT STA14', 'INSERT STA20 PTHIBOLROLI0010 E', 'INSERT STA20 PTHIBOLROLI0010 S',
      'UPDATE STA19 destino PTHIBOLROLI0010', 'UPDATE STA19 stock PTHIBOLROLI0010',
    ])
    expect(param(ss[1].params, 'COD_DEPOSI')).toBe('')          // la transferencia no lleva depósito en la cabecera
    expect(param(ss[1].params, 'COD_PRO_CL')).toBe('')
    expect(param(ss[1].params, 'N_COMP')).toBe(' 0002500067900')
    expect(param(ss[2].params, 'TIPO_MOV')).toBe('E')
    expect(param(ss[2].params, 'COD_DEPOSI')).toBe('21')
    expect(param(ss[2].params, 'DEPOSI_DDE')).toBe('01')
    expect(param(ss[3].params, 'TIPO_MOV')).toBe('S')
    expect(param(ss[3].params, 'COD_DEPOSI')).toBe('01')
    expect(param(ss[3].params, 'DEPOSI_DDE')).toBe('21')
    expect(param(ss[3].params, 'N_RENGL_S')).toBe(2)
    expect(param(ss[4].params, 'CANT_NUEVA')).toBe(400)
    expect(param(ss[5].params, 'CANT_NUEVA')).toBe(4600)
  })
  it('sin fila de stock en el destino, la crea con lo que entra (camión tercerizado en su primera carga)', () => {
    const sinDestino = { ...d, articulos: { PTHIBOLROLI0010: { ...d.articulos.PTHIBOLROLI0010, stockDestino: null } } }
    const s = sentenciasMovimiento(m, sinDestino, usuario)
    expect(s.map((x) => x.etiqueta)).toContain('INSERT STA19 destino PTHIBOLROLI0010')
    const ins = s.find((x) => x.etiqueta === 'INSERT STA19 destino PTHIBOLROLI0010')!
    expect(ins.sql).toMatch(/INSERT INTO "STA19" \("FILLER", "CANT_STOCK", "COD_ARTICU", "COD_DEPOSI", "COD_UBIC1", "COD_UBIC2", "COD_UBIC3", "UBIC_TXT"\)/)
    expect(param(ins.params, 'CANT_STOCK')).toBe(400)
    expect(param(ins.params, 'COD_DEPOSI')).toBe('21')
    expect(s.find((x) => x.etiqueta === 'UPDATE STA19 stock PTHIBOLROLI0010')).toBeTruthy()
  })
  it('descarga: camión → planta, con el depósito del payload', () => {
    const des = transferenciaDeCargaDescarga(
      { sentido: 'descarga', depositoTango: '33', items: [{ productoId: 'bolsa_3kg', cantidad: 12 }], fecha: new Date(2026, 8, 7) },
      'descargasCamion', 'dc1', articulos, '01', '33', { ...cfgCar, tComp: 'DES' },
    )
    expect(des).toMatchObject({ tComp: 'DES', depositoOrigen: '33', depositoDestino: '01', referencia: 'ROLITO:DC:dc1' })
    const dd: DatosMovimiento = { ...d, articulos: { PTHIBOLROLI0003: { idMedidaStock: 17, idMedidaVentas: 17, stockOrigen: null, stockDestino: 900 } } }
    const s = sentenciasMovimiento(des, dd, usuario)
    expect(s.map((x) => x.etiqueta)).toEqual([
      'UPDATE STA17 proximo', 'INSERT STA14', 'INSERT STA20 PTHIBOLROLI0003 E', 'INSERT STA20 PTHIBOLROLI0003 S',
      'UPDATE STA19 destino PTHIBOLROLI0003', 'INSERT STA19 stock PTHIBOLROLI0003',
    ])
    expect(param(s[4].params, 'CANT_NUEVA')).toBe(912)
    expect(param(s[5].params, 'CANT_STOCK')).toBe(-12)
  })
})

// Fake de la base: responde a cada consulta según su texto y registra lo ejecutado.
function fakeDb(opts: { existe?: boolean; talonarioCambia?: boolean; stockCambia?: boolean; sinStock?: boolean } = {}) {
  const ejecutadas: string[] = []
  const db: EjecutorSql = {
    async query<T>(sql: string, params: ParametroSql[] = []): Promise<T[]> {
      ejecutadas.push(sql.split(' ').slice(0, 3).join(' '))
      const r = (rows: unknown[]) => rows as T[]
      if (sql.startsWith('SELECT ID_STA14, N_COMP, NCOMP_IN_S')) return r(opts.existe ? [{ ID_STA14: 77, N_COMP: ' 0090000000009', NCOMP_IN_S: '00000009' }] : [])
      if (sql.startsWith('SELECT SUCURSAL, PROXIMO FROM STA17')) return r([{ SUCURSAL: 900, PROXIMO: 12 }])
      if (sql.startsWith('SELECT MAX(NCOMP_IN_S)')) { expect(param(params, 'T')).toBe('VS'); return r([{ MAXN: '00001128' }]) }
      if (sql.startsWith('SELECT ID_MEDIDA_STOCK')) return r([{ ID_MEDIDA_STOCK: 17, ID_MEDIDA_VENTAS: 17 }])
      if (sql.startsWith('SELECT CANT_STOCK')) return r(opts.sinStock ? [] : [{ CANT_STOCK: 100 }])
      if (sql.startsWith('UPDATE "STA17"')) return r([{ affected: opts.talonarioCambia ? 0 : 1 }])
      if (sql.startsWith('INSERT INTO "STA14"')) return r([{ ID: 901 }])
      if (sql.startsWith('INSERT INTO "STA20"')) return r([{ ID: 1 }])
      if (sql.startsWith('UPDATE "STA19"')) return r([{ affected: opts.stockCambia ? 0 : 1 }])
      if (sql.startsWith('INSERT INTO "STA19"')) return r([{ affected: 1 }])
      throw new Error('consulta inesperada: ' + sql + ' ' + JSON.stringify(params.map((p) => p.valor)))
    },
  }
  return { db, ejecutadas }
}

describe('escribirMovimientoStock', () => {
  const m = egresoDeVentaPromo(promo, 'ventasCamion', 'v1', articulos, '21', cfgVpr)
  it('numera con el talonario, inserta y descuenta; devuelve el número de Tango', async () => {
    const { db, ejecutadas } = fakeDb()
    const res = await escribirMovimientoStock(db, m, usuario)
    expect(res).toEqual({ yaExistia: false, idSta14: 901, nComp: '0090000000012', numero: 12, ncompInS: '00001129', tComp: 'VPR' })
    expect(ejecutadas.some((e) => e.includes('INCREMENTAL_VALUE'))).toBe(false)   // MAX+1 por tipo interno, como Tango
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE "STA17"'))).toHaveLength(1)
    expect(ejecutadas.filter((e) => e.startsWith('INSERT'))).toHaveLength(2)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE "STA19"'))).toHaveLength(1)
  })
  it('si ya existe (misma referencia) no escribe nada', async () => {
    const { db, ejecutadas } = fakeDb({ existe: true })
    const res = await escribirMovimientoStock(db, m, usuario)
    expect(res).toMatchObject({ yaExistia: true, idSta14: 77, nComp: '0090000000009', numero: 9 })
    expect(ejecutadas).toHaveLength(1)
    expect(sentenciaExisteMovimiento(m).params.map((p) => p.valor)).toEqual(['VPR', 'ROLITO:VC:v1'])
  })
  it('si la oficina numeró en el medio, falla para reintentar', async () => {
    const { db } = fakeDb({ talonarioCambia: true })
    await expect(escribirMovimientoStock(db, m, usuario)).rejects.toThrow(/talonario cambió/)
  })
  it('si el stock cambió en el medio, falla para reintentar', async () => {
    const { db } = fakeDb({ stockCambia: true })
    await expect(escribirMovimientoStock(db, m, usuario)).rejects.toThrow(/stock cambió/)
  })
  it('sin fila de stock en el depósito del camión, la crea en negativo y avisa', async () => {
    const { db, ejecutadas } = fakeDb({ sinStock: true })
    const avisos: string[] = []
    const res = await escribirMovimientoStock(db, m, usuario, (x) => avisos.push(x))
    expect(res.yaExistia).toBe(false)
    expect(ejecutadas.filter((e) => e.startsWith('INSERT INTO "STA19"'))).toHaveLength(1)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE "STA19"'))).toHaveLength(0)
    expect(avisos.some((a) => /no tenía fila de stock/.test(a))).toBe(true)
  })
})
