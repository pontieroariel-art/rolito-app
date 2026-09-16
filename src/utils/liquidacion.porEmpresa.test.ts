import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { calcularLiquidacion, empresaDeCobranza, empresaDeVenta, plataPorEmpresa } from './liquidacion'
import type { Cobranza, VentaCamion } from '../types'

// Rendición por sobres, etapa 1 (2026-09-16): la plata de la liquidación se
// mira por empresa. Contado con factura es Redonhielo (oficial), promo es
// Rolito (no oficial); cada cobranza trae su empresa y sus valores van con ella.

const TS = Timestamp.fromMillis(0)
const venta = (canal: VentaCamion['canal'], formaPago: VentaCamion['formaPago'], total: number, extra: Partial<VentaCamion> = {}): VentaCamion => ({
  id: `v-${canal}-${formaPago}-${total}`, canal, camionId: 'cam1', choferId: 'ch1', choferNombre: 'Juan',
  clienteId: 'cli1', clienteNombre: 'Kiosco', items: [{ productoId: 'p1', nombre: 'Hielo', cantidad: 1, precioUnitario: total }], total, formaPago, fecha: TS, ...extra,
})
const cobranza = (empresa: Cobranza['empresa'], medios: NonNullable<Cobranza['medios']>): Cobranza => ({
  id: `c-${empresa}-${medios.efectivo}`, origen: 'supervisor', registradoPor: { uid: 'sup1', nombre: 'Sup' }, clienteId: 'cli1', clienteNombre: 'Kiosco',
  importe: medios.efectivo + medios.transferencia + medios.cheques.reduce((s, c) => s + c.importe, 0) + medios.retenciones.reduce((s, r) => s + r.importe, 0),
  formaPago: 'contado_efectivo', fecha: TS, ...(empresa ? { empresa } : {}), medios, imputaciones: [],
} as unknown as Cobranza)
const cheque = (importe: number) => ({ numero: String(importe), bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-01', fechaAcreditacion: '2026-09-30', dias: 29, importe })
const retencion = (importe: number) => ({ tipo: 'iibb_pba' as const, nroCertificado: `R${importe}`, importe })

describe('empresaDeVenta / empresaDeCobranza', () => {
  it('contado → Redonhielo, promo → Rolito; cobranza sin empresa → Redonhielo', () => {
    expect(empresaDeVenta({ canal: 'contado' })).toBe('redonhielo')
    expect(empresaDeVenta({ canal: 'promo' })).toBe('rolito')
    expect(empresaDeCobranza({ empresa: 'rolito' })).toBe('rolito')
    expect(empresaDeCobranza({})).toBe('redonhielo')
  })
})

describe('plataPorEmpresa', () => {
  it('reparte efectivo, transferencias y valores entre las dos empresas', () => {
    const ventas = [
      venta('contado', 'contado_efectivo', 1000),
      venta('contado', 'contado_transferencia', 500),
      venta('contado', 'cuenta_corriente', 9000),
      venta('promo', 'contado_efectivo', 300),
      venta('promo', 'cuenta_corriente', 700),
    ]
    const cobranzas = [
      cobranza('redonhielo', { efectivo: 2000, transferencia: 0, cheques: [cheque(1500), cheque(500)], retenciones: [retencion(50)] }),
      cobranza('rolito',     { efectivo: 400, transferencia: 100, cheques: [], retenciones: [] }),
      cobranza(undefined,    { efectivo: 10, transferencia: 0, cheques: [], retenciones: [] }),   // vieja, sin empresa
    ]
    const p = plataPorEmpresa(ventas, cobranzas)
    expect(p.redonhielo).toEqual({
      efectivo: 1000 + 2000 + 10, transferencia: 500,
      ventas: { cantidad: 3, total: 10_500 }, cobranzas: { cantidad: 2, total: 4060 },
      cheques: { cantidad: 2, total: 2000 }, retenciones: { cantidad: 1, total: 50 },
      // Contado y cobranzas por separado (cuadro de dos columnas, 2026-09-16): la cta. cte. de 9000 no entra en "contado".
      ventasContado: { cantidad: 2, total: 1500 }, ventasEfectivo: 1000, ventasTransferencia: 500, cobranzasEfectivo: 2010, cobranzasTransferencia: 0,
    })
    expect(p.rolito).toEqual({
      efectivo: 300 + 400, transferencia: 100,
      ventas: { cantidad: 2, total: 1000 }, cobranzas: { cantidad: 1, total: 500 },
      cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 },
      // La promo en cta. cte. (700) es factura X que se cobra después con recibo: tampoco es contado.
      ventasContado: { cantidad: 1, total: 300 }, ventasEfectivo: 300, ventasTransferencia: 0, cobranzasEfectivo: 400, cobranzasTransferencia: 100,
    })
  })

  it('la suma de efectivo por empresa es el efectivo a rendir de la liquidación', () => {
    const ventas = [venta('contado', 'contado_efectivo', 1000), venta('promo', 'contado_efectivo', 300)]
    const cobranzas = [cobranza('rolito', { efectivo: 400, transferencia: 0, cheques: [], retenciones: [] })]
    const calc = calcularLiquidacion([], ventas, [], [], cobranzas)
    expect(calc.porEmpresa.redonhielo.efectivo + calc.porEmpresa.rolito.efectivo).toBe(calc.efectivoARendir)
    expect(calc.efectivoARendir).toBe(1700)
  })

  it('usa el importe con IVA de la factura de ARCA cuando la hay (igual que el total)', () => {
    const conFactura = venta('contado', 'contado_efectivo', 1000, { factura: { estado: 'emitida', importes: { total: 1210 } } as unknown as VentaCamion['factura'] })
    const p = plataPorEmpresa([conFactura], [])
    expect(p.redonhielo.efectivo).toBe(1210)
    expect(p.redonhielo.ventas.total).toBe(1210)
  })
})
