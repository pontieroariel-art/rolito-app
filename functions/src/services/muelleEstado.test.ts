import { describe, expect, it } from 'vitest'
import { calcularOcupadas, patenteDe, rangoDiaArt } from './muelleEstado'

describe('calcularOcupadas (estado público del muelle)', () => {
  it('carga, regreso y ventanilla ocupan su boca con etiqueta corta', () => {
    const o = calcularOcupadas(
      [
        { estado: 'salido',  choferId: 'b', camionLabel: 'WH143BB', regreso: { darsena: 3 } },
        { estado: 'salido',  choferId: 'd', camionLabel: 'EN CALLE' },                       // sin regreso: no ocupa
      ],
      [],
      [{ estado: 'pendiente_entrega', turnoEstado: 'llamado', darsena: 5, turno: 14 }, { estado: 'pendiente_entrega', turnoEstado: 'en_espera', darsena: 4, turno: 15 }],
      // El que carga es un BORRADOR: mientras carga, el remito no existe.
      [
        { estado: 'pendiente', camionLabel: 'AB123CD · Iveco', darsena: 1 },
        { estado: 'pendiente', camionLabel: 'SIN BOCA' },                                    // en espera: no ocupa
        { estado: 'aceptado',  camionLabel: 'YA SALIO', darsena: 2 },                        // ya tiene remito: libera
      ],
    )
    expect(o).toEqual({
      '1': { tipo: 'carga',      etiqueta: 'AB123CD' },
      '3': { tipo: 'regreso',    etiqueta: 'WH143BB' },
      '5': { tipo: 'ventanilla', etiqueta: 'T-14' },
    })
  })

  it('un camión ya contado libera la boca; el que volvió pisa al que carga en la misma boca', () => {
    const remitos = [{ estado: 'salido', choferId: 'b', camionLabel: 'WH143BB', regreso: { darsena: 2 } }]
    const cargando = [{ estado: 'pendiente', camionLabel: 'AB123CD', darsena: 2 }]
    expect(calcularOcupadas(remitos, [], [], cargando)['2']).toEqual({ tipo: 'regreso', etiqueta: 'WH143BB' })
    expect(calcularOcupadas(remitos, [{ choferId: 'b' }], [], cargando)['2']).toEqual({ tipo: 'carga', etiqueta: 'AB123CD' })
  })

  it('ignora dársenas inválidas y sin nada devuelve vacío', () => {
    expect(calcularOcupadas([], [], [], [{ estado: 'pendiente', darsena: 0 }])).toEqual({})
    expect(calcularOcupadas([], [], [])).toEqual({})
    expect(patenteDe(undefined)).toBe('')
  })

  it('el día operativo es en hora argentina', () => {
    // 2026-09-15 01:30 ART = 04:30 UTC → sigue siendo el 15.
    const r = rangoDiaArt(Date.UTC(2026, 8, 15, 4, 30))
    expect(r.ymd).toBe('2026-09-15')
    expect(r.desde.toDate().toISOString()).toBe('2026-09-15T03:00:00.000Z')
    // 2026-09-15 23:30 ART = 02:30 UTC del 16 → sigue siendo el 15.
    expect(rangoDiaArt(Date.UTC(2026, 8, 16, 2, 30)).ymd).toBe('2026-09-15')
  })
})
