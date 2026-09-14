import { describe, it, expect } from 'vitest'
import type { Liquidacion, Sobre } from '@/types'
import { delTurno, liquidacionesPorRendir } from './turnoCaja'

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as import('firebase/firestore').Timestamp

describe('delTurno', () => {
  const docs = [{ id: 'a', cajaSesionId: '2026-09-14_u1_1' }, { id: 'b', cajaSesionId: '2026-09-14_u1_2' }, { id: 'legacy' }]
  it('el primer turno se lleva lo propio más lo que no tiene turno (docs anteriores al cambio)', () => {
    expect(delTurno(docs, { id: '2026-09-14_u1_1', numero: 1 }).map((d) => d.id)).toEqual(['a', 'legacy'])
  })
  it('a partir del segundo turno solo cuenta lo propio', () => {
    expect(delTurno(docs, { id: '2026-09-14_u1_2', numero: 2 }).map((d) => d.id)).toEqual(['b'])
  })
})

describe('liquidacionesPorRendir', () => {
  const liq = (id: string, uid: string, entregaId: string | null | undefined, ms = 0): Liquidacion =>
    ({ id, cerradaPor: { uid, nombre: uid }, entregaId, createdAt: ts(ms) } as unknown as Liquidacion)
  const sobre = (ids: string[]): Pick<Sobre, 'sistema'> => ({ sistema: { origenIds: { liquidacionesIds: ids } } } as unknown as Sobre)

  it('solo las que cerró este cajero, sin entrega y sin sobre previo, de la más vieja a la más nueva', () => {
    const ls = [liq('l3', 'u1', null, 30), liq('l1', 'u1', null, 10), liq('otro', 'u2', null), liq('entregada', 'u1', 'ET-1'), liq('vieja', 'u1', undefined), liq('l2', 'u1', null, 20)]
    expect(liquidacionesPorRendir(ls, 'u1', [sobre(['l2'])]).map((l) => l.id)).toEqual(['l1', 'l3'])
  })
  it('sin sobres previos entran todas las pendientes', () => {
    expect(liquidacionesPorRendir([liq('l1', 'u1', null)], 'u1', []).map((l) => l.id)).toEqual(['l1'])
  })
})
