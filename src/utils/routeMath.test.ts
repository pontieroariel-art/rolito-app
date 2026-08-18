import { describe, it, expect } from 'vitest'
import { haversineKm, nearestNeighborOrder, timeStrToUnix, unixToTimeStr } from './routeMath'

describe('haversineKm', () => {
  it('da 0 para el mismo punto', () => {
    expect(haversineKm({ lat: -34.6037, lng: -58.3816 }, { lat: -34.6037, lng: -58.3816 })).toBe(0)
  })

  it('da ~4 km entre Plaza de Mayo y Congreso (Buenos Aires)', () => {
    const plazaDeMayo = { lat: -34.6083, lng: -58.3712 }
    const congreso    = { lat: -34.6095, lng: -58.3925 }
    const km = haversineKm(plazaDeMayo, congreso)
    expect(km).toBeGreaterThan(1.8)
    expect(km).toBeLessThan(2.2)
  })
})

describe('nearestNeighborOrder', () => {
  it('visita las paradas de más cerca a más lejos desde el origen', () => {
    const start = { lat: 0, lng: 0 }
    const lejos  = { lat: 0, lng: 10, id: 'lejos' }
    const cerca  = { lat: 0, lng: 1, id: 'cerca' }
    const media  = { lat: 0, lng: 5, id: 'media' }

    const ordered = nearestNeighborOrder(start, [lejos, cerca, media])

    expect(ordered.map((s) => s.id)).toEqual(['cerca', 'media', 'lejos'])
  })

  it('no pierde ni duplica paradas', () => {
    const start = { lat: 0, lng: 0 }
    const stops = [
      { lat: 1, lng: 1, id: 'a' },
      { lat: -1, lng: 2, id: 'b' },
      { lat: 3, lng: -1, id: 'c' },
    ]
    const ordered = nearestNeighborOrder(start, stops)
    expect(ordered).toHaveLength(stops.length)
    expect(new Set(ordered.map((s) => s.id))).toEqual(new Set(stops.map((s) => s.id)))
  })
})

describe('timeStrToUnix / unixToTimeStr', () => {
  it('hace round-trip de una hora válida', () => {
    const unix = timeStrToUnix('2026-08-18', '14:30')
    expect(unixToTimeStr(unix)).toBe('14:30')
  })

  it('devuelve 0 para un horario vacío o con formato inválido', () => {
    expect(timeStrToUnix('2026-08-18', '')).toBe(0)
    expect(timeStrToUnix('2026-08-18', '14h30')).toBe(0)
  })
})
