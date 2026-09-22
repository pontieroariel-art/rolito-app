import { describe, expect, it } from 'vitest'
import { claimsDeUsuario, debeEstarDeshabilitado, mismosClaims } from './claims'

describe('claims del token (2026-09-12)', () => {
  it('arma los claims desde el documento, solo con lo que hay', () => {
    expect(claimsDeUsuario({ rol: 'caja', estado: 'activo', planta: 'torcuato', rolesExtra: ['muelle'], autorizaAnulaciones: true, email: 'x' }))
      .toEqual({ rol: 'caja', estado: 'activo', planta: 'torcuato', rolesExtra: ['muelle'], autorizaAnulaciones: true })
    expect(claimsDeUsuario({ role: 'cliente' })).toEqual({ rol: 'cliente', estado: 'activo' })
    expect(claimsDeUsuario({ rol: 'chofer', rolesExtra: [], autorizaAnulaciones: false })).toEqual({ rol: 'chofer', estado: 'activo' })
    expect(claimsDeUsuario({ email: 'sin rol' })).toBeNull()
    expect(claimsDeUsuario(undefined)).toBeNull()
  })
  it('un cliente nunca lleva planta, roles adicionales ni permisos en el token (auditoría 2026-09-22)', () => {
    expect(claimsDeUsuario({ rol: 'cliente', estado: 'activo', rolesExtra: ['facturacion', 'tesoreria'], autorizaAnulaciones: true, planta: 'torcuato', area: 'x' }))
      .toEqual({ rol: 'cliente', estado: 'activo' })
    expect(claimsDeUsuario({ rol: 'cliente', estado: 'pendiente' })).toEqual({ rol: 'cliente', estado: 'pendiente' })
  })
  it('la baja (estado inactivo) deshabilita la cuenta; pendiente y activo no; sin doc no se toca', () => {
    expect(debeEstarDeshabilitado({ rol: 'chofer', estado: 'inactivo' })).toBe(true)
    expect(debeEstarDeshabilitado({ rol: 'cliente', estado: 'pendiente' })).toBe(false)
    expect(debeEstarDeshabilitado({ rol: 'caja', estado: 'activo' })).toBe(false)
    expect(debeEstarDeshabilitado({ tangoBridge: true })).toBe(false)
    expect(debeEstarDeshabilitado(undefined)).toBeNull()
  })
  it('compara solo las claves propias, ignorando otras', () => {
    expect(mismosClaims({ rol: 'chofer', estado: 'activo', otra: 1 }, { rol: 'chofer', estado: 'activo' })).toBe(true)
    expect(mismosClaims({ rol: 'chofer', estado: 'activo' }, { rol: 'chofer', estado: 'inactivo' })).toBe(false)
    expect(mismosClaims({ rol: 'caja', estado: 'activo', rolesExtra: ['muelle'] }, { rol: 'caja', estado: 'activo' })).toBe(false)
    expect(mismosClaims(undefined, null)).toBe(true)
    expect(mismosClaims({ rol: 'x', estado: 'activo' }, null)).toBe(false)
  })
})
