import { describe, it, expect } from 'vitest'
import { armarZplPallet, armarZplPrueba, escaparZpl, ETIQUETA_PALLET } from './zplPallet'
import type { PalletProduccion } from '@/types'

const pallet = (extra: Partial<PalletProduccion> = {}): PalletProduccion => ({
  id: 'p1', codigo: 'DT-000091', numero: 91, plantaId: 'torcuato',
  productoId: 'picado_10kg', productoNombre: 'Hielo picado bolsa 10kg', unidades: 80,
  operador: { uid: 'u', nombre: 'Piris Enzo' },
  fechaFabricacion: { toDate: () => new Date(2026, 8, 14, 10, 8) } as PalletProduccion['fechaFabricacion'],
  createdAt: { toDate: () => new Date() } as PalletProduccion['createdAt'],
  ...extra,
})

describe('armarZplPallet', () => {
  const zpl = armarZplPallet(pallet())
  it('es una etiqueta ZPL completa, UTF-8, del tamaño del rollo (100 × 150 mm a 8 puntos/mm)', () => {
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^CI28')
    expect(zpl).toContain('^PW800')
    expect(zpl).toContain('^LL1200')
  })
  it('lleva el mismo contenido que el ticket en papel', () => {
    expect(zpl).toContain('PICADO · 10KG')          // etiqueta grande + peso, como ProduccionTicket
    expect(zpl).toContain('HORA FAB.: 10:08')
    expect(zpl).toContain('FECHA FAB.: 14/9/2026')
    expect(zpl).toContain('Piris Enzo')
    expect(zpl).toContain('Redonhielo S.A.')
    expect(zpl).toContain('Don Torcuato')
    expect(zpl).toContain('HIELO PICADO BOLSA 10KG')
  })
  it('el QR y el código de barras los dibuja la impresora con el código en texto plano', () => {
    expect(zpl).toMatch(/\^BQN,2,\d+\^FDQA,DT-000091\^FS/)
    expect(zpl).toMatch(/\^BCN,\d+,Y,N,N\^FDDT-000091\^FS/)
  })
  it('cuando la etiqueta grande es el peso no lo repite', () => {
    expect(armarZplPallet(pallet({ productoId: 'bolsas_10kg_rolito' }))).toContain('^FD10KG^FS')
  })
  it('escala con otro rollo', () => {
    const chico = armarZplPallet(pallet(), { anchoMm: 80, altoMm: 100 })
    expect(chico).toContain('^PW640')
    expect(chico).toContain('^LL800')
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
    const z = armarZplPrueba(ETIQUETA_PALLET, new Date(2026, 8, 14, 9, 0))
    expect(z).toContain('^GB792,1192,4')
    expect(z).toContain('100 x 150 mm')
    expect(z).toContain('14/9/2026 09:00')
  })
})
