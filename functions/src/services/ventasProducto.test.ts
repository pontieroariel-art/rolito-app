import { describe, it, expect } from 'vitest'
import { mapaVentaAProduccion, sumarVendido } from './ventasProducto'

const articulosVenta = { bolsa_2kg: 'PTHIBOLROLI0002', bolsa_10kg: 'PTHIBOLROLI0010', agua_6l: 'PTANNAT0006SG', cambio_bolsa_2kg: 'CAMBIOHIELO2KG' }
const prodTorcuato = { bolsas_2kg_rolito: 'PTHIBOLROLI0002', bolsas_10kg_rolito: 'PTHIBOLROLI0010' }

describe('mapaVentaAProduccion', () => {
  it('cruza por artículo de Tango y deja afuera lo que no es producción', () => {
    expect(mapaVentaAProduccion(articulosVenta, [prodTorcuato])).toEqual({ bolsa_2kg: 'bolsas_2kg_rolito', bolsa_10kg: 'bolsas_10kg_rolito' })
  })
})

describe('sumarVendido', () => {
  const mapa = mapaVentaAProduccion(articulosVenta, [prodTorcuato])
  const plantaDe = (v: { plantaId?: string; remitoId?: string | null }) => v.plantaId ?? (v.remitoId === 'r1' ? 'torcuato' : null)

  it('suma por planta y producto, sin anuladas, sin agua ni cambios', () => {
    const r = sumarVendido([
      { plantaId: 'torcuato', items: [{ productoId: 'bolsa_2kg', cantidad: 100 }, { productoId: 'agua_6l', cantidad: 5 }] },
      { remitoId: 'r1', items: [{ productoId: 'bolsa_2kg', cantidad: 40 }, { productoId: 'bolsa_10kg', cantidad: 8 }] },
      { remitoId: 'r1', items: [{ productoId: 'bolsa_10kg', cantidad: 99 }], anulacion: { estado: 'anulada' } },
      { plantaId: 'torcuato', items: [{ productoId: 'cambio_bolsa_2kg', cantidad: 3 }] },
    ], mapa, plantaDe)
    expect(r).toEqual({ torcuato: { bolsas_2kg_rolito: 140, bolsas_10kg_rolito: 8 } })
  })
  it('una venta del camión sin viaje conocido va a sin_planta', () => {
    expect(sumarVendido([{ items: [{ productoId: 'bolsa_2kg', cantidad: 10 }] }], mapa, plantaDe)).toEqual({ sin_planta: { bolsas_2kg_rolito: 10 } })
  })
})
