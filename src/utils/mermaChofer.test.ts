import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { resumirMerma, type ViajeParaMerma } from './mermaChofer'
import type { DescargaCamion, RemitoCarga, VentaCamion } from '../types'

const TS = Timestamp.fromMillis(0)
const it3 = (cantidad: number) => ({ productoId: 'b3', nombre: 'Hielo 3kg', cantidad })

function viaje(chofer: string, o: { carga: number; vende: number; cambios: number; rotas: number; sanas: number; contado?: boolean }): ViajeParaMerma {
  const remito = {
    id: `rc-${chofer}-${o.carga}-${o.rotas}`, numero: 1, codigo: 'RC-DT-000001', plantaId: 'torcuato', camionId: 'cam', camionLabel: 'AAA',
    choferId: chofer, choferNombre: chofer.toUpperCase(), items: [it3(o.carga)], palletsCarga: 0, estado: 'emitido',
    creadoPor: { uid: 'caja', nombre: 'Caja' }, fecha: TS,
  } as RemitoCarga
  const venta = {
    id: 'v', canal: 'contado', camionId: 'cam', choferId: chofer, choferNombre: chofer, clienteId: 'c', clienteNombre: 'C',
    items: [{ ...it3(o.vende), precioUnitario: 1000 }], total: 0, formaPago: 'contado_efectivo', fecha: TS,
    cambios: o.cambios ? [{ productoId: 'cambio_b3', nombre: 'Cambio Hielo 3kg', cantidad: o.cambios, precioUnitario: 0 }] : [],
  } as VentaCamion
  const descargas = o.contado === false ? [] : [{
    id: 'd', plantaId: 'torcuato', camionId: 'cam', camionLabel: 'AAA', choferId: chofer, choferNombre: chofer,
    items: o.sanas ? [it3(o.sanas)] : [], bolsasRotas: o.rotas ? [it3(o.rotas)] : [],
    envases: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0, racks: [] },
    registradoPor: { uid: 'm', nombre: 'M' }, fecha: TS,
  } as DescargaCamion]
  return { remito, ventas: [venta], descargas, entregasFabrica: [] }
}

describe('resumirMerma (merma y faltantes por chofer)', () => {
  const precios = { b3: 1600 }

  it('ejemplo de Ariel: 5 cambios, 7 rotas, 2 sanas → 2 rotas en el camión y 1 faltante', () => {
    const r = resumirMerma([viaje('ana', { carga: 100, vende: 90, cambios: 5, rotas: 7, sanas: 2 })], precios)
    const c = r.choferes[0]!
    expect(c).toMatchObject({ viajes: 1, cargadas: 100, rotasCamion: 2, faltan: 1, importeRotas: 3200, importeFaltan: 1600, importeTotal: 4800 })
    expect(c.pctRotas).toBeCloseTo(2)
    expect(c.detalle[0]!.productos[0]!.explicacion).toHaveLength(2)
  })

  it('un cambio sin su rota es faltante, no rota en el camión', () => {
    const c = resumirMerma([viaje('ana', { carga: 100, vende: 90, cambios: 5, rotas: 3, sanas: 4 })], precios).choferes[0]!
    expect(c).toMatchObject({ rotasCamion: 0, faltan: 3 })
  })

  it('ordena por plata perdida, suma el total y no cuenta los viajes sin conteo', () => {
    const r = resumirMerma([
      viaje('ana', { carga: 100, vende: 90, cambios: 0, rotas: 1, sanas: 9 }),
      viaje('beto', { carga: 100, vende: 80, cambios: 0, rotas: 5, sanas: 10 }),
      viaje('beto', { carga: 50, vende: 10, cambios: 0, rotas: 0, sanas: 0, contado: false }),
    ], precios)
    expect(r.choferes.map((c) => c.choferNombre)).toEqual(['BETO', 'ANA'])
    expect(r.choferes[0]).toMatchObject({ viajes: 1, viajesSinContar: 1, cargadas: 100, rotasCamion: 5, faltan: 5 })
    expect(r.total).toMatchObject({ viajes: 2, viajesSinContar: 1, rotasCamion: 6, faltan: 5, importeTotal: 11 * 1600 })
  })

  it('avisa los productos sin precio en vez de valuarlos en cero sin decir nada', () => {
    const r = resumirMerma([viaje('ana', { carga: 10, vende: 5, cambios: 0, rotas: 2, sanas: 3 })], {})
    expect(r.sinPrecio).toEqual(['Hielo 3kg'])
    expect(r.total.importeTotal).toBe(0)
  })
})
