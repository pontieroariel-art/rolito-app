import { describe, it, expect } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { mensajeErrorLoginProduccion } from './errorLoginProduccion'

describe('mensajeErrorLoginProduccion', () => {
  it('legajo inexistente, PIN mal, sin señal y demasiados intentos no se reportan', () => {
    expect(mensajeErrorLoginProduccion(new Error('legajo-not-found'))).toEqual({ mensaje: 'Legajo no encontrado', inesperado: false })
    expect(mensajeErrorLoginProduccion(new FirebaseError('auth/invalid-credential', 'x')).mensaje).toBe('Legajo o PIN incorrecto')
    expect(mensajeErrorLoginProduccion(new FirebaseError('auth/network-request-failed', 'x')).inesperado).toBe(false)
    expect(mensajeErrorLoginProduccion(new FirebaseError('auth/too-many-requests', 'x')).mensaje).toMatch(/Esperá/)
  })
  it('lo raro se reporta', () => {
    expect(mensajeErrorLoginProduccion(new FirebaseError('auth/internal-error', 'x'))).toEqual({ mensaje: 'Error al ingresar (auth/internal-error)', inesperado: true })
    expect(mensajeErrorLoginProduccion('nada').inesperado).toBe(true)
  })
})
