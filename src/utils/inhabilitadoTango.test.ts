import { describe, expect, it } from 'vitest'
import { empresasInhabilitado, etiquetaInhabilitado, inhabilitadoEnTango, motivoInhabilitado } from './inhabilitadoTango'

describe('inhabilitado en Tango por empresa', () => {
  it('solo el false explícito inhabilita; ausente o true es habilitado', () => {
    expect(inhabilitadoEnTango({ habilitadoTango: { redonhielo: false, rolito: true } }, 'redonhielo')).toBe(true)
    expect(inhabilitadoEnTango({ habilitadoTango: { redonhielo: false, rolito: true } }, 'rolito')).toBe(false)
    expect(inhabilitadoEnTango({ habilitadoTango: {} }, 'redonhielo')).toBe(false)
    expect(inhabilitadoEnTango({}, 'redonhielo')).toBe(false)
    expect(inhabilitadoEnTango(null, 'rolito')).toBe(false)
  })
  it('lista y etiqueta', () => {
    expect(empresasInhabilitado({ habilitadoTango: { rolito: false } })).toEqual(['rolito'])
    expect(empresasInhabilitado({ habilitadoTango: { redonhielo: false, rolito: false } })).toEqual(['redonhielo', 'rolito'])
    expect(etiquetaInhabilitado(['rolito'])).toBe('Inhabilitado en Rolito')
    expect(etiquetaInhabilitado(['redonhielo', 'rolito'])).toBe('Inhabilitado en Tango')
    expect(etiquetaInhabilitado([])).toBe('')
    expect(etiquetaInhabilitado(undefined)).toBe('')
    expect(motivoInhabilitado('redonhielo')).toContain('Redonhielo')
  })
})
