import { describe, it, expect } from 'vitest'
import { armarZplPallet, armarZplPrueba, escaparZpl, zplDeForma, ETIQUETA_PALLET } from './zplPallet'
import type { PalletProduccion } from '@/types'

const pallet = (extra: Partial<PalletProduccion> = {}): PalletProduccion => ({
  id: 'p1', codigo: 'DT-000091', numero: 91, plantaId: 'torcuato',
  productoId: 'picado_10kg', productoNombre: 'Hielo picado bolsa 10kg', unidades: 80,
  operador: { uid: 'u', nombre: 'Piris Enzo' },
  fechaFabricacion: { toDate: () => new Date(2026, 8, 14, 10, 8) } as PalletProduccion['fechaFabricacion'],
  createdAt: { toDate: () => new Date() } as PalletProduccion['createdAt'],
  ...extra,
})

describe('armarZplPallet (una banda por producto)', () => {
  const zpl = armarZplPallet(pallet())
  it('es una etiqueta ZPL completa, UTF-8, del rollo de 80 × 120 mm (8 puntos/mm)', () => {
    expect(ETIQUETA_PALLET).toEqual({ anchoMm: 80, altoMm: 120 })
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain('^PW640')
    expect(zpl).toContain('^LL960')
  })
  it('la banda: bloque negro con el código corto en blanco', () => {
    expect(zpl).toContain('^FO0,0^GB256,240,240^FS')
    expect(zpl).toContain('^FR^FH_^FDPIC^FS')
  })
  it('lleva producto, cantidad, código, día del año y el pie', () => {
    expect(zpl).toContain('^FDPICADO 10 KG^FS')
    expect(zpl).toContain('^FD80 BOLSAS^FS')
    expect(zpl).toContain('^FDDT-000091^FS')
    expect(zpl).toContain('^FDDÍA 257 · LUN 14/09^FS')
    expect(zpl).toContain('^FDDON TORCUATO · 10:08 · PIRIS ENZO^FS')
  })
  it('el QR y el código de barras los dibuja la impresora con el código en texto plano', () => {
    expect(zpl).toMatch(/\^BQN,2,\d+\^FDQA,DT-000091\^FS/)
    expect(zpl).toMatch(/\^BCN,\d+,N,N,N\^FDDT-000091\^FS/)
  })
  it('las barras dicen BARRAS, no bolsas', () => {
    expect(armarZplPallet(pallet({ productoId: 'barras_hielo', unidades: 56 }))).toContain('^FD56 BARRAS^FS')
  })
  it('en un rollo más grande se escala y se centra', () => {
    const grande = armarZplPallet(pallet(), { anchoMm: 100, altoMm: 150 })
    expect(grande).toContain('^PW800')
    expect(grande).toContain('^FO0,0^GB320,300,300^FS')
  })
})

describe('zplDeForma', () => {
  it('rectángulo lleno, con borde, círculo y diagonal', () => {
    expect(zplDeForma({ t: 'rect', x: 1, y: 2, w: 10, h: 5 })).toBe('^FO8,16^GB80,40,40^FS')
    expect(zplDeForma({ t: 'rect', x: 0, y: 0, w: 10, h: 5, borde: 1 })).toBe('^FO0,0^GB80,40,8^FS')
    expect(zplDeForma({ t: 'circulo', x: 1, y: 1, d: 10 })).toBe('^FO8,8^GC80,80,B^FS')
    expect(zplDeForma({ t: 'diagonal', x: 0, y: 0, w: 10, h: 30, grosor: 3 })).toBe('^FO0,0^GD80,240,24,B,R^FS')
  })
})

describe('escaparZpl', () => {
  it('protege los caracteres de comando y el prefijo hexadecimal', () => {
    expect(escaparZpl('a^b~c_d\\e')).toBe('a_5Eb_7Ec_5Fd_5Ce')
    expect(escaparZpl('Hielo picado · 10kg')).toBe('Hielo picado · 10kg')
  })
})

describe('armarZplPrueba', () => {
  it('dibuja el marco al borde con las medidas del rollo', () => {
    const z = armarZplPrueba({ anchoMm: 100, altoMm: 150 }, new Date(2026, 8, 14, 9, 0))
    expect(z).toContain('^GB792,1192,4')
    expect(z).toContain('100 x 150 mm')
    expect(z).toContain('14/9/2026 09:00')
  })
})
