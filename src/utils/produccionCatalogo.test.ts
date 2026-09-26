import { describe, it, expect } from 'vitest'
import { productosDePlanta, PRODUCTOS_HIELO_LIST } from './produccionCatalogo'

describe('productosDePlanta', () => {
  it('Torcuato no hace barras (dato de Ariel, 2026-09-25)', () => {
    const ids = productosDePlanta('torcuato').map((p) => p.id)
    expect(ids).not.toContain('barras_hielo')
    expect(ids).toHaveLength(PRODUCTOS_HIELO_LIST.length - 1)
  })
  it('Merlo muestra todo por ahora, barras incluidas', () => {
    expect(productosDePlanta('merlo').map((p) => p.id)).toContain('barras_hielo')
  })
})
