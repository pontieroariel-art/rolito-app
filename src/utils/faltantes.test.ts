import { describe, it, expect } from 'vitest'
import {
  calcularFaltante, describirFaltante, normalizarUmbralFaltantes,
  UMBRAL_FALTANTES_DEFAULT, type DiferenciaProducto,
} from './faltantes'

const dif = (nombre: string, diferencia: number): DiferenciaProducto =>
  ({ productoId: nombre, nombre, diferencia })

describe('calcularFaltante', () => {
  it('cuadrado: nada que revisar', () => {
    const r = calcularFaltante([dif('Bolsa 3 kg', 0), dif('Escamas', 0)])
    expect(r).toMatchObject({ bolsasFaltantes: 0, bolsasSobrantes: 0, grave: false })
    expect(r.productos).toEqual([])
  })

  it('un sobrante no compensa un faltante: son dos desvíos', () => {
    const r = calcularFaltante([dif('Bolsa 3 kg', -12), dif('Escamas', 12)], { habilitado: true, bolsas: 10 })
    expect(r.bolsasFaltantes).toBe(12)
    expect(r.bolsasSobrantes).toBe(12)
    expect(r.grave).toBe(true)
  })

  it('suma los faltantes de varios productos y los ordena de mayor a menor', () => {
    const r = calcularFaltante([dif('Bolsa 3 kg', -4), dif('Escamas', -9), dif('Hielo seco', 2)])
    expect(r.bolsasFaltantes).toBe(13)
    expect(r.productos.map((p) => p.nombre)).toEqual(['Escamas', 'Bolsa 3 kg'])
    expect(r.productos[0].faltan).toBe(9)
  })

  it('el umbral es inclusivo: justo en el umbral ya es grave', () => {
    expect(calcularFaltante([dif('Bolsa 3 kg', -10)], { habilitado: true, bolsas: 10 }).grave).toBe(true)
    expect(calcularFaltante([dif('Bolsa 3 kg', -9)], { habilitado: true, bolsas: 10 }).grave).toBe(false)
  })

  it('con el control apagado nunca es grave, pero el faltante se sigue informando', () => {
    const r = calcularFaltante([dif('Bolsa 3 kg', -80)], { habilitado: false, bolsas: 10 })
    expect(r.bolsasFaltantes).toBe(80)
    expect(r.grave).toBe(false)
  })
})

describe('normalizarUmbralFaltantes', () => {
  it('sin doc devuelve el default', () => {
    expect(normalizarUmbralFaltantes(null)).toEqual(UMBRAL_FALTANTES_DEFAULT)
  })

  it('descarta basura y cero (un umbral de 0 trabaría todos los días)', () => {
    expect(normalizarUmbralFaltantes({ bolsas: 0 }).bolsas).toBe(UMBRAL_FALTANTES_DEFAULT.bolsas)
    expect(normalizarUmbralFaltantes({ bolsas: -5 }).bolsas).toBe(UMBRAL_FALTANTES_DEFAULT.bolsas)
    expect(normalizarUmbralFaltantes({ bolsas: 'x' as unknown as number }).bolsas).toBe(UMBRAL_FALTANTES_DEFAULT.bolsas)
  })

  it('respeta el apagado explícito y redondea el umbral', () => {
    expect(normalizarUmbralFaltantes({ habilitado: false, bolsas: 12.4 })).toEqual({ habilitado: false, bolsas: 12 })
  })
})

describe('describirFaltante', () => {
  it('arma el texto del chip', () => {
    const r = calcularFaltante([dif('Bolsa 3 kg', -4), dif('Escamas', -9)])
    expect(describirFaltante(r)).toBe('Faltan 13 bolsas (9 Escamas, 4 Bolsa 3 kg)')
  })

  it('sin faltantes lo dice', () => {
    expect(describirFaltante(calcularFaltante([dif('Escamas', 3)]))).toBe('Sin faltantes')
  })
})
