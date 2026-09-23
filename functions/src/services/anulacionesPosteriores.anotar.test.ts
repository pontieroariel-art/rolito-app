import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { anotarAnulacionPosterior } from './anulacionesPosteriores'

/**
 * `anotarAnulacionPosterior`: la nota que queda en el cierre ya hecho cuando
 * se anula una venta de ese día (los importes del cierre no se tocan).
 * Complementa anulacionesPosteriores.test.ts, que cubre lo puro.
 */

type Doc = Record<string, unknown>
function firestoreFalso() {
  const docs = new Map<string, Doc>()
  const lecturas: string[] = []
  const escrituras: { path: string; data: Doc }[] = []
  return {
    docs, lecturas, escrituras,
    doc: (path: string) => ({
      get: async () => { lecturas.push(path); return { exists: docs.has(path), data: () => docs.get(path) } },
      set: async (data: Doc) => {
        escrituras.push({ path, data })
        const previo = docs.get(path) ?? {}
        const union = data.anulacionesPosteriores as { elements: unknown[] }
        docs.set(path, { ...previo, anulacionesPosteriores: [...((previo.anulacionesPosteriores as unknown[]) ?? []), ...union.elements] })
      },
    }),
  }
}

let db: ReturnType<typeof firestoreFalso>
beforeEach(() => { db = firestoreFalso() })
const fecha = Timestamp.fromDate(new Date('2026-09-05T15:00:00-03:00'))

describe('anotarAnulacionPosterior', () => {
  it('sin cierre de ese día no hay nada que anotar (se anuló antes de cerrar)', async () => {
    expect(await anotarAnulacionPosterior(db as never, 'ventasCamion', 'v1', { choferId: 'ch1', fecha, anulacion: { estado: 'anulada', notaCredito: { puntoVenta: 1104, numero: 3 } } })).toBeNull()
    expect(db.escrituras).toEqual([])
  })

  it('con la venta incompleta (sin chofer) tampoco', async () => {
    db.docs.set('liquidaciones/2026-09-05_ch1', { total: 1 })
    expect(await anotarAnulacionPosterior(db as never, 'ventasCamion', 'v1', { fecha })).toBeNull()
  })

  it('la NC de una venta del camión se anota en la liquidación del chofer, con el motivo y quién pidió sacados de la solicitud', async () => {
    db.docs.set('liquidaciones/2026-09-05_ch1', { codigo: 'LQ-03-000015', efectivo: 1000 })
    db.docs.set('anulacionesVentanilla/v1', { motivo: 'cliente_equivocado', nota: 'era otra sucursal', solicitadoPor: { nombre: 'Fac' } })
    const id = await anotarAnulacionPosterior(db as never, 'ventasCamion', 'v1', {
      choferId: 'ch1', fecha, clienteNombre: 'ACME', total: 1000, formaPago: 'contado_efectivo', factura: { importes: { total: 1210 } },
      anulacion: { estado: 'anulada', notaCredito: { puntoVenta: 1104, numero: 3 } },
    })
    expect(id).toBe('2026-09-05_ch1')
    const cierre = db.docs.get('liquidaciones/2026-09-05_ch1') as Doc
    expect(cierre).toMatchObject({ codigo: 'LQ-03-000015', efectivo: 1000 })
    expect(cierre.anulacionesPosteriores).toEqual([expect.objectContaining({
      ventaId: 'v1', tipo: 'notaCredito', comprobante: 'NC 01104-00000003', clienteNombre: 'ACME', total: 1210, motivo: 'cliente_equivocado', nota: 'era otra sucursal', pedidoPor: 'Fac',
    })])
  })

  it('la de ventanilla va a la rendición del cajero y usa la fecha que anotó quien anuló', async () => {
    db.docs.set('rendiciones/2026-09-04_caja1', {})
    const id = await anotarAnulacionPosterior(db as never, 'ventasVentanilla', 'w1', {
      cajaId: 'caja1', fecha, anulacion: { estado: 'anulada', fechaVenta: '2026-09-04', notaCreditoInterna: { puntoVenta: 1104, numero: 1 } },
    })
    expect(id).toBe('2026-09-04_caja1')
    expect((db.docs.get('rendiciones/2026-09-04_caja1') as Doc).anulacionesPosteriores).toEqual([expect.objectContaining({ tipo: 'notaCreditoX', comprobante: 'NC X 01104-00000001' })])
  })

  it('es idempotente: una venta ya anotada devuelve el id sin volver a escribir', async () => {
    db.docs.set('liquidaciones/2026-09-05_ch1', { anulacionesPosteriores: [{ ventaId: 'v1' }] })
    const id = await anotarAnulacionPosterior(db as never, 'ventasCamion', 'v1', { choferId: 'ch1', fecha, anulacion: { estado: 'anulada' } })
    expect(id).toBe('2026-09-05_ch1')
    expect(db.escrituras).toEqual([])
    expect((db.docs.get('liquidaciones/2026-09-05_ch1') as Doc).anulacionesPosteriores).toHaveLength(1)
  })

  it('el remito anulado por el chofer no tiene solicitud: no la lee y toma motivo y nombre de la venta', async () => {
    db.docs.set('liquidaciones/2026-09-05_ch1', {})
    await anotarAnulacionPosterior(db as never, 'ventasCamion', 'v3', {
      choferId: 'ch1', fecha, anulacion: { estado: 'anulada', tipo: 'remito', motivo: 'otro', nota: 'no lo quiso', anuladaPor: { nombre: 'Chofer' } }, tango: { remitoNumero: 'R0110500000700' },
    })
    expect(db.lecturas).not.toContain('anulacionesVentanilla/v3')
    expect((db.docs.get('liquidaciones/2026-09-05_ch1') as Doc).anulacionesPosteriores).toEqual([expect.objectContaining({ tipo: 'remito', comprobante: 'Remito R0110500000700', motivo: 'otro', pedidoPor: 'Chofer' })])
  })
})
