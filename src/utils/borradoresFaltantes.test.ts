import { describe, it, expect } from 'vitest'
import { borradoresFaltantes, camionesQueSalieronHoy } from './borradoresFaltantes'
import type { RemitoCarga } from '../types'

const ts = (iso: string) => {
  const d = new Date(iso)
  return { toDate: () => d, toMillis: () => d.getTime() } as RemitoCarga['fecha']
}

const remito = (camionId: string, salida: string | null, extra: Partial<RemitoCarga> = {}): RemitoCarga => ({
  id: `${camionId}-${salida ?? 'sin'}`,
  numero: 1,
  codigo: `RC-DT-0000${camionId}`,
  plantaId: 'torcuato',
  camionId,
  camionLabel: `${camionId} · Iveco`,
  choferId: `dep:${camionId}`,
  choferNombre: `Chofer ${camionId}`,
  items: [],
  palletsCarga: 0,
  estado: 'salido',
  creadoPor: { uid: 'caja1', nombre: 'Caja' },
  fecha: ts('2026-09-18T20:00:00'),
  ...(salida ? { salida: { uid: 'seg', nombre: 'Seguridad', hora: ts(salida) } } : {}),
  ...extra,
})

describe('camionesQueSalieronHoy', () => {
  it('agrupa por camión y se queda con la salida más temprana del día', () => {
    const cs = camionesQueSalieronHoy([
      remito('A', '2026-09-18T14:30:00'),
      remito('A', '2026-09-18T04:10:00'),
    ])
    expect(cs).toHaveLength(1)
    expect(cs[0].horaSalida).toBe('04:10')
    expect(cs[0].madrugada).toBe(true)
  })

  it('un camión que salió después de las 8 no es de madrugada', () => {
    const [c] = camionesQueSalieronHoy([remito('A', '2026-09-18T09:15:00')])
    expect(c.madrugada).toBe(false)
    expect(c.horaSalida).toBe('09:15')
  })

  it('un remito sin salida marcada cuenta igual, sin hora', () => {
    const [c] = camionesQueSalieronHoy([remito('A', null, { estado: 'emitido' })])
    expect(c.horaSalida).toBe('')
    expect(c.madrugada).toBe(false)
  })
})

describe('borradoresFaltantes', () => {
  const hoy = [
    remito('TARDE', '2026-09-18T11:00:00'),
    remito('MADRUGADA', '2026-09-18T04:10:00'),
    remito('SINHORA', null),
  ]

  it('separa los camiones sin borrador de los que ya lo tienen', () => {
    const { faltan, listos } = borradoresFaltantes(hoy, [{ camionId: 'TARDE' }])
    expect(faltan.map((f) => f.camionId)).toEqual(['MADRUGADA', 'SINHORA'])
    expect(listos.map((f) => f.camionId)).toEqual(['TARDE'])
  })

  it('los de madrugada van primero: son los que frenan un camión a las 4', () => {
    const { faltan } = borradoresFaltantes([
      remito('TARDE', '2026-09-18T11:00:00'),
      remito('TEMPRANO', '2026-09-18T05:00:00'),
      remito('MASTEMPRANO', '2026-09-18T03:30:00'),
    ], [])
    expect(faltan.map((f) => f.camionId)).toEqual(['MASTEMPRANO', 'TEMPRANO', 'TARDE'])
  })

  it('los que nunca marcaron salida quedan al final', () => {
    const { faltan } = borradoresFaltantes([remito('SINHORA', null), remito('TARDE', '2026-09-18T11:00:00')], [])
    expect(faltan.map((f) => f.camionId)).toEqual(['TARDE', 'SINHORA'])
  })

  it('sin remitos hoy no reclama nada', () => {
    expect(borradoresFaltantes([], []).faltan).toEqual([])
  })
})
