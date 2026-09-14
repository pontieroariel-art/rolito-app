import { describe, it, expect } from 'vitest'
import { conteoDe, descargasVigentes, fueRectificada } from './rectificacionDescarga'
import type { DescargaCamion } from '../types'

const d = (id: string, rectificaA?: string) => ({ id, ...(rectificaA ? { rectificaA } : {}) })

describe('rectificación de un conteo (2026-09-13)', () => {
  it('sin correcciones valen todas', () => {
    expect(descargasVigentes([d('a'), d('b')]).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('la corrección reemplaza a la original: no suman las dos', () => {
    expect(descargasVigentes([d('a'), d('b', 'a')]).map((x) => x.id)).toEqual(['b'])
  })

  it('se puede corregir una corrección (la del medio también sale)', () => {
    expect(descargasVigentes([d('a'), d('b', 'a'), d('c', 'b')]).map((x) => x.id)).toEqual(['c'])
  })

  it('no toca las descargas de otras vueltas del día', () => {
    expect(descargasVigentes([d('a'), d('b', 'a'), d('segunda')]).map((x) => x.id)).toEqual(['b', 'segunda'])
  })

  it('una corrección que apunta a algo que no está en la lista igual vale', () => {
    // Pasa si el rango de fechas no incluye la original (vuelta de ayer).
    expect(descargasVigentes([d('b', 'de-ayer')]).map((x) => x.id)).toEqual(['b'])
  })

  it('fueRectificada marca la vieja, no la nueva', () => {
    const lista = [d('a'), d('b', 'a')]
    expect(fueRectificada(d('a'), lista)).toBe(true)
    expect(fueRectificada(d('b'), lista)).toBe(false)
  })

  it('conteoDe precarga lo que contó muelle, no el teórico', () => {
    const descarga = {
      items: [{ productoId: 'b3', nombre: 'Bolsa 3 kg', cantidad: 60 }],
      bolsasRotas: [{ productoId: 'esc', nombre: 'Escamas', cantidad: 2 }],
    } as unknown as DescargaCamion
    expect(conteoDe(descarga)).toEqual({ sanas: { b3: 60 }, rotas: { esc: 2 } })
  })
})
