import { describe, expect, it } from 'vitest'
import type { Cobranza, Liquidacion, RemitoCarga, Rendicion, VentaCamion, VentaVentanilla } from '@/types'
import { resumenLive } from './tesoreriaLive'

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
    expect(nico.estado).toBe('abierta')
    expect(r.ventanilla.torcuato[0]).toMatchObject({ estado: 'validada', contado: { transferencia: 700 } })
    expect(r.ventanilla.merlo[0]).toMatchObject({ nombre: 'Merlo', promo: { efectivo: 200 } })
  })
  it('supervisores: cobranzas por medio', () => {
    expect(r.supervisores).toEqual([{ uid: 's1', nombre: 'Matias', cobranzas: { cantidad: 1, efectivo: 200, transferencia: 100, cheques: { cantidad: 1, total: 900 }, retenciones: { cantidad: 1, total: 100 }, total: 1300 } }])
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
  })
})
