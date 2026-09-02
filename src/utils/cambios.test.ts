import { describe, expect, it } from 'vitest'
import { CatalogProducto } from '@/types'
import {
  articulosDeCambio, esIdCambio, idCambio, itemsDeCambio, nombreCambio, productoDelCambio,
} from './cambios'

const catalogo: CatalogProducto[] = [
  { id: 'bolsa_2kg',  nombre: 'Hielo bolsa 2kg',  unidad: 'bolsa', fotoUrl: 'x.jpg', destacado: true },
  { id: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', unidad: 'bolsa' },
]

describe('artículos de cambio', () => {
  it('hay uno por cada producto del catálogo', () => {
    const a = articulosDeCambio(catalogo)
    expect(a).toHaveLength(2)
    expect(a[0]).toMatchObject({ id: 'cambio_bolsa_2kg', nombre: 'Cambio Hielo bolsa 2kg', unidad: 'bolsa' })
  })

  it('conservan la foto para que la botonera se vea igual', () => {
    expect(articulosDeCambio(catalogo)[0].fotoUrl).toBe('x.jpg')
  })

  it('el id se puede ir y volver', () => {
    expect(idCambio('bolsa_2kg')).toBe('cambio_bolsa_2kg')
    expect(productoDelCambio('cambio_bolsa_2kg')).toBe('bolsa_2kg')
    expect(esIdCambio('cambio_bolsa_2kg')).toBe(true)
    expect(esIdCambio('bolsa_2kg')).toBe(false)
    // Un id que no es de cambio vuelve tal cual, sin recortar nada.
    expect(productoDelCambio('bolsa_2kg')).toBe('bolsa_2kg')
  })

  it('no arma el cambio del cambio', () => {
    const sucio = [...catalogo, { id: 'cambio_bolsa_2kg', nombre: 'Cambio Hielo bolsa 2kg', unidad: 'bolsa' }]
    const ids = articulosDeCambio(sucio).map((a) => a.id)
    expect(ids).toEqual(['cambio_bolsa_2kg', 'cambio_bolsa_10kg'])
  })

  it('nombreCambio antepone la palabra', () => {
    expect(nombreCambio('Barra de hielo')).toBe('Cambio Barra de hielo')
  })
})

describe('itemsDeCambio', () => {
  const articulos = articulosDeCambio(catalogo)

  it('siempre salen en $0: un cambio no se cobra', () => {
    const items = itemsDeCambio(articulos, { cambio_bolsa_2kg: 3 })
    expect(items).toEqual([
      { productoId: 'cambio_bolsa_2kg', nombre: 'Cambio Hielo bolsa 2kg', cantidad: 3, precioUnitario: 0 },
    ])
  })

  it('deja afuera lo que no se cargó', () => {
    expect(itemsDeCambio(articulos, { cambio_bolsa_2kg: 0, cambio_bolsa_10kg: 2 })).toHaveLength(1)
    expect(itemsDeCambio(articulos, {})).toEqual([])
  })
})
