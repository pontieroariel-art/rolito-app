import { describe, expect, it } from 'vitest'
import type { CajaSesion, Cobranza, DescargaCamion, Liquidacion, RemitoCarga, Rendicion, Sobre, VentaCamion, VentaVentanilla } from '@/types'
import { efectivoPorEmpresa, estadoCaja, resumenLive, sinDevolver } from './tesoreriaLive'

const ts = { toMillis: () => 0, toDate: () => new Date(0) } as unknown as VentaCamion['fecha']
const vc = (x: Partial<VentaCamion>): VentaCamion => ({ id: 'v', canal: 'contado', camionId: 'cam', choferId: 'ch1', choferNombre: 'Pedro', clienteId: 'c', clienteNombre: 'C', items: [{ productoId: 'bolsa_10kg', nombre: 'B10', cantidad: 10, precioUnitario: 100 }], total: 1000, formaPago: 'contado_efectivo', fecha: ts, ...x } as VentaCamion)
const vv = (x: Partial<VentaVentanilla>): VentaVentanilla => ({ id: 'w', plantaId: 'torcuato', canal: 'contado', cajaId: 'u1', cajaNombre: 'Nico', clienteNombre: 'K', items: [{ productoId: 'barra', nombre: 'Barra', cantidad: 3, precioUnitario: 500 }], total: 1500, formaPago: 'contado_efectivo', estado: 'pendiente_entrega', turno: 1, turnoEstado: 'en_espera', fecha: ts, ...x } as VentaVentanilla)
const cob = (x: Partial<Cobranza>): Cobranza => ({ id: 'c', origen: 'cobrador', registradoPor: { uid: 'ch1', nombre: 'Pedro' }, clienteId: 'k', clienteNombre: 'K', importe: 400, formaPago: 'contado_efectivo', fecha: ts, ...x } as Cobranza)

describe('resumenLive', () => {
  const remitos = [{ id: 'r1', choferId: 'ch1', choferNombre: 'Pedro', depositoTango: '03', items: [{ productoId: 'bolsa_10kg', nombre: 'B10', cantidad: 100 }] } as RemitoCarga, { id: 'r2', choferId: 'ch2', choferNombre: 'Gabriel', items: [] } as unknown as RemitoCarga]
  const ventasCamion = [vc({ id: 'a' }), vc({ id: 'b', canal: 'promo', total: 300, formaPago: 'cuenta_corriente', items: [{ productoId: 'bolsa_3kg', nombre: 'B3', cantidad: 5, precioUnitario: 60 }] })]
  const ventasVentanilla = [vv({ id: 'w1' }), vv({ id: 'w2', cajaId: 'u2', cajaNombre: 'Cris', formaPago: 'contado_transferencia', total: 700 }), vv({ id: 'w3', plantaId: 'merlo', cajaId: 'u3', cajaNombre: 'Merlo', canal: 'promo', total: 200 })]
  const cobranzas = [
    cob({ id: 'c1' }),
    cob({ id: 'c2', origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'u1', nombre: 'Nico' }, importe: 250 }),
    cob({ id: 'c3', origen: 'supervisor', registradoPor: { uid: 's1', nombre: 'Matias' }, importe: 1300, formaPago: 'mixto', medios: { efectivo: 200, transferencia: 100, cheques: [{ numero: '1', bancoCodigo: '007', bancoNombre: 'G', fechaEmision: '', fechaAcreditacion: '', dias: 0, importe: 900 }], retenciones: [{ tipo: 'iva', nroCertificado: '2', importe: 100 }] } }),
  ]
  const liquidaciones = [{ id: 'l', choferId: 'ch1', choferNombre: 'Pedro', efectivoARendir: 1400, efectivoRecibido: 1400, diferenciaEfectivo: 0 } as Liquidacion]
  const rendiciones = [{ id: 'rd', tipo: 'mostrador', plantaId: 'torcuato', sujetoId: 'u2', sujetoNombre: 'Cris', validacion: { uid: 't', nombre: 'T' } } as unknown as Rendicion]
  const r = resumenLive({ ventasCamion, ventasVentanilla, cobranzas, remitos, liquidaciones, rendiciones })

  it('calle: por chofer, con carga, ventas por canal, bultos, cobranzas y estado', () => {
    expect(r.calle.map((f) => f.nombre)).toEqual(['Gabriel', 'Pedro'])
    const pedro = r.calle[1]
    expect(pedro).toMatchObject({ deposito: '03', remitos: 1, cargaBultos: 100, bultosVendidos: 15, estado: 'liquidado' })
    expect(pedro.contado).toEqual({ cantidad: 1, efectivo: 1000, transferencia: 0, cuentaCorriente: 0, total: 1000 })
    expect(pedro.promo).toEqual({ cantidad: 1, efectivo: 0, transferencia: 0, cuentaCorriente: 300, total: 300 })
    expect(pedro.cobranzas.efectivo).toBe(400)
    expect(pedro.liquidacion?.id).toBe('l')
    expect(r.calle[0].estado).toBe('cargado')
  })
  it('ventanilla: por planta y cajero, con bultos, cobranzas de mostrador y estado del cierre', () => {
    expect(r.ventanilla.torcuato.map((f) => f.nombre)).toEqual(['Cris', 'Nico'])
    const nico = r.ventanilla.torcuato[1]
    expect(nico.contado.efectivo).toBe(1500)
    expect(nico.bultos).toEqual([{ productoId: 'barra', nombre: 'Barra', cantidad: 3 }])
    expect(nico.cobranzas.efectivo).toBe(250)
    expect(nico.estado).toBe('sin_turno')   // sin turno de caja ni cierre viejo
    expect(r.ventanilla.torcuato[0]).toMatchObject({ estado: 'validada', contado: { transferencia: 700 } })
    expect(r.ventanilla.merlo[0]).toMatchObject({ nombre: 'Merlo', promo: { efectivo: 200 } })
  })
  it('supervisores: cobranzas por medio', () => {
    expect(r.supervisores).toMatchObject([{ uid: 's1', nombre: 'Matias', cobranzas: { cantidad: 1, efectivo: 200, transferencia: 100, cheques: { cantidad: 1, total: 900 }, retenciones: { cantidad: 1, total: 100 }, total: 1300 } }])
  })
  it('totales y efectivo del día', () => {
    expect(r.totales.ventasCalle.contado.total).toBe(1000)
    expect(r.totales.ventasVentanilla.contado.total).toBe(2200)
    expect(r.totales.ventasVentanilla.promo.efectivo).toBe(200)
    expect(r.totales.cobranzas.calle.efectivo).toBe(400)
    expect(r.totales.cobranzas.ventanilla.efectivo).toBe(250)
    expect(r.totales.cobranzas.supervisores.cheques.total).toBe(900)
    expect(r.totales.efectivoDelDia).toBe(1000 + 1500 + 200 + 400 + 250 + 200)
  })
  it('vacío', () => {
    const v = resumenLive({ ventasCamion: [], ventasVentanilla: [], cobranzas: [], remitos: [], liquidaciones: [], rendiciones: [] })
    expect(v.calle).toEqual([]); expect(v.supervisores).toEqual([]); expect(v.totales.efectivoDelDia).toBe(0)
  })
})

describe('resumenLive — ventas de ventanilla anuladas', () => {
  it('una venta con nota de crédito emitida no suma en el cajero ni en los totales', () => {
    const r = resumenLive({
      ventasCamion: [], cobranzas: [], remitos: [], liquidaciones: [], rendiciones: [],
      ventasVentanilla: [vv({ id: 'w1', total: 1500 }), vv({ id: 'w2', total: 9000, anulacion: { estado: 'anulada', solicitudId: 'w2' } }), vv({ id: 'w3', total: 100, anulacion: { estado: 'pendiente', solicitudId: 'w3' } })],
    })
    expect(r.totales.ventasVentanilla.contado.efectivo).toBe(1600)
    expect(r.ventanilla.torcuato[0].contado).toMatchObject({ cantidad: 2, efectivo: 1600 })
    // Pero sigue en la lista una por una, con su anulación, para verla tachada.
    expect(r.ventanilla.torcuato[0].ventas.map((v) => v.id)).toEqual(['w1', 'w2', 'w3'])
  })
})

describe('resumenLive — detalle por cajero (ventas y recibos uno por uno)', () => {
  const t = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) } as unknown as VentaCamion['fecha'])
  it('las ventas y las cobranzas de mostrador del cajero van ordenadas por hora', () => {
    const r = resumenLive({
      ventasCamion: [], remitos: [], liquidaciones: [], rendiciones: [],
      ventasVentanilla: [vv({ id: 'tarde', fecha: t(3000) }), vv({ id: 'temprano', fecha: t(1000) }), vv({ id: 'otro', cajaId: 'u2', cajaNombre: 'Cris', fecha: t(2000) })],
      cobranzas: [
        cob({ id: 'r2', origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'u1', nombre: 'Nico' }, fecha: t(5000) }),
        cob({ id: 'r1', origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'u1', nombre: 'Nico' }, fecha: t(4000) }),
        cob({ id: 'sup', origen: 'supervisor', registradoPor: { uid: 'u1', nombre: 'Nico' }, fecha: t(4500) }),   // no es de mostrador
      ],
    })
    const nico = r.ventanilla.torcuato.find((f) => f.cajaId === 'u1')!
    expect(nico.ventas.map((v) => v.id)).toEqual(['temprano', 'tarde'])
    expect(nico.recibos.map((c) => c.id)).toEqual(['r1', 'r2'])
    expect(r.ventanilla.torcuato.find((f) => f.cajaId === 'u2')!.ventas.map((v) => v.id)).toEqual(['otro'])
  })
})

// ── Ventas en vivo / Tesorería en vivo (2026-09-16): por empresa, estados del camión y del turno, turnos ─────
describe('resumenLive — por empresa (tesorería)', () => {
  const ventasCamion = [
    vc({ id: 'a', total: 1000, factura: { estado: 'emitida', numero: 1, puntoVenta: 1, cbteTipo: 1, cae: '1', caeFchVto: '', importes: { fecha: '', neto: 1000, iva: 210, tributos: 0, total: 1210 } } }),   // contado con factura → Redonhielo, con IVA
    vc({ id: 'b', canal: 'promo', total: 300 }),                                                  // promo efectivo → Rolito
    vc({ id: 'c', canal: 'promo', total: 500, formaPago: 'cuenta_corriente' }),                  // cta. cte.: no es plata
    vc({ id: 'd', total: 700, formaPago: 'contado_transferencia' }),                              // transferencia: informativa
  ]
  const cobranzas = [
    cob({ id: 'c1', importe: 400 }),                                                              // cobrador sin empresa → Redonhielo
    cob({ id: 'c2', origen: 'supervisor', registradoPor: { uid: 's1', nombre: 'Matias' }, empresa: 'rolito', importe: 150 }),
    cob({ id: 'c3', origen: 'supervisor', registradoPor: { uid: 's1', nombre: 'Matias' }, empresa: 'redonhielo', importe: 900, formaPago: 'mixto', medios: { efectivo: 0, transferencia: 0, cheques: [{ numero: '1', bancoCodigo: '007', bancoNombre: 'G', fechaEmision: '', fechaAcreditacion: '', dias: 0, importe: 800 }], retenciones: [{ tipo: 'iva', nroCertificado: '2', importe: 100 }] } }),
    cob({ id: 'c4', origen: 'caja', plantaId: 'torcuato', registradoPor: { uid: 'u1', nombre: 'Nico' }, importe: 250 }),
  ]
  const r = resumenLive({ ventasCamion, ventasVentanilla: [vv({ id: 'w1', canal: 'promo', total: 60 })], cobranzas, remitos: [], liquidaciones: [], rendiciones: [] })

  it('el chofer: contado con factura a Redonhielo (con IVA), promo a Rolito, cta. cte. afuera, transferencia aparte', () => {
    const pedro = r.calle[0]
    expect(pedro.porEmpresa.redonhielo).toEqual({ efectivo: 1210 + 400, transferencia: 700, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } })
    expect(pedro.porEmpresa.rolito).toEqual({ efectivo: 300, transferencia: 0, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } })
    expect(efectivoPorEmpresa(pedro.porEmpresa)).toBe(1910)
  })
  it('el supervisor: cada recibo a su empresa, cheques y retenciones en la suya', () => {
    const m = r.supervisores[0]
    expect(m.porEmpresa.rolito.efectivo).toBe(150)
    expect(m.porEmpresa.redonhielo).toEqual({ efectivo: 0, transferencia: 0, cheques: { cantidad: 1, total: 800 }, retenciones: { cantidad: 1, total: 100 } })
  })
  it('el cajero y los totales del día', () => {
    const nico = r.ventanilla.torcuato[0]
    expect(nico.porEmpresa.rolito.efectivo).toBe(60)
    expect(nico.porEmpresa.redonhielo.efectivo).toBe(250)
    expect(r.totales.porEmpresa.redonhielo).toEqual({ efectivo: 1610 + 250, transferencia: 700, cheques: { cantidad: 1, total: 800 }, retenciones: { cantidad: 1, total: 100 } })
    expect(r.totales.porEmpresa.rolito.efectivo).toBe(300 + 150 + 60)
    expect(efectivoPorEmpresa(r.totales.porEmpresa)).toBe(r.totales.efectivoDelDia)
  })
})

describe('resumenLive — estado del camión (ventas)', () => {
  const remito = (x: Partial<RemitoCarga>): RemitoCarga => ({ id: 'r', choferId: 'ch1', choferNombre: 'Pedro', items: [{ productoId: 'b', nombre: 'B', cantidad: 100 }], ...x } as RemitoCarga)
  const desc = (x: Partial<DescargaCamion>): DescargaCamion => ({ id: 'd', choferId: 'ch1', choferNombre: 'Pedro', items: [{ productoId: 'b', nombre: 'B', cantidad: 40 }], bolsasRotas: [], ...x } as DescargaCamion)
  const base = { ventasVentanilla: [], cobranzas: [], liquidaciones: [], rendiciones: [] }
  it('cargado → vendiendo → volvió → descargado → liquidado', () => {
    expect(resumenLive({ ...base, ventasCamion: [], remitos: [remito({})] }).calle[0].estado).toBe('cargado')
    expect(resumenLive({ ...base, ventasCamion: [vc({})], remitos: [remito({})] }).calle[0].estado).toBe('vendiendo')
    expect(resumenLive({ ...base, ventasCamion: [vc({})], remitos: [remito({ regreso: { uid: 'ch1', nombre: 'Pedro', hora: ts } })] }).calle[0]).toMatchObject({ estado: 'volvio', volvio: true })
    const contado = resumenLive({ ...base, ventasCamion: [vc({})], remitos: [remito({ regreso: { uid: 'ch1', nombre: 'Pedro', hora: ts } })], descargas: [desc({})] }).calle[0]
    expect(contado).toMatchObject({ estado: 'descargado', descargas: 1, bultosDescargados: 40 })
    expect(resumenLive({ ...base, ventasCamion: [vc({})], remitos: [remito({})], descargas: [desc({})], liquidaciones: [{ id: 'l', choferId: 'ch1', choferNombre: 'Pedro' } as Liquidacion] }).calle[0].estado).toBe('liquidado')
  })
  it('una descarga rectificada cuenta una sola vez (vale la corrección)', () => {
    const r = resumenLive({ ...base, ventasCamion: [], remitos: [remito({})], descargas: [desc({ id: 'd1' }), desc({ id: 'd2', rectificaA: 'd1', items: [{ productoId: 'b', nombre: 'B', cantidad: 45 }] })] })
    expect(r.calle[0]).toMatchObject({ descargas: 1, bultosDescargados: 45 })
    expect(r.totales.bultos).toEqual({ cargadosCalle: 100, vendidosCalle: 0, descargadosCalle: 45, vendidosVentanilla: 0 })
  })
  it('la liquidación de un supervisor (solo cobranzas) no inventa una fila de calle', () => {
    const r = resumenLive({ ...base, ventasCamion: [], remitos: [], cobranzas: [cob({ id: 's', origen: 'supervisor', registradoPor: { uid: 's1', nombre: 'Matias' } })], liquidaciones: [{ id: 'l', choferId: 's1', choferNombre: 'Matias' } as Liquidacion] })
    expect(r.calle).toEqual([])
    expect(r.supervisores[0].liquidacion?.id).toBe('l')
  })
})

describe('resumenLive — por producto (Ventas en vivo, 2026-09-16)', () => {
  const remito = (choferId: string, items: { productoId: string; nombre: string; cantidad: number }[]): RemitoCarga => ({ id: 'r' + choferId, choferId, choferNombre: choferId, items } as RemitoCarga)
  const it10 = (cantidad: number) => ({ productoId: 'bolsa_10kg', nombre: 'B10', cantidad, precioUnitario: 100 })
  const it3  = (cantidad: number) => ({ productoId: 'bolsa_3kg', nombre: 'B3', cantidad, precioUnitario: 50 })
  const r = resumenLive({
    remitos: [remito('ch1', [it10(100), it3(50)]), remito('ch2', [it10(80)])],
    ventasCamion: [vc({ id: 'a', choferId: 'ch1', choferNombre: 'ch1', items: [it10(30)] }), vc({ id: 'b', choferId: 'ch1', choferNombre: 'ch1', canal: 'promo', items: [it3(10), it10(5)] }), vc({ id: 'c', choferId: 'ch2', choferNombre: 'ch2', items: [it10(20)] }), vc({ id: 'anulada', choferId: 'ch2', choferNombre: 'ch2', items: [it10(99)], anulacion: { estado: 'anulada', solicitudId: 'x' } })],
    ventasVentanilla: [vv({ id: 'w', canal: 'promo', items: [it3(7)] })],
    descargas: [{ id: 'd', choferId: 'ch1', choferNombre: 'ch1', items: [it10(64), it3(40)], bolsasRotas: [] } as unknown as DescargaCamion],
    cobranzas: [], liquidaciones: [], rendiciones: [],
  })
  it('el día: cargado, vendido en la calle y en ventanilla por empresa más el total, y lo que volvió (las anuladas no cuentan)', () => {
    expect(r.totales.productos).toEqual([
      { productoId: 'bolsa_10kg', nombre: 'B10', cargado: 180, vendidoCalle: { redonhielo: 50, rolito: 5, total: 55 }, vendidoVentanilla: { redonhielo: 0, rolito: 0, total: 0 }, descargado: 64 },
      { productoId: 'bolsa_3kg',  nombre: 'B3',  cargado: 50,  vendidoCalle: { redonhielo: 0, rolito: 10, total: 10 }, vendidoVentanilla: { redonhielo: 0, rolito: 7, total: 7 }, descargado: 40 },
    ])
  })
  it('cada repartidor con sus productos; "sin devolver" es lo que sigue en el camión o falta', () => {
    const ch1 = r.calle.find((f) => f.choferId === 'ch1')!
    expect(ch1.productos).toEqual([
      { productoId: 'bolsa_10kg', nombre: 'B10', cargado: 100, vendidoCalle: { redonhielo: 30, rolito: 5, total: 35 }, vendidoVentanilla: { redonhielo: 0, rolito: 0, total: 0 }, descargado: 64 },
      { productoId: 'bolsa_3kg',  nombre: 'B3',  cargado: 50,  vendidoCalle: { redonhielo: 0, rolito: 10, total: 10 }, vendidoVentanilla: { redonhielo: 0, rolito: 0, total: 0 }, descargado: 40 },
    ])
    expect(sinDevolver(ch1.productos[0])).toBe(1)    // 100 − 35 − 64: falta una bolsa
    expect(sinDevolver(ch1.productos[1])).toBe(0)
    const ch2 = r.calle.find((f) => f.choferId === 'ch2')!
    expect(sinDevolver(ch2.productos[0])).toBe(60)   // sigue en el camión
  })
})

describe('resumenLive — turnos de ventanilla y estado del cajero (turno + sobre)', () => {
  const sesion = (x: Partial<CajaSesion>): CajaSesion => ({ id: 'd_u1_1', plantaId: 'torcuato', cajero: { uid: 'u1', nombre: 'Nico' }, fecha: 'd', numero: 1, estado: 'abierta', ...x } as CajaSesion)
  const sobre = (x: Partial<Sobre>): Sobre => ({ id: 'd_u1_1', tipo: 'ventanilla', plantaId: 'torcuato', rindio: { uid: 'u1', nombre: 'Nico', rol: 'caja' }, numero: 1, estado: 'pendiente_recepcion', ...x } as Sobre)
  const base = { ventasCamion: [], cobranzas: [], remitos: [], liquidaciones: [], rendiciones: [] }
  it('turnos vendidos, entregados y en cola, y bultos de ventanilla', () => {
    const r = resumenLive({ ...base, ventasVentanilla: [vv({ id: 'a', estado: 'entregado' }), vv({ id: 'b' }), vv({ id: 'c', turnoEstado: 'llamado' })] })
    expect(r.ventanilla.torcuato[0].turnos).toEqual({ vendidos: 3, entregados: 1, enCola: 2 })
    expect(r.totales.turnos).toEqual({ vendidos: 3, entregados: 1, enCola: 2 })
    expect(r.totales.bultos.vendidosVentanilla).toBe(9)
  })
  it('un cajero con turno abierto y sin ventas es una fila igual', () => {
    const r = resumenLive({ ...base, ventasVentanilla: [], sesiones: [sesion({})] })
    expect(r.ventanilla.torcuato).toMatchObject([{ cajaId: 'u1', nombre: 'Nico', estado: 'abierta', turnos: { vendidos: 0 } }])
  })
  it('estado: sin turno → abierta → en camino → recibida; el cierre viejo sigue valiendo', () => {
    expect(estadoCaja({ sesion: null, sobre: null, rendicion: null })).toBe('sin_turno')
    expect(estadoCaja({ sesion: sesion({}), sobre: null, rendicion: null })).toBe('abierta')
    expect(estadoCaja({ sesion: sesion({ estado: 'cerrada' }), sobre: sobre({}), rendicion: null })).toBe('en_camino')
    expect(estadoCaja({ sesion: sesion({ estado: 'cerrada' }), sobre: sobre({ estado: 'recibida' }), rendicion: null })).toBe('recibida')
    // Reabrió después de rendir: manda el turno abierto.
    expect(estadoCaja({ sesion: sesion({ numero: 2 }), sobre: sobre({}), rendicion: null })).toBe('abierta')
    expect(estadoCaja({ sesion: null, sobre: null, rendicion: { validacion: null } as Rendicion })).toBe('cerrada')
    expect(estadoCaja({ sesion: null, sobre: null, rendicion: { validacion: { uid: 't', nombre: 'T' } } as unknown as Rendicion })).toBe('validada')
  })
  it('con varios turnos y sobres en el día se queda con el último', () => {
    const r = resumenLive({ ...base, ventasVentanilla: [], sesiones: [sesion({ id: 'd_u1_1', numero: 1, estado: 'cerrada' }), sesion({ id: 'd_u1_2', numero: 2 })], sobres: [sobre({ id: 'd_u1_1', numero: 1, estado: 'recibida' })] })
    expect(r.ventanilla.torcuato[0]).toMatchObject({ sesion: { numero: 2 }, sobre: { numero: 1 }, estado: 'abierta' })
  })
})
