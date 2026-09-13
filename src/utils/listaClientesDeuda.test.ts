import { describe, expect, it } from 'vitest'
import {
  armarFilasDeuda, atrasoDe, conteosDe, filtrarFilas, ordenarPorPrioridad, zonasDe, type FilaDeuda,
} from './listaClientesDeuda'
import { ALERTAS_MORA_DEFAULT } from './mora'
import type { ClienteIndex, SaldoTango } from '@/types'

const ts = { toDate: () => new Date('2026-09-13T12:00:00') } as SaldoTango['actualizadoEn']

const saldo = (id: string, razonSocial: string, saldoTotal: number, atrasos: number[]): SaldoTango => ({
  id, idGva14: 1, codigoTango: `COD.${id}`, empresa: 'redonhielo', razonSocial,
  comprobantes: atrasos.map((d) => ({ tipo: 'FAC', numero: `A000101${id}`, importeOriginal: saldoTotal, saldoPendiente: saldoTotal, diasAtraso: d })),
  saldoTotal, actualizadoEn: ts, origen: 'sync',
} as SaldoTango)

const indice = (uid: string, localidad: string): ClienteIndex => ({
  uid, razonSocial: '', nombreContacto: '', cuit: '', codigos: [], sucursales: [],
  direccion: '', localidad, estado: 'activo', vinculadoTango: true,
})

// Grave (62 d), en mora (31 d), al día, y uno al día que YA se cobró hoy.
const saldos = [
  saldo('c1', 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)', 1480500, [62, 10]),
  // 31 días pero por debajo del umbral de importe: amarillo, no rojo.
  saldo('c2', 'DON SATUR S.R.L.', 108488.75, [31]),
  saldo('c3', '180BURGERBAR S.R.L.', 189200, [0]),
  saldo('c4', '17 DE SEPTIEMBRE S.R.L.', 52000, [0]),
]
const indices = [indice('c1', 'PALERMO'), indice('c2', 'VILLA DEVOTO'), indice('c3', 'PALERMO'), indice('c4', '')]
const filas = () => armarFilasDeuda(saldos, indices, [{ clienteId: 'c3' }], ALERTAS_MORA_DEFAULT)

describe('filas de la agenda del supervisor', () => {
  it('cruza el saldo con la localidad del índice y marca lo ya cobrado hoy', () => {
    const f = filas()
    expect(f.map((x) => x.uid)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(f[0]).toMatchObject({ diasAtraso: 62, nivel: 'rojo', localidad: 'PALERMO', comprobantes: 2, cobradoHoy: false })
    expect(f[1]).toMatchObject({ diasAtraso: 31, nivel: 'amarillo', localidad: 'VILLA DEVOTO' })
    expect(f[2]).toMatchObject({ nivel: 'ok', cobradoHoy: true })
    // Un cliente que no está en el índice no rompe: queda sin zona.
    expect(f[3].localidad).toBe('')
  })

  it('atrasoDe toma la factura más vieja y nunca devuelve negativo', () => {
    expect(atrasoDe({ comprobantes: [{ diasAtraso: 5 }, { diasAtraso: 62 }] } as SaldoTango)).toBe(62)
    expect(atrasoDe({ comprobantes: [] } as unknown as SaldoTango)).toBe(0)
  })

  it('ordena por urgencia y manda al fondo lo ya cobrado hoy', () => {
    // c3 está al día y ya se cobró: va último aunque deba más que c4.
    expect(ordenarPorPrioridad(filas()).map((f) => f.uid)).toEqual(['c1', 'c2', 'c4', 'c3'])
  })

  it('el filtro de mora se aplica SIEMPRE, con o sin texto buscado', () => {
    const f = filas()
    expect(filtrarFilas(f, { estado: 'deuda' }).length).toBe(4)
    expect(filtrarFilas(f, { estado: 'vencidos' }).map((x) => x.uid)).toEqual(['c1', 'c2'])
    // Este era el bug: sin texto, "mora" devolvía todo.
    expect(filtrarFilas(f, { estado: 'mora' }).map((x) => x.uid)).toEqual(['c1', 'c2'])
    expect(filtrarFilas(f, { estado: 'mora', coincide: (x) => x.uid === 'c2' }).map((x) => x.uid)).toEqual(['c2'])
  })

  it('filtra por zona y lista solo las zonas con clientes', () => {
    const f = filas()
    expect(zonasDe(f)).toEqual(['PALERMO', 'VILLA DEVOTO'])
    expect(filtrarFilas(f, { zona: 'PALERMO' }).map((x) => x.uid)).toEqual(['c1', 'c3'])
  })

  it('cuenta para los chips', () => {
    expect(conteosDe(filas())).toEqual({ deuda: 4, vencidos: 2, mora: 2 })
  })

  it('sin clientes no rompe', () => {
    const vacio: FilaDeuda[] = []
    expect(conteosDe(vacio)).toEqual({ deuda: 0, vencidos: 0, mora: 0 })
    expect(zonasDe(vacio)).toEqual([])
    expect(ordenarPorPrioridad(vacio)).toEqual([])
  })
})
