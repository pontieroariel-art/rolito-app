import { describe, expect, it } from 'vitest'
import { completarEmision, fechasDeFilasDetalle, podarMapa, rangoAPedir, iso } from './emisiones'

describe('fechasDeFilasDetalle', () => {
  it('mapea ID_GVA12 → fecha; con varios renglones por comprobante gana la primera; ignora filas incompletas', () => {
    const m = fechasDeFilasDetalle([
      { ID_GVA12: 372383, FECHA_DE_EMISION: '2026-09-02T00:00:00', COD_ARTICULO: 'A' },
      { ID_GVA12: 372383, FECHA_DE_EMISION: '2026-09-02T00:00:00', COD_ARTICULO: 'B' },
      { ID_GVA12: 370766, FECHA_DE_EMISION: '2026-08-10T00:00:00' },
      { ID_GVA12: 1, FECHA_DE_EMISION: null },
      { FECHA_DE_EMISION: '2026-08-10T00:00:00' },
    ])
    expect(m).toEqual({ '372383': '2026-09-02', '370766': '2026-08-10' })
  })
})

describe('completarEmision', () => {
  it('completa por ID_GVA12 y devuelve los que quedaron sin fecha', () => {
    const cs = [
      { idComprobanteTango: 372383, fechaVencimiento: '2026-09-10' },
      { idComprobanteTango: 999, fechaVencimiento: '2026-09-20' },
      { idComprobanteTango: 370766, fechaEmision: '2026-08-10' },
    ]
    const faltantes = completarEmision(cs, { '372383': '2026-09-02' })
    expect(cs[0].fechaEmision).toBe('2026-09-02')
    expect(cs[2].fechaEmision).toBe('2026-08-10')
    expect(faltantes).toEqual([{ idComprobanteTango: 999, fechaVencimiento: '2026-09-20' }])
  })
})

describe('podarMapa', () => {
  it('deja solo los ids en uso', () => {
    expect(podarMapa({ '1': '2026-01-01', '2': '2026-02-02', '3': '2026-03-03' }, [2, undefined, 3, 4])).toEqual({ '2': '2026-02-02', '3': '2026-03-03' })
  })
})

describe('rangoAPedir', () => {
  const hoy = new Date(2026, 8, 9)
  it('sin mapa: ventana máxima hacia atrás', () => {
    const r = rangoAPedir(undefined, hoy, [])!
    expect(iso(r.desde)).toBe('2025-08-05'); expect(iso(r.hasta)).toBe('2026-09-09')
  })
  it('con mapa al día y sin faltantes: nada que pedir; atrasado: desde hastaFecha − 3 días', () => {
    expect(rangoAPedir({ fechas: {}, hastaFecha: '2026-09-09' }, hoy, [])).toBeNull()
    const r = rangoAPedir({ fechas: {}, hastaFecha: '2026-09-07' }, hoy, [])!
    expect(iso(r.desde)).toBe('2026-09-04')
  })
  it('con faltantes: desde 120 días antes del vencimiento más viejo, con tope', () => {
    const r = rangoAPedir({ fechas: {}, hastaFecha: '2026-09-09' }, hoy, [{ fechaVencimiento: '2026-09-20' }, { fechaVencimiento: '2026-06-01' }])!
    expect(iso(r.desde)).toBe('2026-02-01')
    const lejos = rangoAPedir({ fechas: {}, hastaFecha: '2026-09-09' }, hoy, [{ fechaVencimiento: '2020-01-01' }])!
    expect(iso(lejos.desde)).toBe('2025-08-05')
  })
})
