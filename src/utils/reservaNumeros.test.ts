import { describe, expect, it } from 'vitest'
import { integrarLote, unSoloPedido, type ReservaNumeros } from './reservaNumeros'

type R = { from: number; to: number; puntoVenta: number }
const vacia: ReservaNumeros<R> = { activo: null, siguiente: null, reservaEnCurso: null }
const lote = (from: number): R => ({ from, to: from + 9, puntoVenta: 3 })

describe('integrarLote (auditoría chofer M2)', () => {
  it('sin números activos, el lote pasa a ser el activo', () => {
    const { reserva, sobrante } = integrarLote(vacia, lote(100))
    expect(reserva.activo).toEqual({ ...lote(100), usedUpTo: 99 })
    expect(sobrante).toBeNull()
  })
  it('si otro pedido ya dejó números activos, el lote nuevo queda como siguiente y no se pisa nada', () => {
    const conActivo: ReservaNumeros<R> = { activo: { ...lote(100), usedUpTo: 101 }, siguiente: null, reservaEnCurso: 1 }
    const { reserva, sobrante } = integrarLote(conActivo, lote(110))
    expect(reserva.activo).toEqual({ ...lote(100), usedUpTo: 101 })
    expect(reserva.siguiente).toEqual(lote(110))
    expect(reserva.reservaEnCurso).toBeNull()
    expect(sobrante).toBeNull()
  })
  it('con activo y siguiente, el lote que sobra se informa en vez de pisar', () => {
    const llena: ReservaNumeros<R> = { activo: { ...lote(100), usedUpTo: 100 }, siguiente: lote(110), reservaEnCurso: null }
    const { reserva, sobrante } = integrarLote(llena, lote(120))
    expect(reserva.siguiente).toEqual(lote(110))
    expect(sobrante).toEqual(lote(120))
  })
  it('un activo agotado se reemplaza por el lote nuevo', () => {
    const agotado: ReservaNumeros<R> = { activo: { ...lote(100), usedUpTo: 109 }, siguiente: null, reservaEnCurso: null }
    expect(integrarLote(agotado, lote(110)).reserva.activo).toEqual({ ...lote(110), usedUpTo: 109 })
  })
})

describe('unSoloPedido', () => {
  it('dos pedidos simultáneos de la misma clave comparten el mismo resultado', async () => {
    let llamadas = 0
    const fn = () => new Promise<boolean>((res) => { llamadas++; setTimeout(() => res(true), 10) })
    const [a, b] = await Promise.all([unSoloPedido('remito:u1', fn), unSoloPedido('remito:u1', fn)])
    expect(a && b).toBe(true)
    expect(llamadas).toBe(1)
    await unSoloPedido('remito:u1', fn)
    expect(llamadas).toBe(2)
  })
})
