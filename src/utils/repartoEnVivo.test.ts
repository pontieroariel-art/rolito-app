import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { agruparRepartoEnVivo } from './repartoEnVivo'
import type { CambioCamion, Cobranza, DescargaCamion, RemitoCarga, VentaCamion } from '../types'

const ts = (h: number, m = 0) => Timestamp.fromDate(new Date(2026, 8, 7, h, m))

const remito = (choferId: string, extra: Partial<RemitoCarga> = {}): RemitoCarga => ({
  id: `r-${choferId}`, numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'AG028YO — Atego',
  choferId, choferNombre: choferId.toUpperCase(),
  items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad: 100, pallets: 2 }, { productoId: 'bolsa_2kg', nombre: 'Hielo 2kg', cantidad: 50, pallets: 1 }],
  palletsCarga: 3, estado: 'salido', creadoPor: { uid: 'caja', nombre: 'Caja' }, fecha: ts(6),
  ...extra,
} as RemitoCarga)

const venta = (choferId: string, clienteId: string, cantidad: number, hora: number, extra: Partial<VentaCamion> = {}): VentaCamion => ({
  id: `v-${choferId}-${clienteId}-${hora}`, canal: 'contado', camionId: 'cam1', choferId, choferNombre: choferId.toUpperCase(),
  clienteId, clienteNombre: clienteId, items: [{ productoId: 'bolsa_10kg', nombre: 'Hielo 10kg', cantidad, precioUnitario: 1000 }],
  total: cantidad * 1000, formaPago: 'contado_efectivo', fecha: ts(hora),
  ...extra,
} as VentaCamion)

describe('agruparRepartoEnVivo', () => {
  it('arma un camión por chofer con cargado, bajado, ventas, clientes, última venta y efectivo', () => {
    const remitos = [remito('ana', { salida: { uid: 's', nombre: 'Seg', hora: ts(7, 15) } })]
    const ventas = [
      venta('ana', 'cli1', 20, 9), venta('ana', 'cli2', 30, 10, { formaPago: 'cuenta_corriente' }),
      venta('ana', 'cli1', 10, 11, { cambios: [{ productoId: 'cambio_bolsa_10kg', nombre: 'Cambio Hielo 10kg', cantidad: 5, precioUnitario: 0 }] }),
    ]
    const cobranzas: Cobranza[] = [{ id: 'c1', origen: 'cobrador', registradoPor: { uid: 'ana', nombre: 'ANA' }, clienteId: 'cli2', clienteNombre: 'cli2', importe: 7000, formaPago: 'contado_efectivo', fecha: ts(10, 30) } as Cobranza]
    const [cam] = agruparRepartoEnVivo(remitos, ventas, [], [], cobranzas)

    expect(cam.choferId).toBe('ana')
    expect(cam.camionLabel).toBe('AG028YO — Atego')
    expect(cam.estado).toBe('en_calle')
    expect(cam.salida).toEqual(new Date(2026, 8, 7, 7, 15))
    expect(cam.cargado).toBe(150)
    expect(cam.bajado).toBe(65)              // 20 + 30 + 10 vendidas + 5 de cambio
    expect(cam.ventas).toBe(3)
    expect(cam.clientes).toBe(2)
    expect(cam.ultimaVenta).toEqual(new Date(2026, 8, 7, 11))
    expect(cam.efectivo).toBe(30000 + 7000)  // contado efectivo (20+10 bolsas) + cobranza de calle
    const b10 = cam.liquidacion.productos.find((p) => p.productoId === 'bolsa_10kg')!
    expect(b10.carga).toBe(100)
    expect(b10.devolucionTeorica).toBe(35)   // 100 − 60 vendidas − 5 cambio
    const b2 = cam.liquidacion.productos.find((p) => p.productoId === 'bolsa_2kg')!
    expect(b2.devolucionTeorica).toBe(50)
    expect(cam.detalle.ventas.map((v) => v.clienteId)).toEqual(['cli1', 'cli2', 'cli1'])   // más reciente primero
  })

  it('estado: cargando sin salida ni ventas, volvió cuando hay descarga; ordena en calle primero', () => {
    const remitos = [remito('beto'), remito('caro', { salida: { uid: 's', nombre: 'Seg', hora: ts(7) } }), remito('dani', { salida: { uid: 's', nombre: 'Seg', hora: ts(7) } })]
    const descargas: DescargaCamion[] = [{ id: 'd1', plantaId: 'torcuato', camionId: 'cam1', camionLabel: 'X', choferId: 'dani', choferNombre: 'DANI', items: [], bolsasRotas: [], palletsCompletos: 0, palletsParciales: 0, palletsVacios: 0, registradoPor: { uid: 'm', nombre: 'Muelle' }, fecha: ts(15) } as DescargaCamion]
    const cambios: CambioCamion[] = []
    const res = agruparRepartoEnVivo(remitos, [venta('caro', 'c', 1, 9)], cambios, descargas, [])
    expect(res.map((c) => `${c.choferId}:${c.estado}`)).toEqual(['caro:en_calle', 'beto:cargando', 'dani:volvio'])
    expect(res[2].vuelta).toEqual(new Date(2026, 8, 7, 15))
  })

  it('un chofer con ventas pero sin remito de carga aparece igual (para no perderlo de vista)', () => {
    const res = agruparRepartoEnVivo([], [venta('eva', 'c', 3, 9)], [], [], [])
    expect(res).toHaveLength(1)
    expect(res[0].cargado).toBe(0)
    expect(res[0].bajado).toBe(3)
    expect(res[0].estado).toBe('en_calle')
  })
})
