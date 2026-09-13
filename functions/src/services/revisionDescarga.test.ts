import { describe, expect, it } from 'vitest'
import { calcularRevision, normalizarUmbralFaltantes, UMBRAL_FALTANTES_DEFAULT } from './revisionDescarga'

const item = (productoId: string, cantidad: number, nombre = productoId) => ({ productoId, nombre, cantidad })

describe('faltante de la descarga contada (2026-09-13)', () => {
  it('cuadrado: carga 100, vendió 80, volvieron 20 → sin faltante', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }],
      [{ items: [item('b3', 80)] }],
      [],
      [{ items: [item('b3', 20)] }],
    )
    expect(r).toMatchObject({ bolsasFaltantes: 0, bolsasSobrantes: 0, requiere: false })
  })

  it('faltan 15 con umbral de 10 → requiere revisión, con el detalle por producto', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100, 'Bolsa 3 kg')] }],
      [{ items: [item('b3', 80, 'Bolsa 3 kg')] }],
      [],
      [{ items: [item('b3', 5, 'Bolsa 3 kg')] }],
      { habilitado: true, bolsas: 10 },
    )
    expect(r.bolsasFaltantes).toBe(15)
    expect(r.requiere).toBe(true)
    expect(r.productos).toEqual([{ productoId: 'b3', nombre: 'Bolsa 3 kg', faltan: 15 }])
  })

  it('los cambios del camión bajan el teórico (la bolsa rota se entregó)', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }],
      [{ items: [item('b3', 80)], cambios: [item('cambio_b3', 10, 'Cambio b3')] }],
      [],
      [{ items: [item('b3', 10)] }],
    )
    expect(r.bolsasFaltantes).toBe(0)
  })

  it('una venta anulada con NC no cuenta: esa mercadería tenía que volver', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }],
      [
        { items: [item('b3', 80)] },
        { items: [item('b3', 20)], anulacion: { estado: 'anulada' } },
      ],
      [],
      [{ items: [item('b3', 20)] }],
    )
    expect(r.bolsasFaltantes).toBe(0)
    // Con la anulada contada como venta, el teórico habría sido 0 y las 20
    // bolsas que volvieron habrían pasado por sobrante.
    expect(r.bolsasSobrantes).toBe(0)
  })

  it('dos vueltas: suma los remitos y las dos descargas del día', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }, { items: [item('b3', 60)] }],
      [{ items: [item('b3', 140)] }],
      [],
      [{ items: [item('b3', 10)] }, { items: [item('b3', 10)] }],
    )
    expect(r.bolsasFaltantes).toBe(0)
  })

  it('un sobrante no tapa un faltante de otro producto', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 50, 'Bolsa 3 kg'), item('esc', 50, 'Escamas')] }],
      [],
      [],
      [{ items: [item('b3', 38, 'Bolsa 3 kg'), item('esc', 62, 'Escamas')] }],
      { habilitado: true, bolsas: 10 },
    )
    expect(r.bolsasFaltantes).toBe(12)
    expect(r.bolsasSobrantes).toBe(12)
    expect(r.requiere).toBe(true)
  })

  it('el registro viejo de cambiosCamion también baja el teórico', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }],
      [{ items: [item('b3', 80)] }],
      [item('cambio_b3', 20, 'Cambio b3')],
      [{ items: [] }],
    )
    expect(r.bolsasFaltantes).toBe(0)
  })

  it('con el control apagado informa el faltante pero no lo marca', () => {
    const r = calcularRevision(
      [{ items: [item('b3', 100)] }], [], [], [{ items: [item('b3', 1)] }],
      { habilitado: false, bolsas: 10 },
    )
    expect(r.bolsasFaltantes).toBe(99)
    expect(r.requiere).toBe(false)
  })

  it('normaliza el umbral que venga de config', () => {
    expect(normalizarUmbralFaltantes(null)).toEqual(UMBRAL_FALTANTES_DEFAULT)
    expect(normalizarUmbralFaltantes({ bolsas: 0 })).toEqual(UMBRAL_FALTANTES_DEFAULT)
    expect(normalizarUmbralFaltantes({ habilitado: false, bolsas: 25 })).toEqual({ habilitado: false, bolsas: 25 })
  })
})
