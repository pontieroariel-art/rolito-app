import { describe, expect, it } from 'vitest'
import { ajusteDeStock, avisoRectificacion } from './descargaRectificada'

const item = (productoId: string, cantidad: number, nombre = productoId) => ({ productoId, nombre, cantidad })

describe('conteo rectificado: el ajuste que hay que hacer en Tango (2026-09-13)', () => {
  it('contó 6 y eran 60: hay que sumar 54 al depósito de planta', () => {
    expect(ajusteDeStock({ items: [item('b3', 6, 'Bolsa 3 kg')] }, { items: [item('b3', 60, 'Bolsa 3 kg')] }))
      .toEqual([{ nombre: 'Bolsa 3 kg', delta: 54 }])
  })

  it('contó de más: el delta es negativo', () => {
    expect(ajusteDeStock({ items: [item('b3', 100)] }, { items: [item('b3', 80)] }))
      .toEqual([{ nombre: 'b3', delta: -20 }])
  })

  it('un producto que no estaba, y uno que se va: los dos salen', () => {
    const r = ajusteDeStock({ items: [item('b3', 10)] }, { items: [item('esc', 4)] })
    expect(r).toEqual([{ nombre: 'b3', delta: -10 }, { nombre: 'esc', delta: 4 }])
  })

  it('los productos sin cambio no aparecen, y el orden es por tamaño del ajuste', () => {
    const r = ajusteDeStock(
      { items: [item('b3', 10), item('esc', 5), item('seco', 1)] },
      { items: [item('b3', 12), item('esc', 5), item('seco', 20)] },
    )
    expect(r).toEqual([{ nombre: 'seco', delta: 19 }, { nombre: 'b3', delta: 2 }])
  })

  it('si la original no está (borrada o fuera de alcance), todo lo contado es el ajuste', () => {
    expect(ajusteDeStock(undefined, { items: [item('b3', 7)] })).toEqual([{ nombre: 'b3', delta: 7 }])
  })

  it('la push dice el ajuste, el motivo y que el stock va a mano', () => {
    const { titulo, cuerpo } = avisoRectificacion(
      { items: [item('b3', 6, 'Bolsa 3 kg')] },
      {
        items: [item('b3', 60, 'Bolsa 3 kg')], choferNombre: 'Chofer Uno', depositoTango: '21',
        remitoCodigo: 'RC-DT-000123', motivoRectificacion: 'se tipeó 6 en vez de 60',
        registradoPor: { nombre: 'Muelle' },
      },
    )
    expect(titulo).toContain('Conteo corregido')
    expect(titulo).toContain('Chofer Uno')
    expect(cuerpo).toContain('RC-DT-000123')
    expect(cuerpo).toContain('depósito 21')
    expect(cuerpo).toContain('se tipeó 6 en vez de 60')
    expect(cuerpo).toContain('Ajuste en Tango: Bolsa 3 kg +54')
    expect(cuerpo).toContain('a mano')
  })

  it('si solo cambiaron las rotas o los envases, lo dice en vez de inventar un ajuste', () => {
    expect(avisoRectificacion({ items: [item('b3', 10)] }, { items: [item('b3', 10)] }).cuerpo)
      .toContain('Las cantidades quedaron iguales')
  })
})

describe('corrección después del cierre', () => {
  it('avisa que la liquidación ya cerrada no se reabre', () => {
    const { cuerpo } = avisoRectificacion(
      { items: [item('b3', 6)] },
      { items: [item('b3', 60)], choferNombre: 'Chofer Uno', registradoPor: { nombre: 'Muelle' } },
      'LQ-21-000015',
    )
    expect(cuerpo).toContain('LQ-21-000015')
    expect(cuerpo).toContain('no se reabre')
  })

  it('sin cierre no agrega ese texto', () => {
    const { cuerpo } = avisoRectificacion({ items: [item('b3', 6)] }, { items: [item('b3', 60)] })
    expect(cuerpo).not.toContain('no se reabre')
  })
})
