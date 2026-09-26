import { describe, expect, it } from 'vitest'
import { esAyudante, rutaSoloDelChofer } from './ayudante'

describe('ayudante solo acompaña (auditoría chofer C1)', () => {
  it('reconoce al ayudante por el subrol', () => {
    expect(esAyudante({ subrol: 'ayudante' })).toBe(true)
    expect(esAyudante({ subrol: 'chofer' })).toBe(false)
    expect(esAyudante({})).toBe(false)
    expect(esAyudante(null)).toBe(false)
  })
  it('vender, cobrar, facturas, entregar y la ruta son del chofer', () => {
    for (const p of ['/chofer/venta', '/chofer/cobrar', '/chofer/ventas', '/chofer/entregar/abc', '/chofer/venta/', '/chofer/map']) {
      expect(rutaSoloDelChofer(p)).toBe(true)
    }
  })
  it('inicio, buscar cliente y manual quedan abiertos', () => {
    for (const p of ['/chofer', '/chofer/clientes', '/chofer/manual', '/chofer/ventasx']) {
      expect(rutaSoloDelChofer(p)).toBe(false)
    }
  })
})
