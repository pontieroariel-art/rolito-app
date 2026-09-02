import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { armarFacturaDeVenta } from './facturaDeVenta'
import { UserProfile, VentaCamion } from '@/types'

const venta = (extra: Partial<VentaCamion> = {}): VentaCamion => ({
  id: 'v1',
  canal: 'contado',
  camionId: 'camion-1',
  choferId: 'ch1',
  choferNombre: 'Chofer Prueba Uno',
  clienteId: 'cli1',
  clienteNombre: 'Facturable SA',
  items: [
    { productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 10, precioUnitario: 1200 },
    { productoId: 'bolsa_3kg', nombre: 'Hielo bolsa 3kg', cantidad: 5, precioUnitario: 1600 },
  ],
  total: 20000,
  formaPago: 'contado_efectivo',
  fecha: Timestamp.fromDate(new Date(2026, 8, 2, 15, 30)),
  factura: {
    estado: 'emitida',
    numero: 3,
    puntoVenta: 1104,
    cbteTipo: 1,
    cae: '86350838141971',
    caeFchVto: '20260912',
    importes: { fecha: '20260902', neto: 20000, iva: 4200, tributos: 400, total: 24600 },
  },
  ...extra,
} as VentaCamion)

const cliente = {
  uid: 'cli1',
  razonSocial: 'Facturable SA',
  cuit: '30-68731043-4',
  categoriaIvaTangoDesc: 'Responsable Inscripto',
  address: 'AV. LIBERTADOR 215',
} as UserProfile

describe('armarFacturaDeVenta', () => {
  it('arma el comprobante con los importes que se le informaron a ARCA', () => {
    const r = armarFacturaDeVenta(venta(), cliente)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.datos.letra).toBe('A')
    expect(r.datos.codigoTipo).toBe('01')
    expect(r.datos.puntoVenta).toBe(1104)
    expect(r.datos.numero).toBe(3)
    expect(r.datos.cae).toBe('86350838141971')
    // Los importes salen del registro, NO de recalcular la venta: el papel tiene
    // que coincidir con lo declarado.
    expect(r.datos.totales).toMatchObject({ subtotal: 20000, iva: 4200, percIibbCaba: 400, total: 24600 })
  })

  it('usa la fecha del comprobante, no la de la venta', () => {
    const r = armarFacturaDeVenta(venta(), cliente)
    if (!r.ok) throw new Error('debería armar')
    expect(r.datos.fechaEmision.getFullYear()).toBe(2026)
    expect(r.datos.fechaEmision.getMonth()).toBe(8)   // septiembre
    expect(r.datos.fechaEmision.getDate()).toBe(2)
    expect(r.datos.caeVto.getDate()).toBe(12)
  })

  it('lleva los renglones de la venta', () => {
    const r = armarFacturaDeVenta(venta(), cliente)
    if (!r.ok) throw new Error('debería armar')
    expect(r.datos.renglones).toHaveLength(2)
    expect(r.datos.renglones[0]).toMatchObject({
      descripcion: 'Hielo bolsa 2kg', cantidad: 10, precioUnitario: 1200, total: 12000,
    })
  })

  it('una factura B sale con su letra', () => {
    const r = armarFacturaDeVenta(venta({
      factura: { ...venta().factura!, cbteTipo: 6 },
    }), cliente)
    if (!r.ok) throw new Error('debería armar')
    expect(r.datos.letra).toBe('B')
    expect(r.datos.codigoTipo).toBe('06')
  })

  it('no entrega nada si la factura está en revisión', () => {
    const r = armarFacturaDeVenta(venta({
      factura: { estado: 'incierta', numero: 4, puntoVenta: 1104, cbteTipo: 1, cae: null, caeFchVto: null },
    }), cliente)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.motivo).toMatch(/revisión/)
  })

  it('no entrega nada si ARCA la rechazó', () => {
    const r = armarFacturaDeVenta(venta({
      factura: { estado: 'rechazada', numero: 4, puntoVenta: 1104, cbteTipo: 1, cae: null, caeFchVto: null },
    }), cliente)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.motivo).toMatch(/rechaz/)
  })

  it('no entrega nada si la venta todavía no se facturó', () => {
    const r = armarFacturaDeVenta(venta({ factura: undefined }), cliente)
    expect(r).toMatchObject({ ok: false })
  })

  it('frena si el tipo de comprobante no se reconoce', () => {
    const r = armarFacturaDeVenta(venta({
      factura: { ...venta().factura!, cbteTipo: 99 },
    }), cliente)
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.motivo).toMatch(/99/)
  })

  it('sin los importes declarados no inventa el desglose', () => {
    // Preferible mostrar el IVA en cero (visible, revisable) que números
    // plausibles que no coincidan con lo que tiene ARCA.
    const r = armarFacturaDeVenta(venta({
      factura: { ...venta().factura!, importes: undefined },
    }), cliente)
    if (!r.ok) throw new Error('debería armar')
    expect(r.datos.totales).toMatchObject({ subtotal: 20000, iva: 0, percIibbCaba: 0, total: 20000 })
  })

  it('funciona aunque no tengamos el perfil del cliente a mano', () => {
    const r = armarFacturaDeVenta(venta(), undefined)
    if (!r.ok) throw new Error('debería armar')
    expect(r.datos.cliente.razonSocial).toBe('Facturable SA')   // el nombre de la venta
    expect(r.datos.cliente.cuit).toBe('')
  })
})
