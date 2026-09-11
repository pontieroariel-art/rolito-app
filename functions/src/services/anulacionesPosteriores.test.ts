import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { entradaDeAnulacion, idDelCierre } from './anulacionesPosteriores'

const fecha = { toDate: () => new Date('2026-09-05T15:00:00-03:00') }

describe('anulaciones de días ya cerrados (2026-09-11)', () => {
  it('el cierre del camión es la liquidación {fecha}_{chofer}; el de ventanilla, la rendición {fecha}_{cajero}', () => {
    expect(idDelCierre('ventasCamion', { choferId: 'chof1', fecha })).toBe('2026-09-05_chof1')
    expect(idDelCierre('ventasVentanilla', { cajaId: 'caja1', fecha })).toBe('2026-09-05_caja1')
    // La fecha que anotó quien anuló manda sobre la del doc.
    expect(idDelCierre('ventasCamion', { choferId: 'chof1', fecha, anulacion: { fechaVenta: '2026-09-04' } })).toBe('2026-09-04_chof1')
    expect(idDelCierre('ventasCamion', { fecha })).toBeNull()
  })
  it('la nota dice qué comprobante la anuló, el motivo y quién pidió', () => {
    const nc = entradaDeAnulacion('v1', { clienteNombre: 'Cliente', total: 1000, formaPago: 'contado_efectivo', anulacion: { estado: 'anulada', notaCredito: { puntoVenta: 1104, numero: 3 } } }, { motivo: 'cliente_equivocado', nota: 'era otra sucursal', solicitadoPor: { nombre: 'Fac' } })
    expect(nc).toMatchObject({ ventaId: 'v1', tipo: 'notaCredito', comprobante: 'NC 01104-00000003', motivo: 'cliente_equivocado', nota: 'era otra sucursal', pedidoPor: 'Fac', total: 1000 })
    expect(nc.en).toBeInstanceOf(Timestamp)
    const x = entradaDeAnulacion('v2', { anulacion: { estado: 'anulada', notaCreditoInterna: { puntoVenta: 1104, numero: 1 } } }, null)
    expect(x).toMatchObject({ tipo: 'notaCreditoX', comprobante: 'NC X 01104-00000001', pedidoPor: '' })
    const r = entradaDeAnulacion('v3', { anulacion: { estado: 'anulada', tipo: 'remito', motivo: 'otro', nota: 'no lo quiso', anuladaPor: { nombre: 'Chofer' } }, tango: { remitoNumero: 'R0110500000700' } })
    expect(r).toMatchObject({ tipo: 'remito', comprobante: 'Remito R0110500000700', motivo: 'otro', pedidoPor: 'Chofer' })
    const sinTango = entradaDeAnulacion('v4', { anulacion: { estado: 'anulada', tipo: 'remito' }, comprobanteInterno: { puntoVenta: 1105, numero: 700 } })
    expect(sinTango.comprobante).toBe('Remito 01105-00000700')
  })
})
