import { describe, expect, it } from 'vitest'
import { claimsDeUsuario, mismosClaims } from './claims'

describe('claims del token (2026-09-12)', () => {
  it('arma los claims desde el documento, solo con lo que hay', () => {
    expect(claimsDeUsuario({ rol: 'caja', estado: 'activo', planta: 'torcuato', rolesExtra: ['muelle'], autorizaAnulaciones: true, email: 'x' }))
      .toEqual({ rol: 'caja', estado: 'activo', planta: 'torcuato', rolesExtra: ['muelle'], autorizaAnulaciones: true })
    expect(claimsDeUsuario({ role: 'cliente' })).toEqual({ rol: 'cliente', estado: 'activo' })
    expect(claimsDeUsuario({ rol: 'chofer', rolesExtra: [], autorizaAnulaciones: false })).toEqual({ rol: 'chofer', estado: 'activo' })
    expect(claimsDeUsuario({ email: 'sin rol' })).toBeNull()
    expect(claimsDeUsuario(undefined)).toBeNull()
  })
  it('compara solo las claves propias, ignorando otras', () => {
    expect(mismosClaims({ rol: 'chofer', estado: 'activo', otra: 1 }, { rol: 'chofer', estado: 'activo' })).toBe(true)
    expect(mismosClaims({ rol: 'chofer', estado: 'activo' }, { rol: 'chofer', estado: 'inactivo' })).toBe(false)
    expect(mismosClaims({ rol: 'caja', estado: 'activo', rolesExtra: ['muelle'] }, { rol: 'caja', estado: 'activo' })).toBe(false)
    expect(mismosClaims(undefined, null)).toBe(true)
    expect(mismosClaims({ rol: 'x', estado: 'activo' }, null)).toBe(false)
  })
})
