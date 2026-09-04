import { describe, it, expect } from 'vitest'
import { remitoDeVenta, sentenciasRemito, escribirRemito, sentenciaExiste, type DatosRemito, type ConfigRemitoSql } from './remito'
import type { EjecutorSql, ParametroSql } from './tipos'
import type { PayloadVenta } from '../pedido'

const cfg: ConfigRemitoSql = { talonario: 1105, puntoVenta: 1105, codigoTransporte: '01', usuario: 'ROLITO', terminal: 'APP' }
const articulos = { bolsa_10kg: 'PTHIBOLROLI0010', bolsa_3kg: 'PTHIBOLROLI0003', cambio_bolsa_10kg: 'PTHIBOLROLI0010' }

const venta: PayloadVenta = {
  canal: 'contado', formaPago: 'cuenta_corriente', choferId: 'ch1', camionId: 'cam1',
  clienteCodigoTango: 'FC.280', clienteIdGva14Tango: 8465,
  items: [{ productoId: 'bolsa_10kg', nombre: 'Bolsa 10', cantidad: 3, precioUnitario: 5200 }, { productoId: 'bolsa_3kg', nombre: 'Bolsa 3', cantidad: 2, precioUnitario: 3480 }],
  cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio', cantidad: 1, precioUnitario: 0 }],
  total: 22560,
  fecha: { seconds: Math.floor(new Date(2026, 8, 4, 10, 30).getTime() / 1000) },
  comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 17 },
}

const datos: DatosRemito = {
  ncompInS: '00407670', condVta: 2, idDireccionEntrega: 8470, nroSucursalDestino: 2,
  articulos: {
    PTHIBOLROLI0010: { idMedidaStock: 17, idMedidaVentas: 17, stockActual: 48857 },
    PTHIBOLROLI0003: { idMedidaStock: 17, idMedidaVentas: 17, stockActual: 120 },
  },
}

const param = (ps: ParametroSql[], nombre: string) => ps.find((p) => p.nombre === nombre)?.valor

describe('remitoDeVenta', () => {
  it('arma el número como Tango (letra + pv 5 + nº 8) y suma cambios al mismo artículo', () => {
    const r = remitoDeVenta(venta, 'abc123', articulos, '03', 1105)
    expect(r.nComp).toBe('R0110500000017')
    expect(r.codCliente).toBe('FC.280')
    expect(r.codDeposito).toBe('03')
    expect(r.renglones).toEqual([{ codArticu: 'PTHIBOLROLI0010', cantidad: 4 }, { codArticu: 'PTHIBOLROLI0003', cantidad: 2 }])
    expect(r.observacion).toBe('ROLITO:VC:abc123')
    expect(r.fecha.getFullYear()).toBe(2026)
  })
  it('rechaza ventas sin remito numerado o sin cliente de Tango', () => {
    expect(() => remitoDeVenta({ ...venta, comprobanteInterno: { tipo: 'facturaX', numero: 1 } }, 'x', articulos, '03', 1105)).toThrow(/remito interno/)
    expect(() => remitoDeVenta({ ...venta, clienteCodigoTango: undefined }, 'x', articulos, '03', 1105)).toThrow(/clienteCodigoTango/)
    expect(() => remitoDeVenta({ ...venta, items: [{ productoId: 'raro', nombre: 'x', cantidad: 1, precioUnitario: 1 }], cambios: [] }, 'x', articulos, '03', 1105)).toThrow(/config\/tango.articulos/)
  })
})

describe('sentenciasRemito', () => {
  const r = remitoDeVenta(venta, 'abc123', articulos, '03', 1105)
  const ahora = new Date(2026, 8, 4, 10, 31, 9)
  const ss = sentenciasRemito(r, datos, cfg, ahora)

  it('produce cabecera, un renglón por artículo y un update de stock por artículo, en ese orden', () => {
    expect(ss.map((s) => s.etiqueta)).toEqual([
      'INSERT STA14', 'INSERT STA20 PTHIBOLROLI0010', 'INSERT STA20 PTHIBOLROLI0003',
      'UPDATE STA19 stock PTHIBOLROLI0010', 'UPDATE STA19 stock PTHIBOLROLI0003',
    ])
  })
  it('la cabecera copia los valores de la traza real de Tango', () => {
    const p = ss[0].params
    expect(ss[0].params).toHaveLength(60)
    expect(ss[0].sql).toContain('SELECT SCOPE_IDENTITY()')
    expect(param(p, 'T_COMP')).toBe('REM')
    expect(param(p, 'TCOMP_IN_S')).toBe('RE')
    expect(param(p, 'N_COMP')).toBe('R0110500000017')
    expect(param(p, 'N_REMITO')).toBe('R0110500000017')
    expect(param(p, 'NCOMP_IN_S')).toBe('00407670')
    expect(param(p, 'TALONARIO')).toBe(1105)
    expect(param(p, 'ESTADO_MOV')).toBe('P')
    expect(param(p, 'MOTIVO_REM')).toBe('V')
    expect(param(p, 'COD_PRO_CL')).toBe('FC.280')
    expect(param(p, 'COD_DEPOSI')).toBe('03')
    expect(param(p, 'COD_TRANSP')).toBe('01')
    expect(param(p, 'COND_VTA')).toBe(2)
    expect(param(p, 'ID_DIRECCION_ENTREGA')).toBe(8470)
    expect(param(p, 'LEYENDA1')).toBe('ROLITO:VC:abc123')
    expect(param(p, 'HORA_COMP')).toBe('103109')
    expect(param(p, 'USUARIO')).toBe('ROLITO')
    expect((param(p, 'FECHA_MOV') as Date).getHours()).toBe(0)
    expect((param(p, 'FECHA_ANU') as Date).getFullYear()).toBe(1800)
    expect(param(p, 'HORA_ANU')).toBe('')
  })
  it('los renglones salen del depósito con cantidad y pendiente iguales, sin precio', () => {
    const p = ss[1].params
    expect(ss[1].params).toHaveLength(50)
    expect(param(p, 'COD_ARTICU')).toBe('PTHIBOLROLI0010')
    expect(param(p, 'CANTIDAD')).toBe(4)
    expect(param(p, 'CANT_PEND')).toBe(4)
    expect(param(p, 'CAN_EQUI_V')).toBe(4)
    expect(param(p, 'TIPO_MOV')).toBe('S')
    expect(param(p, 'N_RENGL_S')).toBe(1)
    expect(param(ss[2].params, 'N_RENGL_S')).toBe(2)
    expect(param(p, 'PRECIO')).toBe(0)
    expect(param(p, 'ID_MEDIDA_STOCK')).toBe(17)
    expect(param(p, 'NCOMP_IN_S')).toBe('00407670')
  })
  it('el stock se descuenta con concurrencia optimista sobre el valor leído', () => {
    const p = ss[3].params
    expect(param(p, 'CANT_ANTERIOR')).toBe(48857)
    expect(param(p, 'CANT_NUEVA')).toBe(48853)
    expect(ss[3].sql).toContain('"CANT_STOCK" = @CANT_ANTERIOR')
    expect(param(ss[4].params, 'CANT_NUEVA')).toBe(118)
  })
  it('todos los parámetros tienen tipo SQL explícito', () => {
    for (const s of ss) for (const p of s.params) expect(p.tipo.kind).toBeTruthy()
  })
})

// Fake de la base: responde a cada consulta según su texto y registra lo ejecutado.
function fakeDb(opts: { existe?: boolean; stockCambia?: boolean } = {}) {
  const ejecutadas: string[] = []
  const db: EjecutorSql = {
    async query<T>(sql: string, params: ParametroSql[] = []): Promise<T[]> {
      ejecutadas.push(sql.split(' ').slice(0, 3).join(' '))
      const r = (rows: unknown[]) => rows as T[]
      if (sql.startsWith('SELECT ID_STA14, NCOMP_IN_S')) return r(opts.existe ? [{ ID_STA14: 99, NCOMP_IN_S: '00407000' }] : [])
      if (sql.startsWith('SELECT ID_GVA14, COND_VTA')) return r([{ ID_GVA14: 8465, COND_VTA: 2 }])
      if (sql.startsWith('SELECT TOP 1 ID_DIRECCION_ENTREGA')) return r([{ ID_DIRECCION_ENTREGA: 8470, NRO_SUCURSAL: 2 }])
      if (sql.includes('INCREMENTAL_VALUE') && sql.startsWith('SELECT')) return r([])
      if (sql.startsWith('SELECT MAX(NCOMP_IN_S)')) return r([{ MAXN: '00407669' }])
      if (sql.startsWith('SELECT ID_MEDIDA_STOCK')) return r([{ ID_MEDIDA_STOCK: 17, ID_MEDIDA_VENTAS: 17 }])
      if (sql.startsWith('SELECT CANT_STOCK')) return r([{ CANT_STOCK: param(params, 'COD') === 'PTHIBOLROLI0010' ? 48857 : 120 }])
      if (sql.startsWith('INSERT INTO "STA14"')) return r([{ ID: 555 }])
      if (sql.startsWith('INSERT INTO "STA20"')) return r([{ ID: 1 }])
      if (sql.startsWith('UPDATE "STA19"')) return r([{ affected: opts.stockCambia ? 0 : 1 }])
      throw new Error('consulta inesperada: ' + sql)
    },
  }
  return { db, ejecutadas }
}

describe('escribirRemito', () => {
  const r = remitoDeVenta(venta, 'abc123', articulos, '03', 1105)
  it('lee, inserta y descuenta; devuelve el id y el número interno', async () => {
    const { db, ejecutadas } = fakeDb()
    const res = await escribirRemito(db, r, cfg)
    expect(res).toEqual({ yaExistia: false, idSta14: 555, ncompInS: '00407670', nComp: 'R0110500000017' })
    expect(ejecutadas.filter((e) => e.startsWith('INSERT'))).toHaveLength(3)
    expect(ejecutadas.filter((e) => e.startsWith('UPDATE "STA19"'))).toHaveLength(2)
  })
  it('si el remito ya existe no escribe nada (idempotente)', async () => {
    const { db, ejecutadas } = fakeDb({ existe: true })
    const res = await escribirRemito(db, r, cfg)
    expect(res.yaExistia).toBe(true)
    expect(res.idSta14).toBe(99)
    expect(ejecutadas).toHaveLength(1)
    expect(sentenciaExiste(r).params[0].valor).toBe('R0110500000017')
  })
  it('si el stock cambió entre la lectura y el update, falla para que la transacción se revierta', async () => {
    const { db } = fakeDb({ stockCambia: true })
    await expect(escribirRemito(db, r, cfg)).rejects.toThrow(/stock cambió/)
  })
})
