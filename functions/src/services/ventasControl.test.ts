import { describe, expect, it } from 'vitest'
import { avisoTotalDistinto, controlarTotal, totalDeItems } from './ventasControl'

describe('control del total de la venta contra sus renglones (2026-09-22)', () => {
  const items = [
    { productoId: 'bolsa_3kg', nombre: 'Hielo bolsa 3kg', cantidad: 311, precioUnitario: 3770 },
    { productoId: 'escamas_10kg', nombre: 'Hielo en escamas 10kg', cantidad: 2, precioUnitario: 4350.5 },
  ]

  it('suma cantidad por precio y redondea a centavos', () => {
    expect(totalDeItems(items)).toBe(311 * 3770 + 2 * 4350.5)
    expect(totalDeItems([])).toBe(0)
    expect(totalDeItems(undefined)).toBe(0)
    expect(totalDeItems([{ cantidad: 'dos', precioUnitario: 10 }])).toBe(0)
  })

  it('un total que cuadra (con $1 de tolerancia) no marca nada', () => {
    expect(controlarTotal({ items, total: 311 * 3770 + 2 * 4350.5 })).toBeNull()
    expect(controlarTotal({ items, total: 311 * 3770 + 2 * 4350.5 + 0.9 })).toBeNull()
    // Solo cambios, sin renglones: total 0 es correcto.
    expect(controlarTotal({ items: [], total: 0 })).toBeNull()
  })

  it('un total inventado queda marcado con lo declarado, lo esperado y la diferencia', () => {
    expect(controlarTotal({ items, total: 1 })).toEqual({ declarado: 1, esperado: 1181171, diferencia: -1181170 })
    expect(controlarTotal({ items, total: 2_000_000 })?.diferencia).toBe(2_000_000 - 1181171)
    expect(controlarTotal({ items: [], total: 500 })).toEqual({ declarado: 500, esperado: 0, diferencia: 500 })
  })

  it('el aviso dice quién, a quién y los dos importes', () => {
    const a = avisoTotalDistinto('ventasCamion', { choferNombre: 'PRIMITERRA CRISTIAN', clienteNombre: 'CYD' }, { declarado: 1, esperado: 1181171, diferencia: -1181170 })
    expect(a.titulo).toBe('Venta con total que no cuadra')
    expect(a.cuerpo).toContain('del camión de PRIMITERRA CRISTIAN a CYD')
    expect(a.cuerpo).toContain('declara $1')
    expect(a.cuerpo).toContain('1.181.171')
    expect(avisoTotalDistinto('ventasVentanilla', { cajaNombre: 'DIAZ NICOLAS', clienteNombre: 'X' }, { declarado: 5, esperado: 10, diferencia: -5 }).cuerpo).toContain('de ventanilla de DIAZ NICOLAS')
  })
})
