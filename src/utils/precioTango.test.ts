import { describe, it, expect } from 'vitest'
import { precioTangoDe, motivoSinPrecioTango, empresaDeCanal, claveClienteTango, type PreciosTango } from './precioTango'

const precios: PreciosTango = {
  listas: {
    '301': { nombre: 'HABITUALES', incluyeIva: false, precios: { bolsa_10kg: 2000, barra: 8000 } },
    '1':   { nombre: 'ESTACION DE SERVICIO', incluyeIva: false, precios: { bolsa_10kg: 5200 } },
  },
  especiales: { FC_280: { bolsa_10kg: 1800 } },
}
const quiroga = { codigoTango: 'FC.280', listaTango: { redonhielo: 301, rolito: 1 } }

describe('precioTangoDe', () => {
  it('el precio especial del cliente le gana a la lista', () => {
    expect(precioTangoDe(precios, quiroga, 'redonhielo', 'bolsa_10kg')).toEqual({ precio: 1800, origen: 'especial' })
  })
  it('sin especial, usa la lista de la empresa del canal', () => {
    expect(precioTangoDe(precios, quiroga, 'redonhielo', 'barra')).toEqual({ precio: 8000, origen: 'lista', lista: { nro: 301, nombre: 'HABITUALES' } })
    expect(precioTangoDe(precios, { ...quiroga, codigoTango: 'OTRO' }, 'rolito', 'bolsa_10kg')?.precio).toBe(5200)
  })
  it('sin precio en la lista → null (no se inventa $0)', () => {
    expect(precioTangoDe(precios, quiroga, 'rolito', 'barra')).toBeNull()
    expect(precioTangoDe(precios, { codigoTango: 'X', listaTango: {} }, 'redonhielo', 'bolsa_10kg')).toBeNull()
    expect(precioTangoDe(null, quiroga, 'redonhielo', 'bolsa_10kg')).toBeNull()
  })
  it('precio 0 en Tango es "sin precio", no gratis (ni en lista ni en especial)', () => {
    const conCeros: PreciosTango = {
      listas: { '1': { nombre: 'ESTACION', incluyeIva: false, precios: { barra: 0, bolsa_10kg: 5200 } } },
      especiales: { X: { bolsa_10kg: 0 } },
    }
    expect(precioTangoDe(conCeros, { codigoTango: 'X', listaTango: { rolito: 1 } }, 'rolito', 'barra')).toBeNull()
    // especial en 0 → cae a la lista
    expect(precioTangoDe(conCeros, { codigoTango: 'X', listaTango: { rolito: 1 } }, 'rolito', 'bolsa_10kg')?.precio).toBe(5200)
  })
  it('claves con punto se codifican como en la sync', () => {
    expect(claveClienteTango('FC.280')).toBe('FC_280')
    expect(claveClienteTango('092435')).toBe('092435')
  })
  it('empresa por canal', () => {
    expect(empresaDeCanal('promo')).toBe('rolito')
    expect(empresaDeCanal('contado')).toBe('redonhielo')
    expect(empresaDeCanal(null)).toBe('redonhielo')
  })
})

describe('motivoSinPrecioTango', () => {
  it('explica por qué no hay precio', () => {
    expect(motivoSinPrecioTango(null, quiroga, 'redonhielo')).toMatch(/sincronizaron/)
    expect(motivoSinPrecioTango(precios, { listaTango: { redonhielo: 301 } }, 'redonhielo')).toMatch(/vinculado/)
    expect(motivoSinPrecioTango(precios, { codigoTango: 'X', listaTango: {} }, 'rolito')).toMatch(/lista de precios asignada.*Rolito/)
    expect(motivoSinPrecioTango(precios, { codigoTango: 'X', listaTango: { redonhielo: 999 } }, 'redonhielo')).toMatch(/999.*no existe/)
    expect(motivoSinPrecioTango(precios, quiroga, 'redonhielo')).toBeNull()
  })
})
