import { describe, expect, it } from 'vitest'
import { avisoDesvio, avisoResolucion } from './desviosDescarga'

const base = {
  fecha: '2026-09-13', choferNombre: 'Chofer Uno', depositoTango: '21',
  bolsasFaltantes: 42, productos: [{ nombre: 'Hielo 3 kg', faltan: 42 }],
  motivo: 'a_investigar', nota: 'se recontó dos veces',
  solicitadoPor: { uid: 'caja1', nombre: 'Daniel' },
}

describe('avisos del faltante a autorizar (2026-09-13)', () => {
  it('la push al autorizante dice cuánto falta, de quién y que caja está esperando', () => {
    const { titulo, cuerpo } = avisoDesvio(base)
    expect(titulo).toBe('Faltan 42 bolsas: Chofer Uno')
    expect(cuerpo).toContain('Depósito 21')
    expect(cuerpo).toContain('Hielo 3 kg -42')
    expect(cuerpo).toContain('lo pidió Daniel')
    expect(cuerpo).toContain('Caja espera para cerrar')
  })

  it('sin depósito ni nota no deja restos de texto', () => {
    const { cuerpo } = avisoDesvio({ ...base, depositoTango: undefined, nota: '' })
    expect(cuerpo).not.toContain('Depósito')
    expect(cuerpo).toContain('día 2026-09-13')
  })

  it('aprobado: le dice al cajero que ya puede cerrar', () => {
    const { titulo, cuerpo } = avisoResolucion({ ...base, estado: 'aprobada', resueltaPor: { nombre: 'Gerencia' }, notaResolucion: 'lo vemos mañana' })
    expect(titulo).toBe('Faltante autorizado: Chofer Uno')
    expect(cuerpo).toContain('Gerencia autorizó')
    expect(cuerpo).toContain('lo vemos mañana')
  })

  it('rechazado: el cuerpo ES la instrucción, que es lo que el cajero necesita', () => {
    const { titulo, cuerpo } = avisoResolucion({ ...base, estado: 'rechazada', resueltaPor: { nombre: 'Gerencia' }, notaResolucion: 'que el muelle lo recuente' })
    expect(titulo).toContain('RECHAZADO')
    expect(cuerpo).toBe('Gerencia: que el muelle lo recuente')
  })

  it('rechazado sin nota igual dice algo útil', () => {
    expect(avisoResolucion({ ...base, estado: 'rechazada', resueltaPor: { nombre: 'G' } }).cuerpo)
      .toBe('G: hay que revisarlo antes de cerrar')
  })
})
