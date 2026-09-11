import { describe, expect, it } from 'vitest'
import type { Rendicion, RollupPedidosDia } from '@/types'
import {
  atrasoSaldos, atrasoSync, estadoBridge, haceTexto, pedidosHoy, peorTono, rendicionesSinValidar,
  resumenArca, resumenCot, resumenOutbox, saldosEnHorario, tonoConteo,
} from './backofficeEstado'

const ahora = new Date(2026, 8, 10, 10, 30) // 10/09/2026 10:30 local
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000)

describe('tonos', () => {
  it('tonoConteo: sin dato neutro, cero ok, algo atención (o error si es grave)', () => {
    expect(tonoConteo(null)).toBe('neutro')
    expect(tonoConteo(0)).toBe('ok')
    expect(tonoConteo(3)).toBe('atencion')
    expect(tonoConteo(3, true)).toBe('error')
  })
  it('peorTono manda el peor', () => {
    expect(peorTono('ok', 'neutro')).toBe('ok')
    expect(peorTono('ok', 'atencion')).toBe('atencion')
    expect(peorTono('atencion', 'error', 'ok')).toBe('error')
    expect(peorTono()).toBe('neutro')
  })
})

describe('tiempos', () => {
  it('haceTexto', () => {
    expect(haceTexto(null, ahora)).toBe('nunca')
    expect(haceTexto(hace(0), ahora)).toBe('recién')
    expect(haceTexto(hace(5), ahora)).toBe('hace 5 min')
    expect(haceTexto(hace(3 * 60), ahora)).toBe('hace 3 h')
    expect(haceTexto(hace(3 * 24 * 60), ahora)).toBe('hace 3 d')
  })
  it('atrasoSync: dentro del máximo ok, pasado error, nunca corrió error', () => {
    expect(atrasoSync(hace(60), ahora, 26).tono).toBe('ok')
    expect(atrasoSync(hace(27 * 60), ahora, 26).tono).toBe('error')
    expect(atrasoSync(null, ahora, 26)).toEqual({ horas: null, tono: 'error', texto: 'nunca' })
  })
  it('estadoBridge: 5 minutos de tolerancia', () => {
    expect(estadoBridge(hace(2), ahora).tono).toBe('ok')
    expect(estadoBridge(hace(6), ahora).tono).toBe('error')
    expect(estadoBridge(undefined, ahora).texto).toBe('sin señal')
  })
  it('saldos: fuera de 6-22 no se juzga', () => {
    expect(saldosEnHorario(new Date(2026, 8, 10, 10))).toBe(true)
    expect(saldosEnHorario(new Date(2026, 8, 10, 23))).toBe(false)
    const noche = new Date(2026, 8, 10, 23, 30)
    expect(atrasoSaldos(new Date(noche.getTime() - 5 * 3_600_000), noche).tono).toBe('neutro')
    expect(atrasoSaldos(hace(3 * 60), ahora).tono).toBe('error')
    expect(atrasoSaldos(hace(30), ahora).tono).toBe('ok')
    expect(atrasoSaldos(null, noche).tono).toBe('error')
  })
})

describe('operación', () => {
  it('rendicionesSinValidar cuenta las que tesorería no revisó', () => {
    const rs = [{ validacion: null }, { validacion: { uid: 't', nombre: 'T' } }, { validacion: null }] as unknown as Rendicion[]
    expect(rendicionesSinValidar(rs)).toBe(2)
  })
  it('pedidosHoy: sin rollup todo en cero, con rollup copia total y estados', () => {
    expect(pedidosHoy(null)).toEqual({ total: 0, porEstado: { pendiente: 0, confirmado: 0, en_camino: 0, entregado: 0, cancelado: 0 } })
    const r = { fecha: '2026-09-10', total: 12, porEstado: { pendiente: 3, confirmado: 4, en_camino: 2, entregado: 3, cancelado: 1 } } as unknown as RollupPedidosDia
    expect(pedidosHoy(r).total).toBe(12)
    expect(pedidosHoy(r).porEstado.en_camino).toBe(2)
  })
})

describe('integraciones', () => {
  it('outbox: errores mandan; en curso normal; acumulación pide atención; sin dato neutro', () => {
    expect(resumenOutbox({ enCurso: 3, error: 0, consultasPendientes: 0, consultasError: 0, altasError: 0 })).toEqual({ tono: 'ok', errores: 0 })
    expect(resumenOutbox({ enCurso: 3, error: 1, consultasPendientes: 0, consultasError: 0, altasError: 2 })).toEqual({ tono: 'error', errores: 3 })
    expect(resumenOutbox({ enCurso: 30, error: 0, consultasPendientes: 0, consultasError: 0, altasError: 0 }).tono).toBe('atencion')
    expect(resumenOutbox({ enCurso: null, error: null, consultasPendientes: null, consultasError: null, altasError: null }).tono).toBe('neutro')
  })
  it('arca', () => {
    expect(resumenArca(true, 0, 0)).toEqual({ tono: 'ok', problemas: 0 })
    expect(resumenArca(true, 2, 1)).toEqual({ tono: 'error', problemas: 3 })
    expect(resumenArca(false, 0, 0).tono).toBe('neutro')
    expect(resumenArca(null, null, null).tono).toBe('neutro')
  })
  it('cot', () => {
    expect(resumenCot(true, 0, 0).tono).toBe('ok')
    expect(resumenCot(true, 2, 0).tono).toBe('atencion')
    expect(resumenCot(true, 0, 1).tono).toBe('error')
    expect(resumenCot(false, 0, 0).tono).toBe('neutro')
    expect(resumenCot(true, null, null).tono).toBe('neutro')
  })
})
