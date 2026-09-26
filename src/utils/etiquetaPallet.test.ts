import { describe, it, expect } from 'vitest'
import { altoQueEntra, armarEtiquetaPallet, diaDelAnio, formasDelPatron, lineaDia, BANDA_ALTO, type Forma } from './etiquetaPallet'
import { PRODUCTOS_HIELO_LIST } from './produccionCatalogo'
import type { PalletProduccion } from '@/types'

const pallet = (productoId: PalletProduccion['productoId']): PalletProduccion => ({
  id: 'p', codigo: 'DT-000012', numero: 12, plantaId: 'torcuato', productoId,
  productoNombre: '', unidades: 88, operador: { uid: 'u', nombre: 'Piris Enzo' },
  fechaFabricacion: { toDate: () => new Date(2026, 8, 14, 16, 23) } as PalletProduccion['fechaFabricacion'],
  createdAt: { toDate: () => new Date() } as PalletProduccion['createdAt'],
})

const zona = { x: 33.5, y: 0, w: 46.5, h: BANDA_ALTO }
const dentro = (f: Forma) => {
  const [x, y, w, h] = f.t === 'circulo' ? [f.x, f.y, f.d, f.d] : 'w' in f ? [f.x, f.y, f.w, f.h] : [f.x, f.y, 0, 0]
  return x >= zona.x - 0.01 && y >= -0.01 && x + w <= zona.x + zona.w + 0.01 && y + h <= zona.h + 0.01
}

describe('formasDelPatron', () => {
  it('los siete productos tienen un patrón distinto', () => {
    const patrones = PRODUCTOS_HIELO_LIST.map((p) => p.patron)
    expect(new Set(patrones).size).toBe(7)
  })
  it('cada patrón dibuja algo y no se sale de su zona', () => {
    for (const p of PRODUCTOS_HIELO_LIST) {
      const formas = formasDelPatron(p.patron, zona)
      expect(formas.length, p.patron).toBeGreaterThan(0)
      for (const f of formas) expect(dentro(f), `${p.patron} ${JSON.stringify(f)}`).toBe(true)
    }
  })
  it('los patrones se diferencian por forma: rayas, cuadros, diagonales, marco, puntos', () => {
    expect(formasDelPatron('verticales', zona).every((f) => f.t === 'rect' && f.h === BANDA_ALTO)).toBe(true)
    expect(formasDelPatron('horizontales', zona).every((f) => f.t === 'rect' && f.w === zona.w)).toBe(true)
    expect(formasDelPatron('diagonales', zona).every((f) => f.t === 'diagonal')).toBe(true)
    expect(formasDelPatron('puntos', zona).every((f) => f.t === 'circulo')).toBe(true)
    expect(formasDelPatron('marco', zona)).toEqual([{ t: 'rect', ...zona, borde: 6 }])
  })
})

describe('fecha', () => {
  it('día del año y línea legible', () => {
    expect(diaDelAnio(new Date(2026, 0, 1))).toBe(1)
    expect(diaDelAnio(new Date(2026, 8, 14))).toBe(257)
    expect(diaDelAnio(new Date(2024, 11, 31))).toBe(366)
    expect(lineaDia(new Date(2026, 8, 14))).toBe('DÍA 257 · LUN 14/09')
  })
})

describe('armarEtiquetaPallet', () => {
  it('todo entra en el rollo de 80 × 120', () => {
    for (const p of PRODUCTOS_HIELO_LIST) {
      for (const f of armarEtiquetaPallet(pallet(p.id)).formas) {
        const [x, y, w, h] = f.t === 'circulo' ? [f.x, f.y, f.d, f.d] : f.t === 'qr' ? [f.x, f.y, f.lado, f.lado] : f.t === 'texto' ? [f.x, f.y, f.ancho, f.alto] : [f.x, f.y, f.w, f.h]
        expect(x >= 0 && y >= 0 && x + w <= 80.01 && y + h <= 120.01, `${p.id} ${JSON.stringify(f)}`).toBe(true)
      }
    }
  })
  it('los textos entran en su caja con la fuente de la Zebra', () => {
    for (const p of PRODUCTOS_HIELO_LIST) {
      for (const f of armarEtiquetaPallet(pallet(p.id)).formas) {
        if (f.t === 'texto') expect(f.texto.length * f.alto * 0.62, f.texto).toBeLessThanOrEqual(f.ancho + 0.5)
      }
    }
  })
  it('el código corto va grande y en blanco', () => {
    const cod = armarEtiquetaPallet(pallet('bolsas_10kg_rolito')).formas.find((f) => f.t === 'texto' && f.blanco)
    expect(cod).toMatchObject({ texto: '10', alto: 20 })
    expect(altoQueEntra('PIC', 28, 20)).toBeGreaterThan(14)
  })
})
