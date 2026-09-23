import { describe, it, expect } from 'vitest'
import {
  calcularFaltante, describirFaltante, normalizarUmbralFaltantes, textoFaltante,
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

describe('calcularFaltante sin descarga contada', () => {
  it('con el camión en la calle no hay faltante ni desvío grave, aunque la devolución teórica sea enorme', () => {
    // El caso real del 14/09: carga 1.098, vendidas 150, descarga 0 → "faltan 948".
    const r = calcularFaltante([dif('Hielo bolsa 2kg', -770), dif('Hielo bolsa 10kg', -176)], UMBRAL_FALTANTES_DEFAULT, { hayDescarga: false })
    expect(r).toEqual({ bolsasFaltantes: 0, bolsasSobrantes: 0, productos: [], grave: false, sinDescarga: true })
    expect(describirFaltante(r)).toBe('Sin descarga contada todavía')
  })

  it('con descarga contada el cálculo es el de siempre', () => {
    const r = calcularFaltante([dif('Hielo bolsa 2kg', -12)], UMBRAL_FALTANTES_DEFAULT, { hayDescarga: true })
    expect(r.bolsasFaltantes).toBe(12)
    expect(r.grave).toBe(true)
    expect(r.sinDescarga).toBeUndefined()
  })
})

describe('textoFaltante', () => {
  const p = (nombre: string, faltan: number) => ({ nombre, faltan })
  it('hielo en bolsa: dice bolsas', () => {
    expect(textoFaltante([p('Hielo bolsa 3kg', 12), p('Hielo en escamas 10kg', 8)])).toBe('20 bolsas')
    expect(textoFaltante([p('Hielo picado bolsa 10kg', 1)])).toBe('1 bolsa')
  })
  it('un solo producto que no es bolsa: va con su nombre (el caso del agua, 2026-09-23)', () => {
    expect(textoFaltante([p('Agua desmineralizada x 6 litros', 20)])).toBe('20 de Agua desmineralizada x 6 litros')
    expect(textoFaltante([p('Bidón auxiliar 5lts (33 unidades)', 33)])).toBe('33 de Bidón auxiliar 5lts (33 unidades)')
  })
  it('mezcla de hielo y otra cosa: unidades', () => {
    expect(textoFaltante([p('Hielo bolsa 3kg', 12), p('Agua de mesa x 6 litros', 3)])).toBe('15 unidades')
    expect(textoFaltante([p('Barra de hielo', 1), p('Anticorrosivo', 0)], 1)).toBe('1 unidad')
  })
  it('respeta el total que le pasan (la suma ya viene calculada)', () => {
    expect(textoFaltante([p('Hielo bolsa 2kg', 5)], 5)).toBe('5 bolsas')
  })
  it('describirFaltante usa la misma regla', () => {
    const r = calcularFaltante([dif('Agua desmineralizada x 6 litros', -20)])
    expect(describirFaltante(r)).toBe('Faltan 20 de Agua desmineralizada x 6 litros (20 Agua desmineralizada x 6 litros)')
  })
})
