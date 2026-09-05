import { describe, it, expect } from 'vitest'
import { diasEntre, validarFechasCheque } from './ChequeForm'

describe('validarFechasCheque (ley de cheques)', () => {
  const hoy = '2026-09-05'

  it('acepta un cheque al día y uno diferido a 30 días', () => {
    expect(validarFechasCheque('2026-09-05', '2026-09-05', hoy)).toBeNull()
    expect(validarFechasCheque('2026-09-05', '2026-10-05', hoy)).toBeNull()
    expect(diasEntre('2026-09-05', '2026-10-05')).toBe(30)
  })
  it('rechaza acreditación anterior a la emisión', () => {
    expect(validarFechasCheque('2026-09-05', '2026-09-04', hoy)).toMatch(/anterior a la emisión/)
  })
  it('rechaza emisión futura', () => {
    expect(validarFechasCheque('2026-09-06', '2026-09-06', hoy)).toMatch(/posterior a hoy/)
  })
  it('rechaza un diferido de más de 360 días', () => {
    expect(validarFechasCheque('2026-09-05', '2027-09-05', hoy)).toMatch(/360 días/)
    expect(validarFechasCheque('2026-09-05', '2027-08-31', hoy)).toBeNull()
  })
  it('acepta un cheque cuya fecha de cobro pasó hace 30 días o menos, y rechaza el vencido', () => {
    expect(validarFechasCheque('2026-07-01', '2026-08-06', hoy)).toBeNull()          // hace 30 días: todavía se deposita
    expect(validarFechasCheque('2026-07-01', '2026-08-05', hoy)).toMatch(/vencido/)   // hace 31 días
  })
})
