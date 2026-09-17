import { describe, expect, it } from 'vitest'
import { claveDia, diaDeReparto } from './diaReparto'

const ts = (d: Date) => ({ toDate: () => d })

describe('diaDeReparto', () => {
  it('el caso de Mira: contada el 17/09 a las 18:22 para el remito del 16/09 → 2026-09-16', () => {
    const descarga = { fecha: ts(new Date(2026, 8, 17, 18, 22)) }
    const remito = { fecha: ts(new Date(2026, 8, 16, 8, 6)) }
    expect(diaDeReparto(descarga, remito)).toBe('2026-09-16')
  })
  it('respeta el guardado aunque el remito diga otra cosa; sin remito cae al día del conteo', () => {
    expect(diaDeReparto({ diaReparto: '2026-09-15', fecha: ts(new Date(2026, 8, 17)) }, { fecha: ts(new Date(2026, 8, 16)) })).toBe('2026-09-15')
    expect(diaDeReparto({ fecha: new Date(2026, 8, 17, 6, 22) })).toBe('2026-09-17')
    expect(diaDeReparto({ diaReparto: 'basura', fecha: new Date(2026, 8, 17) })).toBe('2026-09-17')
  })
  it('claveDia es local y con ceros', () => {
    expect(claveDia(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
