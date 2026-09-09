import { describe, expect, it } from 'vitest'
import type { EntregaTesoreria, Liquidacion, Rendicion } from '@/types'
import { armarEntrega, esperadoTesoreria, pendientesDeEntrega } from './entregaTesoreria'

const cheque = (numero: string, importe: number, recibido?: boolean) => ({ numero, bancoCodigo: '', bancoNombre: 'Galicia', fechaEmision: '', fechaAcreditacion: '2026-09-20', dias: 0, importe, cobranzaId: `cob-${numero}`, clienteNombre: 'Cli', ...(recibido === undefined ? {} : { recibido, ...(recibido ? {} : { motivoNoEntregado: 'lo tiene el chofer' }) }) })
const liq = (id: string, efectivoRecibido: number, extra: Partial<Liquidacion> = {}) => ({ id, fecha: '2026-09-09', plantaId: 'torcuato', choferId: id, choferNombre: `Chofer ${id}`, efectivoRecibido, entregaId: null, cheques: [], retenciones: [], ...extra }) as unknown as Liquidacion
const rend = (id: string, efectivoContado: number, liquidacionesIds: string[], extra: Partial<Rendicion> = {}) => ({ id, fecha: '2026-09-09', plantaId: 'torcuato', sujetoId: id, sujetoNombre: `Caja ${id}`, codigo: `RD-DT-${id}`, efectivoContado, liquidacionesIds, entregaId: null, cheques: [], retenciones: [], ...extra }) as unknown as Rendicion

describe('armarEntrega', () => {
  it('no cuenta dos veces el efectivo de una liquidación incluida en un cierre de caja', () => {
    const a = liq('A', 1000), b = liq('B', 2000)
    const r = rend('R', 5000, ['A'])
    const e = armarEntrega([a, b], [r])
    expect(e.efectivo).toEqual({ cierresCaja: 5000, liquidacionesSueltas: 2000, teorico: 7000 })
    expect(e.liquidaciones.map((l) => [l.id, l.incluidaEnCierre])).toEqual([['A', true], ['B', false]])
    expect(e.liquidacionIds).toEqual(['A', 'B']); expect(e.rendicionIds).toEqual(['R'])
  })
  it('lleva solo los valores que llegaron a caja, sin la decisión anterior (tesorería los vuelve a tildar)', () => {
    const b = liq('B', 0, { cheques: [cheque('11', 100, true)] })
    const r = rend('R', 0, [], { cheques: [cheque('22', 200, true), cheque('33', 300, false)] })
    const e = armarEntrega([b], [r])
    expect(e.cheques.map((c) => c.numero)).toEqual(['22', '11'])
    expect(e.cheques.every((c) => !('recibido' in c) && !('motivoNoEntregado' in c))).toBe(true)
  })
})

describe('pendientesDeEntrega', () => {
  it('filtra por planta y solo los que nacieron con entregaId null (los viejos sin el campo no cuentan)', () => {
    const p = pendientesDeEntrega([liq('A', 1), liq('B', 1, { entregaId: 'ET' }), liq('C', 1, { plantaId: 'merlo' }), { ...liq('D', 1), entregaId: undefined } as Liquidacion], [rend('R', 1, []), rend('S', 1, [], { entregaId: 'ET' })], 'torcuato')
    expect(p.liquidaciones.map((l) => l.id)).toEqual(['A']); expect(p.rendiciones.map((r) => r.id)).toEqual(['R'])
  })
})

describe('esperadoTesoreria', () => {
  it('esperado / pendiente / entregado / confirmado', () => {
    const a = liq('A', 1000, { entregaId: 'E1' }), b = liq('B', 2000)
    const r = rend('R', 5000, ['A'], { entregaId: 'E1', cheques: [cheque('22', 200, true)] })
    const e1 = { id: 'E1', plantaId: 'torcuato', estado: 'confirmada', efectivoEntregado: 5000, efectivoContado: 4990, cheques: [cheque('22', 200, false)], retenciones: [] } as unknown as EntregaTesoreria
    const e2 = { id: 'E2', plantaId: 'torcuato', estado: 'entregada', efectivoEntregado: 300, cheques: [], retenciones: [] } as unknown as EntregaTesoreria
    const x = esperadoTesoreria([a, b], [r], [e1, e2])
    expect(x.esperado.efectivo).toBe(7000); expect(x.esperado.cheques).toEqual({ cantidad: 1, total: 200 })
    expect(x.pendiente.efectivo).toBe(2000); expect(x.pendiente.cheques.cantidad).toBe(0)
    expect(x.entregado.efectivo).toBe(300)
    expect(x.confirmado.efectivo).toBe(4990); expect(x.confirmado.cheques.cantidad).toBe(0)
  })
})
