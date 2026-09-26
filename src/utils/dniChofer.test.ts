import { describe, expect, it } from 'vitest'
import { claveDniChofer } from './dniChofer'

describe('claveDniChofer', () => {
  it('un DNI de 8 dígitos queda igual', () => {
    expect(claveDniChofer('36024287')).toBe('36024287')
  })
  it('un DNI de 7 dígitos se completa con el 0 que trae el CUIT', () => {
    expect(claveDniChofer('7123456')).toBe('07123456')
    expect(claveDniChofer('7.123.456')).toBe('07123456')
  })
  it('lo que no es un DNI no busca nada', () => {
    expect(claveDniChofer('')).toBeNull()
    expect(claveDniChofer('123456')).toBeNull()
    expect(claveDniChofer('123456789')).toBeNull()
  })
})
