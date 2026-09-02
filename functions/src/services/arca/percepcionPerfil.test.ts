import { describe, it, expect } from 'vitest'
import { fechaDeVigencia, leerPercepcionDePerfil, PercepcionSinVigencia } from './percepcionPerfil'
import { percepcionVigente } from './comprobante'

/** Lo que devuelve Firestore para un Timestamp. */
const ts = (d: Date) => ({ toDate: () => d })

describe('fechaDeVigencia', () => {
  it('entiende el texto que escribe el importador del padrón', () => {
    const d = fechaDeVigencia('2026-09-01')
    expect(d?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
  })

  it('entiende un Timestamp de Firestore', () => {
    const real = new Date('2026-09-01T03:00:00.000Z')
    expect(fechaDeVigencia(ts(real))?.toISOString()).toBe(real.toISOString())
  })

  it('no entiende cualquier cosa', () => {
    for (const v of [undefined, null, '', 'ayer', '01/09/2026', 42, {}, ts(new Date(NaN))]) {
      expect(fechaDeVigencia(v)).toBeNull()
    }
  })
})

describe('leerPercepcionDePerfil', () => {
  const tributoId = 7

  it('lee la percepción escrita como texto', () => {
    // Este es el caso real: el importador guarda 'AAAA-MM-DD'. Leerlo como si
    // fuera un Timestamp fue lo que frenó la primera factura de producción.
    const p = leerPercepcionDePerfil({
      percepcionIIBB: { alicuota: 6, vigenciaDesde: '2026-09-01', vigenciaHasta: '2026-09-30' },
    }, tributoId)

    expect(p).toMatchObject({ alicuota: 6, tributoId: 7 })
    expect(p?.vigenciaDesde.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('lee la percepción escrita como Timestamp', () => {
    const p = leerPercepcionDePerfil({
      percepcionIIBB: {
        alicuota: 3,
        vigenciaDesde: ts(new Date('2026-09-01T03:00:00Z')),
        vigenciaHasta: ts(new Date('2026-09-30T03:00:00Z')),
      },
    }, tributoId)
    expect(p?.alicuota).toBe(3)
  })

  it('un cliente que no está en el padrón no lleva percepción', () => {
    expect(leerPercepcionDePerfil({}, tributoId)).toBeUndefined()
    expect(leerPercepcionDePerfil({ percepcionIIBB: { alicuota: 0 } }, tributoId)).toBeUndefined()
  })

  it('con alícuota pero sin vigencia NO se factura', () => {
    // Ante la duda, frenar: una alícuota del mes pasado no falla en ningún
    // lado, factura mal en silencio.
    expect(() => leerPercepcionDePerfil({
      percepcionIIBB: { alicuota: 6, vigenciaDesde: '2026-09-01' },
    }, tributoId)).toThrow(PercepcionSinVigencia)

    expect(() => leerPercepcionDePerfil({
      percepcionIIBB: { alicuota: 6, vigenciaDesde: 'cualquiera', vigenciaHasta: 'cosa' },
    }, tributoId)).toThrow(PercepcionSinVigencia)
  })
})

describe('lo que lee el trigger encaja con percepcionVigente', () => {
  const padronDeSeptiembre = {
    percepcionIIBB: { alicuota: 6, vigenciaDesde: '2026-09-01', vigenciaHasta: '2026-09-30' },
  }

  it('vale el primer día del mes, el último y los del medio', () => {
    const p = leerPercepcionDePerfil(padronDeSeptiembre, 7)!
    for (const dia of ['2026-09-01', '2026-09-02', '2026-09-30']) {
      // Mediodía en Argentina: una venta cualquiera del día.
      const venta = new Date(`${dia}T15:00:00.000Z`)
      expect(percepcionVigente(p, venta)).toEqual({ vigente: true })
    }
  })

  it('no vale antes ni después', () => {
    const p = leerPercepcionDePerfil(padronDeSeptiembre, 7)!
    expect(percepcionVigente(p, new Date('2026-08-31T15:00:00.000Z')).vigente).toBe(false)
    expect(percepcionVigente(p, new Date('2026-10-01T15:00:00.000Z')).vigente).toBe(false)
  })

  it('el último día sigue valiendo hasta la noche', () => {
    // 30/09 a las 23:00 de Argentina = 01/10 02:00 UTC. Si la fecha se anclara
    // a medianoche UTC, esta venta ya no encontraría vigente el padrón.
    const p = leerPercepcionDePerfil(padronDeSeptiembre, 7)!
    expect(percepcionVigente(p, new Date('2026-10-01T02:00:00.000Z'))).toEqual({ vigente: true })
  })
})
