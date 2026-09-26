import { describe, it, expect } from 'vitest'
import type { PalletProduccion } from '@/types'
import {
  minutosSinCargar, palletsDelTurno, palletsHasta, palletsPorHora, producidoVsVendido, resumirTurno, vendidoDePlanta,
} from './panelProduccion'

const T = (h: number, m = 0, dia = 28) => new Date(2026, 8, dia, h, m)
let n = 0
const pallet = (extra: Partial<PalletProduccion> & { en: Date }): PalletProduccion => {
  const { en, ...resto } = extra
  n++
  return {
    id: `p${n}`, codigo: `DT-${n}`, numero: n, plantaId: 'torcuato', productoId: 'bolsas_2kg_rolito',
    productoNombre: '', unidades: 460, operador: { uid: 'a', nombre: 'Ana' },
    fechaFabricacion: { toDate: () => en } as PalletProduccion['fechaFabricacion'],
    createdAt: { toDate: () => en } as PalletProduccion['createdAt'],
    ...resto,
  }
}
const manana = { nombre: 'Mañana', desde: '06:00', hasta: '14:00', capitan: { uid: 'c', nombre: 'Carlos' }, operarios: [{ uid: 'a', nombre: 'Ana' }, { uid: 'b', nombre: 'Beto' }] }
const noche = { nombre: 'Noche', desde: '22:00', hasta: '06:00' }

describe('palletsDelTurno', () => {
  it('sin foto, por hora; la noche incluye la madrugada del día siguiente', () => {
    const ps = [pallet({ en: T(23) }), pallet({ en: T(3, 0, 29) }), pallet({ en: T(7, 0, 29) })]
    expect(palletsDelTurno(ps, '2026-09-28', noche)).toHaveLength(2)
  })
  it('con foto, manda la foto aunque la hora caiga en otro turno', () => {
    const p = pallet({ en: T(15), turno: { nombre: 'Mañana', dia: '2026-09-28', capitan: null, dotacion: [] } })
    expect(palletsDelTurno([p], '2026-09-28', manana)).toHaveLength(1)
  })
})

describe('resumirTurno', () => {
  const ps = [
    pallet({ en: T(7), operador: { uid: 'a', nombre: 'Ana' }, tango: { estado: 'confirmado', numero: '1' } }),
    pallet({ en: T(8), operador: { uid: 'a', nombre: 'Ana' }, avisoRepetidoSeg: 20, productoId: 'bolsas_10kg_rolito', unidades: 88 }),
    pallet({ en: T(9), operador: { uid: 'x', nombre: 'Xavi' }, tango: { estado: 'error', ultimoError: 'caída' } }),
    pallet({ en: T(10), operador: { uid: 'b', nombre: 'Beto' }, anulacion: { motivo: 'error', por: { uid: 'e', nombre: 'E' }, en: {} as never } }),
  ]
  const r = resumirTurno(ps, manana)
  it('cuenta vigentes, kilos, calidad y Tango', () => {
    expect(r.pallets).toBe(3)
    expect(r.kilos).toBe(460 * 2 * 2 + 88 * 10)
    expect(r.anulados).toHaveLength(1)
    expect(r.repetidos).toBe(1)
    expect(r.tango.confirmados).toBe(1)
    expect(r.tango.pendientes).toBe(1)
    expect(r.tango.errores).toHaveLength(1)
    expect(r.ultimo).toEqual(T(9))
  })
  it('el equipo: capitán primero, asignados y quien cargó sin estar asignado', () => {
    expect(r.equipo.map((f) => [f.nombre, f.pallets, f.asignado, f.capitan])).toEqual([
      ['Carlos', 0, true, true],
      ['Ana', 2, true, false],
      ['Xavi', 1, false, false],
      ['Beto', 0, true, false],
    ])
    expect(r.equipo.find((f) => f.uid === 'b')?.anulados).toBe(1)
  })
})

describe('ritmo', () => {
  it('por hora, hasta una hora y minutos sin cargar', () => {
    const ps = [pallet({ en: T(6, 10) }), pallet({ en: T(6, 50) }), pallet({ en: T(8, 5) })]
    expect(palletsPorHora(ps, T(6), T(9)).map((h) => h.pallets)).toEqual([2, 0, 1])
    expect(palletsHasta(ps, T(7))).toBe(2)
    expect(minutosSinCargar(T(8, 5), T(8, 50))).toBe(45)
    expect(minutosSinCargar(null, T(8))).toBeNull()
  })
})

describe('producido contra vendido', () => {
  it('pasa lo vendido a pallets y da el balance', () => {
    const ps = [pallet({ en: T(7) }), pallet({ en: T(8) })]
    const vendido = vendidoDePlanta([{ porPlanta: { torcuato: { bolsas_2kg_rolito: 690 } } }, { porPlanta: { torcuato: { bolsas_2kg_rolito: 230 }, merlo: { bolsas_2kg_rolito: 999 } } }], 'torcuato')
    expect(vendido).toEqual({ bolsas_2kg_rolito: 920 })
    const [f] = producidoVsVendido(ps, vendido, ['bolsas_2kg_rolito'])
    expect(f).toMatchObject({ producidoPallets: 2, vendidoUnidades: 920, vendidoPallets: 2, balancePallets: 0 })
  })
})
