import { describe, it, expect } from 'vitest'
import { claveDeDia, claveDeViaje, describirEstado, estadoDelViaje } from './estadoLiquidacion'
import type { CierreMercaderia, Liquidacion } from '../types'

const ts = (iso: string) => {
  const d = new Date(iso)
  return { toDate: () => d, toMillis: () => d.getTime() } as unknown as Liquidacion['createdAt']
}

const plata = (iso = '2026-09-18T10:00:00Z') => ({
  createdAt: ts(iso),
  cerradaPor: { uid: 'caja1', nombre: 'Nicolás' },
}) as Pick<Liquidacion, 'createdAt' | 'cerradaPor' | 'productos'>

const mercaderia = (iso = '2026-09-18T20:30:00Z') => ({
  contadaEn: ts(iso),
  contadaPor: { uid: 'muelle1', nombre: 'Jorge' },
}) as Pick<CierreMercaderia, 'contadaEn' | 'contadaPor'>

describe('estadoDelViaje', () => {
  it('sin ninguna de las dos partes, el viaje está abierto y faltan las dos', () => {
    const e = estadoDelViaje(null, null)
    expect(e.estado).toBe('abierta')
    expect(e.falta).toBe('ambas')
    expect(e.plata.hecha).toBe(false)
    expect(e.mercaderia.hecha).toBe(false)
    expect(e.cerradaEn).toBeUndefined()
    expect(describirEstado(e)).toBe('Sin liquidar')
  })

  it('con la mercadería contada y la plata sin liquidar sigue abierta (la vuelta nocturna)', () => {
    const e = estadoDelViaje(null, mercaderia())
    expect(e.estado).toBe('abierta')
    expect(e.falta).toBe('plata')
    expect(e.mercaderia.hecha).toBe(true)
    expect(e.mercaderia.por?.nombre).toBe('Jorge')
    expect(describirEstado(e)).toBe('Falta liquidar la plata')
  })

  it('con la plata liquidada y el camión todavía en la calle sigue abierta', () => {
    const e = estadoDelViaje(plata(), null)
    expect(e.estado).toBe('abierta')
    expect(e.falta).toBe('mercaderia')
    expect(e.plata.hecha).toBe(true)
    expect(e.plata.por?.nombre).toBe('Nicolás')
    expect(describirEstado(e)).toBe('Falta contar la mercadería')
  })

  it('con las dos partes queda cerrada, sin importar el orden en que llegaron', () => {
    const primeroLaPlata = estadoDelViaje(plata('2026-09-18T10:00:00Z'), mercaderia('2026-09-18T20:30:00Z'))
    const primeroElConteo = estadoDelViaje(plata('2026-09-18T20:30:00Z'), mercaderia('2026-09-18T10:00:00Z'))
    expect(primeroLaPlata.estado).toBe('cerrada')
    expect(primeroElConteo.estado).toBe('cerrada')
    expect(primeroLaPlata.falta).toBe('nada')
    expect(describirEstado(primeroLaPlata)).toBe('Cerrada')
  })

  it('la cerró la parte que llegó última', () => {
    const e = estadoDelViaje(plata('2026-09-18T10:00:00Z'), mercaderia('2026-09-18T20:30:00Z'))
    expect(e.cerradaEn?.toDate().toISOString()).toBe('2026-09-18T20:30:00.000Z')

    const alReves = estadoDelViaje(plata('2026-09-19T07:00:00Z'), mercaderia('2026-09-18T20:30:00Z'))
    expect(alReves.cerradaEn?.toDate().toISOString()).toBe('2026-09-19T07:00:00.000Z')
  })

  it('un cierre anterior al 18/09 traía la mercadería adentro: cuenta como cerrado entero', () => {
    const viejo = {
      ...plata(),
      productos: [{ productoId: 'hielo10', nombre: 'Hielo 10 kg', carga: 100, ventaContado: 80, ventaPromo: 0, cambios: 0, devolucionTeorica: 20, descarga: 20, diferencia: 0 }],
    } as Pick<Liquidacion, 'createdAt' | 'cerradaPor' | 'productos'>
    const e = estadoDelViaje(viejo, null)
    expect(e.estado).toBe('cerrada')
    expect(e.mercaderia.hecha).toBe(true)
    expect(e.mercaderia.por?.nombre).toBe('Nicolás')
  })

  it('un cierre nuevo sin productos NO se confunde con uno viejo: la mercadería falta', () => {
    const nuevo = { ...plata(), productos: [] } as Pick<Liquidacion, 'createdAt' | 'cerradaPor' | 'productos'>
    expect(estadoDelViaje(nuevo, null).falta).toBe('mercaderia')
  })

  it('si existe el cierre de mercadería, manda ese y no el snapshot viejo', () => {
    const viejo = {
      ...plata(),
      productos: [{ productoId: 'x', nombre: 'X', carga: 1, ventaContado: 0, ventaPromo: 0, cambios: 0, devolucionTeorica: 1, descarga: 1, diferencia: 0 }],
    } as Pick<Liquidacion, 'createdAt' | 'cerradaPor' | 'productos'>
    const e = estadoDelViaje(viejo, mercaderia())
    expect(e.mercaderia.por?.nombre).toBe('Jorge')
  })
})

describe('claves', () => {
  it('un viaje se guarda por su remito; un cobrador sin camión, por día', () => {
    expect(claveDeViaje('rem123')).toBe('rem123')
    expect(claveDeDia('2026-09-18', 'dep:31')).toBe('2026-09-18_dep:31')
  })
})
