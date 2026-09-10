import { describe, expect, it } from 'vitest'
import { armarComposicion } from './comprobantesTango'
import { armarItemsLote, armarMailLote, describirLote, etiquetaEstado, filtrarItems, resumenLote } from './comprobantesLote'
import type { ComprobanteSaldoTango, TangoComprobantesDoc } from '@/types'

const hoy = new Date(2026, 8, 10)

const pendientes: ComprobanteSaldoTango[] = [
  { tipo: 'FAC', numero: 'A0010100282787', fechaEmision: '2026-09-02', fechaVencimiento: '2026-09-09', importeOriginal: 84216, saldoPendiente: 84216, empresa: 'redonhielo', codigoTango: 'PA.003' },
  { tipo: 'FAC', numero: 'A0010100281724', fechaEmision: '2026-08-10', importeOriginal: 84216, saldoPendiente: 40000, diasAtraso: 23, empresa: 'redonhielo', codigoTango: 'PA.003' },
]

const indice: TangoComprobantesDoc = {
  id: 'redonhielo_PA.003', empresa: 'redonhielo', codigo: 'PA.003', email: 'Compras@Cliente.com',
  facturas: {
    FAC_A0010100282787: { tipo: 'FAC', numero: 'A0010100282787', fecha: '2026-09-02', importe: 84216, estado: 'PEN', remitos: ['R0000100482053'], h: '1' },
    FAC_A0010100281724: { tipo: 'FAC', numero: 'A0010100281724', fecha: '2026-08-10', importe: 84216, estado: 'PEN', remitos: ['R0036200013493'], h: '2' },
    FAC_A0010100281321: { tipo: 'FAC', numero: 'A0010100281321', fecha: '2026-07-31', importe: 84216, estado: 'CAN', remitos: ['R0036200013451'], h: '3' },
    FAC_A0010100200000: { tipo: 'FAC', numero: 'A0010100200000', fecha: '2025-08-01', importe: 10, estado: 'CAN', h: '4' },   // más de 12 meses: afuera
    NC_A0010100000005:  { tipo: 'NC', numero: 'A0010100000005', fecha: '2026-06-01', importe: 500, estado: 'ANU', h: '5' },
  },
  remitos: {
    R0000100482053: { fecha: '2026-08-27', estado: 'F', bultos: 20, facturas: ['A0010100282787'], h: 'a' },
    R0110500000322: { fecha: '2026-09-09', estado: 'P', bultos: 12, h: 'b' },
    R0110500000201: { fecha: '2026-09-08', estado: 'A', bultos: 3, h: 'c' },
    R0000100400000: { fecha: '2025-01-01', estado: 'F', bultos: 3, h: 'd' },   // viejo: afuera
  },
}

const items = () => armarItemsLote(armarComposicion(pendientes, [indice], 'todas', hoy), [indice], hoy)

describe('lote de comprobantes', () => {
  it('lista facturas de 12 meses y todos los remitos del índice, por fecha descendente', () => {
    const l = items()
    expect(l.map((i) => `${i.clase[0]}:${i.numero}`)).toEqual([
      'r:R0110500000322', 'r:R0110500000201', 'f:A0010100282787', 'r:R0000100482053', 'f:A0010100281724', 'f:A0010100281321', 'f:A0010100000005',
    ])
    const f = l.find((i) => i.numero === 'A0010100282787')
    expect(f?.titulo).toBe('Factura A 00101-00282787')
    expect(f?.clase === 'factura' && f.pendiente).toBe(84216)
    const r = l.find((i) => i.numero === 'R0110500000322')
    expect(r?.titulo).toBe('Remito 01105-00000322')
    expect(r?.clase === 'remito' && r.bultos).toBe(12)
  })

  it('filtra por clase, pendientes, sucursal, fechas y número (con o sin guiones)', () => {
    const l = items()
    expect(filtrarItems(l, { clase: 'facturas' }).length).toBe(4)
    expect(filtrarItems(l, { clase: 'remitos' }).length).toBe(3)
    expect(filtrarItems(l, { pendientes: true }).map((i) => i.numero)).toEqual(['R0110500000322', 'A0010100282787', 'A0010100281724'])
    expect(filtrarItems(l, { sucursal: { empresa: 'rolito', codigo: 'PA.003' } }).length).toBe(0)
    expect(filtrarItems(l, { desde: '2026-09-01', hasta: '2026-09-08' }).map((i) => i.numero)).toEqual(['R0110500000201', 'A0010100282787'])
    expect(filtrarItems(l, { texto: '00101-00282787' }).map((i) => i.numero)).toEqual(['A0010100282787'])
    expect(filtrarItems(l, { texto: '282787' }).map((i) => i.numero)).toEqual(['A0010100282787'])
    expect(filtrarItems(l, { texto: 'nota' }).map((i) => i.numero)).toEqual(['A0010100000005'])
    expect(filtrarItems(l, { texto: '01105' }).length).toBe(2)
  })

  it('resume y describe lo elegido', () => {
    const l = items()
    const r = resumenLote(l)
    expect(r).toMatchObject({ facturas: 4, remitos: 3, total: 7, desde: '2026-06-01', hasta: '2026-09-09' })
    // 3 facturas de 84216 menos la NC de 500
    expect(r.importeFacturas).toBe(252148)
    expect(describirLote(r)).toBe('4 facturas y 3 remitos')
    expect(describirLote({ facturas: 1, remitos: 0 })).toBe('1 factura')
    expect(describirLote({ facturas: 0, remitos: 0 })).toBe('ningún comprobante')
  })

  it('arma el mail del bloque con asunto, mensaje y tarjeta', () => {
    const l = items()
    const sel = l.filter((i) => ['A0010100282787', 'R0000100482053', 'A0010100281724'].includes(i.numero))
    const m = armarMailLote(sel, { uid: 'u1', razonSocial: 'Kiosco Pepe' }, hoy)
    expect(m.asunto).toBe('Comprobantes — Kiosco Pepe')
    expect(m.mensaje).toBe('Te enviamos adjuntos 2 facturas y 1 remito (10/08/2026 al 02/09/2026).')
    expect(m.comprobante).toEqual({ tipo: 'LOTE', numero: '3 comprobantes 2026-09-10', empresa: 'redonhielo' })
    expect(m.comprobantes).toEqual([
      { tipo: 'FAC', numero: 'A0010100282787', empresa: 'redonhielo' },
      { tipo: 'REM', numero: 'R0000100482053', empresa: 'redonhielo' },
      { tipo: 'FAC', numero: 'A0010100281724', empresa: 'redonhielo' },
    ])
    expect(m.presentacion.titulo).toBe('3 comprobantes')
    expect(m.presentacion.filas).toEqual([
      { label: 'Facturas', value: 'A 00101-00282787, A 00101-00281724' },
      { label: 'Remito', value: '00001-00482053' },
      { label: 'Período', value: '10/08/2026 al 02/09/2026' },
      { label: 'Total facturado', value: expect.stringContaining('168.432') },
      { label: 'Empresa', value: 'Redonhielo' },
    ])
  })

  it('un solo comprobante se manda como individual', () => {
    const l = items()
    const m = armarMailLote(l.filter((i) => i.numero === 'R0110500000322'), { uid: 'u1', razonSocial: 'Kiosco Pepe' }, hoy)
    expect(m.asunto).toBe('Remito — Kiosco Pepe')
    expect(m.mensaje).toBe('Te enviamos adjunto el remito 01105-00000322.')
    expect(m.comprobante).toEqual({ tipo: 'REM', numero: 'R0110500000322', empresa: 'redonhielo' })
    expect(m.presentacion.titulo).toBe('Remito 01105-00000322')
  })

  it('etiqueta el estado de cada ítem', () => {
    const l = items()
    const por = (n: string) => etiquetaEstado(l.find((i) => i.numero === n)!)
    expect(por('A0010100282787')).toEqual({ texto: 'Debe', tono: 'pendiente' })
    expect(por('A0010100281724')).toEqual({ texto: 'Debe · 23 d de atraso', tono: 'pendiente' })
    expect(por('A0010100281321')).toEqual({ texto: 'Pagada', tono: 'ok' })
    expect(por('A0010100000005')).toEqual({ texto: 'Anulada', tono: 'anulado' })
    expect(por('R0110500000322')).toEqual({ texto: 'Pendiente de facturar', tono: 'pendiente' })
    expect(por('R0110500000201')).toEqual({ texto: 'Anulado', tono: 'anulado' })
    expect(por('R0000100482053')).toEqual({ texto: 'Facturado en A 00101-00282787', tono: 'neutro' })
  })
})
