// Las reglas de Firestore tienen la lista de productos de producción FIJA
// (produccionPallets.create valida `productoId in [...]`). Si alguien agrega un
// producto al catálogo de la app y se olvida de las reglas, la tablet dice
// "registrado" (el write es fire-and-forget) y el pallet nunca llega. Este test
// convierte ese olvido silencioso en un fallo de CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PRODUCTOS_HIELO } from './produccionCatalogo'

function productosEnReglas(): string[] {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8')
  const bloque = rules.match(/match \/produccionPallets\/\{palletId\}[\s\S]*?productoId in \[([\s\S]*?)\]/)
  if (!bloque) throw new Error('No se encontró la lista de productoId en la regla de produccionPallets')
  return [...bloque[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

describe('catálogo de producción vs firestore.rules', () => {
  it('la lista de productos de la regla de produccionPallets es la misma que la del catálogo', () => {
    const app = Object.keys(PRODUCTOS_HIELO).sort()
    expect(productosEnReglas()).toEqual(app)
  })
})
