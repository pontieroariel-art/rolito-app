import { describe, it, expect } from 'vitest'
import { repartirPorViaje, ventasDelViaje, viajeDeVenta, type Ubicable, type ViajeCandidato } from './viajeDeVenta'

const ts = (iso: string) => ({ toDate: () => new Date(iso) })

const viaje = (id: string, camionId: string, iso: string, choferId = 'dep:21'): ViajeCandidato =>
  ({ id, camionId, choferId, fecha: ts(iso) } as ViajeCandidato)

const venta = (iso: string, extra: Partial<Ubicable> = {}): Ubicable =>
  ({ camionId: 'cam12', choferId: 'dep:21', fecha: ts(iso), ...extra })

describe('viajeDeVenta', () => {
  it('si la venta trae el viaje escrito, manda eso y no se calcula nada', () => {
    const v = venta('2026-09-18T09:00:00Z', { remitoId: 'rem-mañana' })
    expect(viajeDeVenta(v, [])).toBe('rem-mañana')
    expect(viajeDeVenta(v, [viaje('rem-otro', 'cam12', '2026-09-18T04:00:00Z')])).toBe('rem-mañana')
  })

  it('una venta vieja sin viaje se ubica por el camión y el día', () => {
    const viajes = [viaje('rem-a', 'cam12', '2026-09-18T04:00:00Z')]
    expect(viajeDeVenta(venta('2026-09-18T09:00:00Z'), viajes)).toBe('rem-a')
  })

  it('con dos viajes en el día, cae en el que estaba andando cuando se vendió', () => {
    const viajes = [
      viaje('rem-mañana', 'cam12', '2026-09-18T04:00:00Z'),
      viaje('rem-tarde',  'cam12', '2026-09-18T15:00:00Z'),
    ]
    expect(viajeDeVenta(venta('2026-09-18T09:00:00Z'), viajes)).toBe('rem-mañana')
    expect(viajeDeVenta(venta('2026-09-18T17:30:00Z'), viajes)).toBe('rem-tarde')
  })

  it('el camión varado no se lleva las ventas del camión que el chofer maneja hoy', () => {
    // El camión 12 quedó en la calle el 17 y su descarga se cuenta días después.
    // El 18 el chofer sale con el 30: sus ventas son del viaje del 30.
    const viajes = [
      viaje('rem-varado', 'cam12', '2026-09-17T04:00:00Z'),
      viaje('rem-hoy',    'cam30', '2026-09-18T04:00:00Z'),
    ]
    expect(viajeDeVenta(venta('2026-09-18T10:00:00Z', { camionId: 'cam30' }), viajes)).toBe('rem-hoy')
  })

  it('no cruza de día: una venta de hoy no cae en el viaje de ayer del mismo camión', () => {
    const viajes = [viaje('rem-ayer', 'cam12', '2026-09-17T04:00:00Z')]
    expect(viajeDeVenta(venta('2026-09-18T10:00:00Z'), viajes)).toBeNull()
  })

  it('el acompañante sin camión se ubica por el depósito del chofer', () => {
    const viajes = [viaje('rem-a', 'cam12', '2026-09-18T04:00:00Z', 'dep:21')]
    const sinCamion = { choferId: 'dep:21', fecha: ts('2026-09-18T09:00:00Z') }
    expect(viajeDeVenta(sinCamion, viajes)).toBe('rem-a')
  })

  it('sin nada con qué ubicarla devuelve null: esa plata se rinde por día', () => {
    expect(viajeDeVenta({ fecha: ts('2026-09-18T09:00:00Z') }, [viaje('rem-a', 'cam12', '2026-09-18T04:00:00Z')])).toBeNull()
    expect(viajeDeVenta(venta('2026-09-18T09:00:00Z'), [])).toBeNull()
  })

  it('una venta anterior a la salida (reloj corrido) cae en el primer viaje del día, no afuera', () => {
    const viajes = [viaje('rem-a', 'cam12', '2026-09-18T04:00:00Z')]
    expect(viajeDeVenta(venta('2026-09-18T03:45:00Z'), viajes)).toBe('rem-a')
  })
})

describe('repartirPorViaje', () => {
  const viajes = [
    viaje('rem-mañana', 'cam12', '2026-09-18T04:00:00Z'),
    viaje('rem-tarde',  'cam12', '2026-09-18T15:00:00Z'),
  ]

  it('parte las ventas del día entre los dos viajes y deja afuera lo que no se puede ubicar', () => {
    const movimientos = [
      venta('2026-09-18T08:00:00Z'),
      venta('2026-09-18T11:00:00Z'),
      venta('2026-09-18T16:00:00Z'),
      { fecha: ts('2026-09-18T12:00:00Z') },          // sin camión ni chofer
    ]
    const { porViaje, sinViaje } = repartirPorViaje(movimientos, viajes)
    expect(porViaje.get('rem-mañana')).toHaveLength(2)
    expect(porViaje.get('rem-tarde')).toHaveLength(1)
    expect(sinViaje).toHaveLength(1)
  })

  it('una venta que llega tarde se suma al viaje que le corresponde, no al último', () => {
    // Se vendió a las 8 y se subió recién a las 19, con el segundo viaje andando.
    const tardía = venta('2026-09-18T08:00:00Z', { remitoId: 'rem-mañana' })
    const { porViaje } = repartirPorViaje([tardía], viajes)
    expect(porViaje.get('rem-mañana')).toHaveLength(1)
    expect(porViaje.get('rem-tarde')).toBeUndefined()
  })
})

describe('ventasDelViaje', () => {
  it('trae solo las de ese viaje', () => {
    const viajes = [
      viaje('rem-mañana', 'cam12', '2026-09-18T04:00:00Z'),
      viaje('rem-tarde',  'cam12', '2026-09-18T15:00:00Z'),
    ]
    const movimientos = [venta('2026-09-18T08:00:00Z'), venta('2026-09-18T16:00:00Z')]
    expect(ventasDelViaje(movimientos, viajes, 'rem-tarde')).toHaveLength(1)
  })
})
