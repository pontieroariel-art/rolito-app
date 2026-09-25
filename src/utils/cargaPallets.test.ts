import { describe, it, expect } from 'vitest'
import {
  accionDelToque, armar, ARMADO_MS, ANTI_DOBLE_TOQUE_MS, codigoDePallet,
  palletsVigentes, pendientesSinConfirmar, resumenDelDia, type PalletMinimo,
} from './cargaPallets'

const ts = (iso: string) => ({ toDate: () => new Date(iso) })
const pallet = (id: string, productoId: PalletMinimo['productoId'], iso: string): PalletMinimo =>
  ({ id, productoId, codigo: `DT-${id}`, fechaFabricacion: ts(iso) })

describe('accionDelToque', () => {
  const t0 = 1_000_000
  it('sin nada armado, el toque arma', () => {
    expect(accionDelToque(null, 'bolsas_2kg_rolito', t0)).toBe('armar')
  })
  it('tocar otro producto cambia la elección (arma el nuevo)', () => {
    expect(accionDelToque(armar('bolsas_2kg_rolito', t0), 'picado_10kg', t0 + 1000)).toBe('armar')
  })
  it('el segundo toque en la misma tarjeta confirma', () => {
    expect(accionDelToque(armar('bolsas_2kg_rolito', t0), 'bolsas_2kg_rolito', t0 + 1000)).toBe('confirmar')
  })
  it('un doble toque accidental (dedo que rebota) se ignora, no imprime', () => {
    expect(accionDelToque(armar('bolsas_2kg_rolito', t0), 'bolsas_2kg_rolito', t0 + ANTI_DOBLE_TOQUE_MS - 1)).toBe('ignorar')
    expect(accionDelToque(armar('bolsas_2kg_rolito', t0), 'bolsas_2kg_rolito', t0 + ANTI_DOBLE_TOQUE_MS)).toBe('confirmar')
  })
  it('pasado el plazo la tarjeta se vuelve a armar en vez de confirmar', () => {
    expect(accionDelToque(armar('bolsas_2kg_rolito', t0), 'bolsas_2kg_rolito', t0 + ARMADO_MS)).toBe('armar')
  })
})

describe('resumenDelDia', () => {
  const inicio = new Date(2026, 8, 14, 0, 0, 0)
  it('cuenta solo los de hoy, por producto y en total, y marca el último', () => {
    const r = resumenDelDia([
      pallet('a', 'bolsas_2kg_rolito', '2026-09-14T08:10:00'),
      pallet('b', 'bolsas_2kg_rolito', '2026-09-14T14:32:00'),
      pallet('c', 'picado_10kg', '2026-09-14T09:00:00'),
      pallet('z', 'barras_hielo', '2026-09-13T23:59:00'),   // ayer
    ], [], inicio)
    expect(r.total).toBe(3)
    expect(r.porProducto).toEqual({ bolsas_2kg_rolito: 2, picado_10kg: 1 })
    expect(r.ultimo?.codigo).toBe('DT-b')
  })
  it('suma los pendientes de esta tablet una sola vez aunque ya estén en el snapshot', () => {
    const p = pallet('p', 'escama_10kg', '2026-09-14T15:00:00')
    const r = resumenDelDia([p], [p, pallet('q', 'escama_10kg', '2026-09-14T15:05:00')], inicio)
    expect(r.total).toBe(2)
    expect(r.porProducto.escama_10kg).toBe(2)
    expect(r.ultimo?.codigo).toBe('DT-q')
  })
  it('vacío', () => {
    expect(resumenDelDia([], [], inicio)).toEqual({ total: 0, porProducto: {}, ultimo: null })
  })
  it('un pallet anulado no cuenta ni es el último', () => {
    const bueno = pallet('a', 'picado_10kg', '2026-09-14T10:00:00')
    const anulado = { ...pallet('b', 'escama_10kg', '2026-09-14T11:00:00'), anulacion: { motivo: 'error' } }
    const r = resumenDelDia([bueno, anulado], [], inicio)
    expect(r.total).toBe(1)
    expect(r.porProducto).toEqual({ picado_10kg: 1 })
    expect(r.ultimo?.codigo).toBe('DT-a')
  })
})

describe('palletsVigentes', () => {
  it('saca los anulados y conserva la referencia si no hay ninguno', () => {
    const a: { id: string; anulacion?: unknown } = { id: 'a' }
    const b = { id: 'b', anulacion: { motivo: 'x' } }
    expect(palletsVigentes([a, b])).toEqual([a])
    const lista = [a]
    expect(palletsVigentes(lista)).toBe(lista)
  })
})

describe('pendientesSinConfirmar', () => {
  it('saca los que el servidor ya devolvió y conserva la referencia si no cambió nada', () => {
    const a = { id: 'a' }, b = { id: 'b' }
    const pend = [a, b]
    expect(pendientesSinConfirmar(pend, [{ id: 'a' }])).toEqual([b])
    expect(pendientesSinConfirmar(pend, [{ id: 'x' }])).toBe(pend)
    expect(pendientesSinConfirmar([], [{ id: 'a' }])).toEqual([])
  })
})

describe('codigoDePallet', () => {
  it('prefijo de planta y seis dígitos', () => {
    expect(codigoDePallet('DT', 91)).toBe('DT-000091')
  })
})
