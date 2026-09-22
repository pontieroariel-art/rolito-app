import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { mercaderiaDelViaje as delFront } from './liquidacion'
import { mercaderiaDelViaje as delServer } from '../../functions/src/services/cierreMercaderia'
import type { CambioCamion, DescargaCamion, RemitoCarga, VentaCamion } from '@/types'

/**
 * PARIDAD front ↔ server del cierre de mercadería (auditoría 2026-09-22).
 *
 * `mercaderiaDelViaje` vive dos veces: en la app (pantalla de liquidación,
 * liquidaciones abiertas, PDF) y en functions (`cierresMercaderia`, que es lo
 * que decide la diferencia que va al depósito 98 de Tango), porque functions
 * no puede importar de src/. Mientras no haya un paquete compartido, este test
 * corre el MISMO viaje por las dos implementaciones y exige el mismo resultado:
 * si alguien toca la regla de un solo lado, esto se rompe antes que la caja
 * vea un número y Tango reciba otro.
 */

const ts = (iso: string) => Timestamp.fromDate(new Date(iso))
const item = (productoId: string, nombre: string, cantidad: number, precioUnitario = 1000) => ({ productoId, nombre, cantidad, precioUnitario })

const remito = {
  id: 'r1', numero: 82, codigo: 'RC-DT-000082', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AB123CD',
  choferId: 'chof1', choferNombre: 'Chofer Uno', estado: 'entregado', fecha: ts('2026-09-21T06:43:00-03:00'),
  creadoPor: { uid: 'caja1', nombre: 'Caja' },
  items: [
    { productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 920, pallets: 2 },
    { productoId: 'escamas_10kg', nombre: 'Hielo en escamas 10kg', cantidad: 420, pallets: 6 },
    { productoId: 'anticorrosivo', nombre: 'Anticorrosivo', cantidad: 84 },
  ],
  palletsCarga: 8,
  envases: { tarimasMadera: 3, palletsMetal: 5, palletsMetalSimples: 1, racks: [23, 24] },
} as unknown as RemitoCarga

const ventas = [
  { id: 'v1', canal: 'contado', formaPago: 'cuenta_corriente', choferId: 'chof1', camionId: 'cam1', clienteId: 'c1', clienteNombre: 'CYD', fecha: ts('2026-09-21T10:54:00-03:00'), total: 1_172_470,
    items: [item('bolsa_3kg', 'Hielo bolsa 3kg', 311, 3770)], cambios: [item('cambio_bolsa_3kg', 'Cambio Hielo bolsa 3kg', 4, 0)] },
  { id: 'v2', canal: 'contado', formaPago: 'cuenta_corriente', choferId: 'chof1', camionId: 'cam1', clienteId: 'c2', clienteNombre: 'Don Satur', fecha: ts('2026-09-21T12:17:00-03:00'), total: 1_522_500,
    items: [item('escamas_10kg', 'Hielo en escamas 10kg', 350, 4350)] },
  { id: 'v3', canal: 'promo', formaPago: 'contado_efectivo', choferId: 'chof1', camionId: 'cam1', clienteId: 'c3', clienteNombre: 'Kiosco', fecha: ts('2026-09-21T13:00:00-03:00'), total: 20_000,
    items: [item('bolsa_2kg', 'Hielo bolsa 2kg', 20, 1000)], cambios: [item('cambio_bolsa_2kg', 'Cambio Hielo bolsa 2kg', 2, 0)] },
  // Anulada con NC: no cuenta en ningún lado.
  { id: 'v4', canal: 'contado', formaPago: 'contado_efectivo', choferId: 'chof1', camionId: 'cam1', clienteId: 'c4', clienteNombre: 'X', fecha: ts('2026-09-21T14:00:00-03:00'), total: 5_000,
    items: [item('anticorrosivo', 'Anticorrosivo', 5, 1000)], anulacion: { estado: 'anulada', tipo: 'factura' } },
] as unknown as VentaCamion[]

// Registro viejo de cambios (pantalla aparte), con el prefijo cambio_.
const cambiosViejos = [
  { id: 'cc1', choferId: 'chof1', productoId: 'cambio_bolsa_2kg', nombre: 'Cambio Hielo bolsa 2kg', cantidad: 3, fecha: ts('2026-09-21T15:00:00-03:00') },
] as unknown as CambioCamion[]

const descargas = [
  // Original mal contada, después rectificada: solo vale la corrección.
  { id: 'd1', plantaId: 'torcuato', choferId: 'chof1', camionId: 'cam1', fecha: ts('2026-09-21T18:00:00-03:00'), registradoPor: { uid: 'mue1', nombre: 'Muelle' },
    items: [item('bolsa_2kg', 'Hielo bolsa 2kg', 800)], bolsasRotas: [], envases: { tarimasMadera: 3, palletsMetal: 5, puntales: 32, aros: 3, sombreros: 8, racks: [23] } },
  { id: 'd2', plantaId: 'torcuato', choferId: 'chof1', camionId: 'cam1', fecha: ts('2026-09-21T18:30:00-03:00'), registradoPor: { uid: 'mue1', nombre: 'Muelle' }, rectificaA: 'd1', motivoRectificacion: 'conté mal',
    items: [item('bolsa_2kg', 'Hielo bolsa 2kg', 895), item('escamas_10kg', 'Hielo en escamas 10kg', 70), item('anticorrosivo', 'Anticorrosivo', 84)],
    bolsasRotas: [item('cambio_bolsa_2kg', 'Cambio Hielo bolsa 2kg', 5), item('bolsa_3kg', 'Hielo bolsa 3kg', 4)],
    envases: { tarimasMadera: 3, palletsMetal: 4, palletsMetalSimples: 1, puntales: 24, aros: 3, sombreros: 6, racks: [23] } },
] as unknown as DescargaCamion[]

describe('paridad front ↔ server: mercaderiaDelViaje', () => {
  it('el mismo viaje da los mismos productos, cambios y envases en la app y en functions', () => {
    const front = delFront([remito], ventas, cambiosViejos, descargas)
    const server = delServer([remito] as never, ventas as never, cambiosViejos as never, descargas as never)
    expect(server.productos).toEqual(front.productos)
    expect(server.cambios).toEqual(front.cambios)
    expect(server.envases).toEqual(front.envases)
  })

  it('el viaje de la fixture cierra como se espera (ancla para que la paridad no sea "los dos mal")', () => {
    const { productos, cambios } = delFront([remito], ventas, cambiosViejos, descargas)
    const por = Object.fromEntries(productos.map((p) => [p.productoId, p]))
    // bolsa_2kg: carga 920 − promo 20 − cambios (2 en la venta + 3 viejos) = 895; volvieron 895 → diferencia 0; rotas 5
    expect(por.bolsa_2kg).toMatchObject({ carga: 920, ventaPromo: 20, cambios: 5, devolucionTeorica: 895, descarga: 895, diferencia: 0, rotas: 5 })
    // escamas: carga 420 − contado 350 = 70; volvieron 70
    expect(por.escamas_10kg).toMatchObject({ carga: 420, ventaContado: 350, devolucionTeorica: 70, descarga: 70, diferencia: 0 })
    // bolsa_3kg no estaba en la carga: vendió 311 + 4 cambios → −315, nada volvió → diferencia +315 (sobrante en la cuenta) y 4 rotas
    expect(por.bolsa_3kg).toMatchObject({ carga: 0, ventaContado: 311, cambios: 4, devolucionTeorica: -315, descarga: 0, diferencia: 315, rotas: 4 })
    // La venta anulada no descuenta anticorrosivo.
    expect(por.anticorrosivo).toMatchObject({ carga: 84, ventaContado: 0, descarga: 84, diferencia: 0 })
    expect(cambios).toEqual({ registrados: 4 + 2 + 3, rotasRecibidas: 9 })
  })
})
