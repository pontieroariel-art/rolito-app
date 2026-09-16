import { describe, it, expect } from 'vitest'
import type { CajaSesion, Cobranza, Liquidacion, Sobre, SobreSistema, VentaVentanilla } from '@/types'
import {
  antiguedadHoras, codigoSobre, conformidadDe, contadorDeSobre, custodiaDePlanta, custodioDe, diferenciaDeclarada,
  diferenciaPorEmpresaSobre, diferenciaRecepcion, fajosDe, hayDiferencia, recibidosSinMotivo, sistemaVentanilla, sobreId, valoresSinDecidir,
} from './sobres'

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as import('firebase/firestore').Timestamp

const venta = (id: string, total: number, formaPago: VentaVentanilla['formaPago'], canal: VentaVentanilla['canal'] = 'contado'): VentaVentanilla =>
  ({ id, total, formaPago, canal, items: [], fecha: ts(0) } as unknown as VentaVentanilla)

const cobranza = (id: string, efectivo: number, cheques: { numero: string; importe: number }[] = []): Cobranza =>
  ({ id, importe: efectivo + cheques.reduce((s, c) => s + c.importe, 0), clienteNombre: 'Cliente', numeroRecibo: `RS-${id}`,
     medios: { efectivo, transferencia: 0, cheques: cheques.map((c) => ({ ...c, bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '2026-09-14', fechaAcreditacion: '2026-09-20', dias: 6 })), retenciones: [] } } as unknown as Cobranza)

const liquidacion = (id: string, efectivoRecibido: number, cheques: Liquidacion['cheques'] = []): Liquidacion =>
  ({ id, choferId: 'ch1', choferNombre: 'Chofer', efectivoARendir: efectivoRecibido, efectivoRecibido, diferenciaEfectivo: 0, cheques, retenciones: [] } as unknown as Liquidacion)

describe('ids y códigos', () => {
  it('ventanilla lleva el turno en el id; cobrador y chofer uno por día', () => {
    expect(sobreId('ventanilla', '2026-09-14', 'u1', 2)).toBe('2026-09-14_u1_2')
    expect(sobreId('cobrador', '2026-09-14', 'u1')).toBe('2026-09-14_u1')
  })
  it('series: RV por planta, RC global, RQ por depósito', () => {
    expect(codigoSobre('ventanilla', 12, { plantaId: 'torcuato' })).toBe('RV-DT-000012')
    expect(codigoSobre('cobrador', 45, {})).toBe('RC-000045')
    expect(codigoSobre('chofer', 15, { deposito: '21' })).toBe('RQ-21-000015')
    expect(contadorDeSobre('ventanilla', { plantaId: 'merlo' })).toBe('sobreVentanillaCounter_merlo')
  })
})

describe('sistemaVentanilla', () => {
  const ventas = [venta('v1', 1000, 'contado_efectivo'), venta('v2', 500, 'contado_transferencia'), venta('v3', 300, 'contado_efectivo', 'promo'), venta('v4', 900, 'cuenta_corriente')]
  const cobranzas = [cobranza('c1', 200, [{ numero: '111', importe: 5000 }])]
  const liqs = [liquidacion('l1', 700, [{ cobranzaId: 'cx', clienteNombre: 'X', numero: '222', bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '', fechaAcreditacion: '', dias: 0, importe: 3000, recibido: true }, { cobranzaId: 'cy', clienteNombre: 'Y', numero: '333', bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '', fechaAcreditacion: '', dias: 0, importe: 100, recibido: false, motivoNoEntregado: 'lo perdió' }])]

  it('suma fondo + efectivo de ventas (contado y promo) + cobranzas + lo recibido de choferes; nada de transferencias ni cta. cte.', () => {
    const s = sistemaVentanilla({ fondoInicial: 0, ventas, cobranzas, liquidacionesRecibidas: liqs, sobresRecibidos: [] })
    expect(s.efectivo).toBe(1000 + 300 + 200 + 700)
    expect(s.detalle).toEqual({ fondoInicial: 0, ventasEfectivo: 1300, cobranzasEfectivo: 200, recibidoDeLiquidaciones: 700, recibidoDeSobres: 0 })
    expect(s.transferencias.total).toBe(500)
    expect(s.origenIds).toEqual({ ventasIds: ['v1', 'v2', 'v3', 'v4'], cobranzasIds: ['c1'], liquidacionesIds: ['l1'], sobresRecibidosIds: [] })
  })
  it('los cheques son los propios más los que el chofer SÍ entregó; el que no entregó no viaja', () => {
    const s = sistemaVentanilla({ fondoInicial: 0, ventas, cobranzas, liquidacionesRecibidas: liqs, sobresRecibidos: [] })
    expect(s.cheques.map((c) => c.numero)).toEqual(['111', '222'])
  })
  it('por empresa (2026-09-16): contado → Redonhielo, promo → Rolito, cada cobranza con la suya, lo del chofer según su conteo; cta. cte. y transferencias afuera del efectivo', () => {
    const cobRolito = { ...cobranza('c2', 150), empresa: 'rolito' } as Cobranza
    const liqConConteo = { ...liquidacion('l2', 900), conteoBilletes: { redonhielo: { total: 600 }, rolito: { total: 300 } } } as unknown as Liquidacion
    const s = sistemaVentanilla({ fondoInicial: 0, ventas, cobranzas: [...cobranzas, cobRolito], liquidacionesRecibidas: [...liqs, liqConConteo], sobresRecibidos: [] })
    const pe = s.porEmpresa!
    expect(pe.redonhielo).toMatchObject({ ventasEfectivo: 1000, cobranzasEfectivo: 200, recibidoDeLiquidaciones: 700 + 600, efectivo: 2500, transferencias: 500, cheques: { cantidad: 2, total: 8000 } })
    expect(pe.rolito).toMatchObject({ ventasEfectivo: 300, cobranzasEfectivo: 150, recibidoDeLiquidaciones: 300, efectivo: 750, transferencias: 0, cheques: { cantidad: 0, total: 0 } })
    expect(pe.redonhielo.efectivo + pe.rolito.efectivo).toBe(s.efectivo)
  })
  it('fajos: Rolito exacto, Redonhielo el resto con la diferencia; si lo contado no alcanza, Rolito se lleva todo', () => {
    const pe = { redonhielo: { efectivo: 2500 }, rolito: { efectivo: 750 } } as unknown as NonNullable<SobreSistema['porEmpresa']>
    expect(fajosDe(pe, 3250)).toEqual({ redonhielo: 2500, rolito: 750 })
    expect(fajosDe(pe, 3200)).toEqual({ redonhielo: 2450, rolito: 750 })
    expect(diferenciaPorEmpresaSobre(pe, fajosDe(pe, 3200))).toEqual({ redonhielo: -50, rolito: 0 })
    expect(fajosDe(pe, 500)).toEqual({ redonhielo: 0, rolito: 500 })
    expect(diferenciaPorEmpresaSobre(pe, fajosDe(pe, 500))).toEqual({ redonhielo: -2500, rolito: -250 })
    expect(fajosDe(undefined, 100)).toEqual({ redonhielo: 100, rolito: 0 })
  })
  it('el fondo inicial entra al efectivo', () => {
    const s = sistemaVentanilla({ fondoInicial: 50000, ventas: [], cobranzas: [], liquidacionesRecibidas: [], sobresRecibidos: [] })
    expect(s.efectivo).toBe(50000)
  })
})

describe('diferencias', () => {
  const sistema: SobreSistema = {
    efectivo: 2200,
    cheques: [{ cobranzaId: 'c1', clienteNombre: 'A', numero: '111', bancoCodigo: '011', bancoNombre: 'N', fechaEmision: '', fechaAcreditacion: '', dias: 0, importe: 5000 }],
    retenciones: [{ cobranzaId: 'c2', clienteNombre: 'B', tipo: 'iibb_pba', nroCertificado: '77', importe: 800 }],
    transferencias: { cantidad: 0, total: 0 },
    origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] },
  }
  it('declaró de menos y le falta la retención: negativo, con el valor faltante sumado aparte', () => {
    const d = diferenciaDeclarada(sistema, { efectivo: 2000, cheques: [{ clave: 'c1|cheque|111', presente: true }], retenciones: [{ clave: 'c2|ret|77', presente: false }] })
    expect(d).toEqual({ efectivo: -200, valoresFaltantes: { cantidad: 1, total: 800 } })
    expect(hayDiferencia(d)).toBe(true)
    expect(conformidadDe(d)).toBe('con_diferencia')
  })
  it('conforme cuando coincide todo', () => {
    const d = diferenciaRecepcion(sistema, { efectivoContado: 2200, cheques: [{ clave: 'c1|cheque|111', recibido: true }], retenciones: [{ clave: 'c2|ret|77', recibido: true }] })
    expect(d).toEqual({ efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } })
    expect(conformidadDe(d)).toBe('conforme')
  })
  it('un sobrante de efectivo NO compensa un cheque que falta', () => {
    const d = diferenciaRecepcion(sistema, { efectivoContado: 7200, cheques: [{ clave: 'c1|cheque|111', recibido: false, motivoNoRecibido: 'no vino' }], retenciones: [{ clave: 'c2|ret|77', recibido: true }] })
    expect(d.efectivo).toBe(5000)
    expect(d.valoresFaltantes).toEqual({ cantidad: 1, total: 5000 })
    expect(conformidadDe(d)).toBe('con_diferencia')
  })
  it('no se firma con valores sin decidir ni con un "no recibido" sin motivo', () => {
    expect(valoresSinDecidir(sistema, [{ clave: 'c1|cheque|111', presente: true }])).toEqual(['c2|ret|77'])
    expect(recibidosSinMotivo([{ clave: 'a', recibido: false }, { clave: 'b', recibido: false, motivoNoRecibido: 'x' }, { clave: 'c', recibido: true }])).toEqual(['a'])
  })
})

describe('custodia', () => {
  const sobre = (id: string, extra: Partial<Sobre>): Sobre => ({
    id, tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: '2026-09-14', numero: 1, codigo: 'RV-DT-000001',
    rindio: { uid: 'caja1', nombre: 'Cristian', rol: 'caja' },
    sistema: { efectivo: 1000, cheques: [], retenciones: [], transferencias: { cantidad: 0, total: 0 }, origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: [], sobresRecibidosIds: [] } },
    declarado: { efectivo: 1000, cheques: [], retenciones: [] }, diferenciaDeclarada: { efectivo: 0, valoresFaltantes: { cantidad: 0, total: 0 } },
    firmaRinde: 'x', firmanteRinde: 'Cristian', cerradaEn: ts(0), estado: 'pendiente_recepcion',
    custodia: { uid: 'caja1', nombre: 'Cristian', rol: 'caja', desde: ts(0) }, createdAt: ts(0), ...extra,
  })
  const sesion: CajaSesion = { id: '2026-09-14_caja2_1', plantaId: 'torcuato', cajero: { uid: 'caja2', nombre: 'Nico' }, fecha: '2026-09-14', numero: 1, estado: 'abierta', abiertaEn: ts(0), fondoInicial: 0, fondoInicialDe: null }

  it('tiene que llegar es el SISTEMA de los sobres de ventanilla del día; falta = tiene que llegar − recibido', () => {
    const enCamino = sobre('a', {})
    const recibido = sobre('b', { estado: 'recibida', sistema: { ...sobre('b', {}).sistema, efectivo: 3000 }, recepcion: { recibio: { uid: 'tes', nombre: 'Yanina', rol: 'tesoreria' }, en: ts(0), efectivoContado: 2900, cheques: [], retenciones: [], conformidad: 'con_diferencia', firmaRecibe: 'y', firmanteRecibe: 'Yanina' } })
    const deChofer = sobre('c', { tipo: 'chofer', rindeA: 'caja', sistema: { ...sobre('c', {}).sistema, efectivo: 500 } })
    const c = custodiaDePlanta('torcuato', '2026-09-14', [sesion], [enCamino, recibido, deChofer], 2 * 3_600_000)
    expect(c.totales).toEqual({ enCamino: 1000, porRecibirEnCaja: 500, recibidoHoy: 2900, tieneQueLlegar: 4000, falta: 1100 })
    expect(c.cajasAbiertas).toHaveLength(1)
    expect(c.enCamino[0].horas).toBe(2)
    expect(custodioDe(enCamino).nombre).toBe('Cristian')
    expect(custodioDe(recibido).nombre).toBe('Yanina')
  })
  it('antigüedad nunca negativa', () => {
    expect(antiguedadHoras({ cerradaEn: ts(10_000) }, 0)).toBe(0)
  })
})
