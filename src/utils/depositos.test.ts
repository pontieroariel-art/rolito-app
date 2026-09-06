import { describe, it, expect } from 'vitest'
import { depositoDeIdentidad, depositoDeUsuario, esIdentidadSintetica, etiquetaDeposito, identidadDeposito, nombreDeposito, ordenarDepositosReparto } from './depositos'
import type { DepositoTango } from '@/types'

const dep = (over: Partial<DepositoTango>): DepositoTango => ({
  codigo: '21', nombre: 'CRISTIAN PRIMITERRA', idSta22: 94, inhabilitado: false, tipo: 'repartidor', activo: true, uid: null, usuarioNombre: null, usuarioRol: null, ...over,
})

describe('depositos', () => {
  const primiterra = dep({ codigo: '21', uid: 'u21', usuarioNombre: 'Primiterra Cristian', usuarioRol: 'chofer' })
  const noain = dep({ codigo: '33', nombre: 'NOAIN 01' })
  const vinjoy = dep({ codigo: '24', nombre: 'MATIAS VINJOY', uid: 'u24', usuarioNombre: 'Matias Vinjoy', usuarioRol: 'supervisor' })
  const planta = dep({ codigo: '01', nombre: 'DON TORCUATO', tipo: 'planta' })
  const mermas = dep({ codigo: '99', nombre: 'MERMAS', tipo: 'interno' })
  const inactivo = dep({ codigo: '05', nombre: 'DIEGO VELAZQUEZ', activo: false })
  const inhabilitado = dep({ codigo: '81', nombre: 'DEMO', inhabilitado: true })

  it('la identidad es el uid del usuario o dep:<código>', () => {
    expect(identidadDeposito(primiterra)).toBe('u21')
    expect(identidadDeposito(noain)).toBe('dep:33')
    expect(esIdentidadSintetica('dep:33')).toBe(true)
    expect(esIdentidadSintetica('u21')).toBe(false)
  })

  it('etiqueta y nombre usan el usuario si lo hay, si no el nombre de Tango', () => {
    expect(etiquetaDeposito(primiterra)).toBe('21 · Primiterra Cristian')
    expect(etiquetaDeposito(noain)).toBe('33 · NOAIN 01')
    expect(nombreDeposito(vinjoy)).toBe('Matias Vinjoy')
    expect(nombreDeposito(noain)).toBe('NOAIN 01')
  })

  it('ordenarDepositosReparto: solo repartidores activos y habilitados, destacados primero, por código numérico', () => {
    const todos = [mermas, noain, primiterra, planta, vinjoy, inactivo, inhabilitado, dep({ codigo: '3', nombre: 'X' })]
    expect(ordenarDepositosReparto(todos).map((d) => d.codigo)).toEqual(['3', '21', '24', '33'])
    expect(ordenarDepositosReparto(todos, new Set(['dep:33', 'u24'])).map((d) => d.codigo)).toEqual(['24', '33', '3', '21'])
  })

  it('resuelve depósito por usuario y por identidad', () => {
    const todos = [noain, primiterra, vinjoy]
    expect(depositoDeUsuario(todos, 'u24')?.codigo).toBe('24')
    expect(depositoDeUsuario(todos, undefined)).toBeUndefined()
    expect(depositoDeIdentidad(todos, 'dep:33')?.codigo).toBe('33')
    expect(depositoDeIdentidad(todos, 'u21')?.codigo).toBe('21')
    expect(depositoDeIdentidad(todos, 'nadie')).toBeUndefined()
  })
})
