import { describe, expect, it } from 'vitest'
import {
  armarComposicion, armarFacturaTangoPdf, armarRemitoTangoPdf, filtrarPorSucursal, formatoRemito, opcionesSucursal, parsearRemito, totalPendiente,
} from './comprobantesTango'
import type { ComprobanteSaldoTango, FacturaTangoDetalle, RemitoTangoDetalle, TangoComprobantesDoc, UserProfile } from '@/types'

const hoy = new Date(2026, 8, 9)

const pendientes: ComprobanteSaldoTango[] = [
  { tipo: 'FAC', numero: 'A0010100282787', fechaEmision: '2026-09-02', fechaVencimiento: '2026-09-09', importeOriginal: 84216, saldoPendiente: 84216, empresa: 'redonhielo', codigoTango: 'PA.003' },
  { tipo: 'FAC', numero: 'A0010100281724', fechaEmision: '', fechaVencimiento: '2026-08-17', importeOriginal: 84216, saldoPendiente: 40000, diasAtraso: 23, empresa: 'redonhielo', codigoTango: 'PA.003' },
  { tipo: 'FAC', numero: 'B0110700000010', fechaEmision: '2026-09-01', importeOriginal: 1000, saldoPendiente: 1000, empresa: 'rolito', codigoTango: 'PA.003' },
]

const indice: TangoComprobantesDoc = {
  id: 'redonhielo_PA.003', empresa: 'redonhielo', codigo: 'PA.003',
  facturas: {
    FAC_A0010100282787: { tipo: 'FAC', numero: 'A0010100282787', fecha: '2026-09-02', importe: 84216, estado: 'PEN', remitos: ['R0000100482053'], h: '1' },
    FAC_A0010100281724: { tipo: 'FAC', numero: 'A0010100281724', fecha: '2026-08-10', importe: 84216, estado: 'PEN', remitos: ['R0036200013493'], h: '2' },
    FAC_A0010100281321: { tipo: 'FAC', numero: 'A0010100281321', fecha: '2026-07-31', importe: 84216, estado: 'CAN', remitos: ['R0036200013451'], h: '3' },
    FAC_A0010100200000: { tipo: 'FAC', numero: 'A0010100200000', fecha: '2025-08-01', importe: 10, estado: 'CAN', h: '4' },
    NC_A0010100000005:  { tipo: 'NC', numero: 'A0010100000005', fecha: '2026-06-01', importe: 500, estado: 'ANU', h: '5' },
  },
  remitos: {
    R0000100482053: { fecha: '2026-08-27', estado: 'F', bultos: 20, h: 'a' },
    R0110500000322: { fecha: '2026-09-09', estado: 'P', bultos: 12, h: 'b' },
    R0110500000201: { fecha: '2026-09-08', estado: 'A', bultos: 3, h: 'c' },
  },
}

describe('armarComposicion', () => {
  it('pendientes: dato en vivo con el remito y la emisión completados desde el índice', () => {
    const b = armarComposicion(pendientes, [indice], 'pendientes', hoy)
    expect(b.map((x) => `${x.grupo.empresa}|${x.grupo.codigo}`)).toEqual(['redonhielo|PA.003', 'rolito|PA.003'])
    const rh = b[0]
    expect(rh.filas.map((f) => f.numero)).toEqual(['A0010100282787', 'A0010100281724'])
    expect(rh.filas[0]).toMatchObject({ estado: 'pendiente', pendiente: 84216, remitos: ['R0000100482053'], enVivo: true, fechaVencimiento: '2026-09-09' })
    expect(rh.filas[1]).toMatchObject({ fecha: '2026-08-10', diasAtraso: 23, remitos: ['R0036200013493'] })
    expect(rh.subtotalPendiente).toBe(124216)
    expect(rh.remitosSinFacturar.map((r) => r.numero)).toEqual(['R0110500000322'])   // el anulado no
    expect(b[1].filas[0]).toMatchObject({ numero: 'B0110700000010', remitos: [] })
    expect(totalPendiente(b)).toBe(125216)
  })

  it('todas: suma pagadas y anuladas de 12 meses sin duplicar las pendientes, ordenadas por fecha', () => {
    const rh = armarComposicion(pendientes, [indice], 'todas', hoy)[0]
    expect(rh.filas.map((f) => `${f.numero}:${f.estado}`)).toEqual([
      'A0010100282787:pendiente', 'A0010100281724:pendiente', 'A0010100281321:pagada', 'A0010100000005:anulada',
    ])
    expect(rh.filas[2]).toMatchObject({ pendiente: null, enVivo: false, importe: 84216, remitos: ['R0036200013451'] })
    expect(rh.subtotalPendiente).toBe(124216)
  })

  it('sin índice funciona igual que hoy; filtrar por sucursal deja un bloque', () => {
    const b = armarComposicion(pendientes, [], 'todas', hoy)
    expect(b).toHaveLength(2)
    expect(b[0].filas[0].remitos).toEqual([])
    expect(filtrarPorSucursal(b, { empresa: 'rolito', codigo: 'PA.003' }).map((x) => x.grupo.empresa)).toEqual(['rolito'])
    expect(filtrarPorSucursal(b, null)).toHaveLength(2)
  })
})

describe('opcionesSucursal', () => {
  const cliente = { tangoIds: { redonhielo: [{ idGva14: 1, codigo: 'RAP001' }, { idGva14: 2, codigo: 'RAP002' }] }, addresses: [{ id: 'RAP001', nombre: 'Principal', address: 'Monroe 1616' }, { id: 'RAP002', nombre: 'RAPPI PALERMO', address: 'Cabildo 100' }] } as unknown as UserProfile
  it('lista los códigos del perfil más los que aparecen con deuda', () => {
    const bloques = armarComposicion([{ tipo: 'FAC', numero: 'A0010100000001', fechaEmision: '', importeOriginal: 1, saldoPendiente: 1, empresa: 'rolito', codigoTango: 'RAP001' }], [], 'pendientes', hoy)
    const op = opcionesSucursal(cliente, bloques)
    expect(op.map((o) => o.etiqueta)).toEqual(['Redonhielo · RAP001 · Principal · Monroe 1616', 'Redonhielo · RAP002 · RAPPI PALERMO · Cabildo 100', 'Rolito · RAP001'])
  })
  it('con un solo código no hay selector', () => {
    expect(opcionesSucursal({ tangoIds: { redonhielo: [{ idGva14: 1, codigo: 'FC.280' }] }, addresses: [] } as unknown as UserProfile, [])).toEqual([])
  })
})

describe('remitos', () => {
  it('parsea y formatea el número de Tango', () => {
    expect(parsearRemito('R0110500000322')).toEqual({ puntoVenta: 1105, numero: 322 })
    expect(formatoRemito('R0110500000322')).toBe('01105-00000322')
    expect(parsearRemito('A0010100282787')).toBeNull()
    expect(formatoRemito('otro')).toBe('otro')
  })
})

const detalleFactura: FacturaTangoDetalle = {
  empresa: 'redonhielo', tipo: 'FAC', numero: 'A0010100282787', codigo: 'PA.003', fecha: '2026-09-02', letra: 'A', puntoVenta: 101, nro: 282787, cbteTipo: 1, estado: 'PEN',
  cliente: { codigo: 'PA.003', razonSocial: 'ALGAR S.R.L.', cuit: '30-66178840-9', domicilio: 'Calle 1', localidad: 'SAN MIGUEL', cp: '1663', provincia: '01', condicionIva: 'IVA Responsable Inscripto', condicionVenta: 'CTA CTE', vendedor: 'MS' },
  renglones: [{ codigo: 'PTHIBOLROLI0003', descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 20, precioUnitario: 3480, dtoPct: 0, ivaPct: 21, importe: 69600 }],
  totales: { gravado: 69600, exento: 0, iva: 14616, ivaAlic: 21, internos: 0, otros: 0, total: 84216 },
  cae: '86351131069060', caeVto: '2026-09-12', remitos: ['R0000100482053'],
}

describe('armarFacturaTangoPdf', () => {
  it('arma el PDF histórico con CAE, QR y la caja de remitos', () => {
    const r = armarFacturaTangoPdf(detalleFactura)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos).toMatchObject({ letra: 'A', codigoTipo: '01', titulo: 'FACTURA', puntoVenta: 101, numero: 282787, cae: '86351131069060', remitosOC: '(00001-00482053)', leyendaCopia: 'DUPLICADO — REIMPRESIÓN', descargar: false })
    expect(r.datos.fechaEmision).toEqual(new Date(2026, 8, 2))
    expect(r.datos.caeVto).toEqual(new Date(2026, 8, 12))
    expect(r.datos.totales).toMatchObject({ netoGravado: 69600, iva: 14616, ivaAlic: 21, total: 84216 })
    expect(r.datos.renglones[0]).toMatchObject({ descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 20, precioUnitario: 3480, importe: 69600 })
  })
  it('sin CAE o con letra rara no se imprime; NC lleva su título', () => {
    expect(armarFacturaTangoPdf({ ...detalleFactura, cae: '' })).toMatchObject({ ok: false })
    expect(armarFacturaTangoPdf({ ...detalleFactura, letra: 'X' })).toMatchObject({ ok: false })
    const nc = armarFacturaTangoPdf({ ...detalleFactura, tipo: 'NC', cbteTipo: 3 })
    expect(nc.ok && nc.datos.titulo).toBe('NOTA DE CREDITO')
    expect(nc.ok && nc.datos.codigoTipo).toBe('03')
  })
})

describe('armarRemitoTangoPdf', () => {
  const det: RemitoTangoDetalle = {
    empresa: 'redonhielo', tipo: 'REM', numero: 'R0000100482053', codigo: 'PA.003', fecha: '2026-08-27', estado: 'F',
    cliente: detalleFactura.cliente,
    renglones: [{ codigo: 'X', descripcion: 'HIELO EN BOLSA ROLITO 3 KG', cantidad: 20 }], bultos: 20,
    talonario: { numero: 15, cai: '52273219324517', vencimiento: '2027-07-03' }, usuario: 'SUPERVISOR', facturas: ['A0010100282787'],
  }
  it('copia con el CAI del talonario, letra R y leyenda de copia', () => {
    const r = armarRemitoTangoPdf(det, hoy)
    expect(r).toMatchObject({ empresa: 'redonhielo', letra: 'R', numero: '00001-00482053', control: { tipo: 'cai', cai: '52273219324517' }, bultos: { entregados: 20, cambios: 0 }, entrega: { chofer: 'SUPERVISOR' } })
    expect(r.cliente).toMatchObject({ razonSocial: 'ALGAR S.R.L.', localidadCp: '1663, SAN MIGUEL', codigoCliente: 'PA.003' })
    expect(r.leyenda).toContain('COPIA')
    expect(r.leyenda).toContain('A0010100282787')
    expect(r.firma).toBeUndefined()
  })
  it('sin CAI sale X con número de control; anulado lo dice', () => {
    const r = armarRemitoTangoPdf({ ...det, talonario: { numero: 362 }, estado: 'A', facturas: [] }, hoy)
    expect(r.letra).toBe('X')
    expect(r.control).toEqual({ tipo: 'interno', codigo: '00001-00482053' })
    expect(r.leyenda.startsWith('REMITO ANULADO')).toBe(true)
  })
})
