import { describe, expect, it } from 'vitest'
import type { Cobranza } from '@/types'
import { aRendidos, claveCheque, claveRetencion, decisionesCompletas, esRecibido, resumenValores, valoresEnPapel } from './valoresEnPapel'

const cob = (x: Partial<Cobranza>): Cobranza => ({ id: 'c1', origen: 'cobrador', registradoPor: { uid: 'u', nombre: 'N' }, clienteId: 'k', clienteNombre: 'Kiosco', importe: 0, formaPago: 'mixto', fecha: { toMillis: () => 0 }, ...x } as unknown as Cobranza)
const conValores = cob({
  numeroRecibo: 'RS-9',
  medios: { efectivo: 0, transferencia: 0,
    cheques: [{ numero: '77', bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-01', fechaAcreditacion: '2026-10-01', dias: 30, importe: 900 }],
    retenciones: [{ tipo: 'iibb_pba', nroCertificado: '5', importe: 100 }] },
})
const papel = valoresEnPapel([conValores, cob({ id: 'c2', formaPago: 'contado_efectivo', importe: 50 })])
const kCh = claveCheque(papel.cheques[0]), kRe = claveRetencion(papel.retenciones[0])

describe('valores en papel', () => {
  it('lista cheques y retenciones con su recibo y cliente', () => {
    expect(papel.cheques).toEqual([{ cobranzaId: 'c1', numeroRecibo: 'RS-9', clienteNombre: 'Kiosco', numero: '77', bancoNombre: 'Galicia', fechaAcreditacion: '2026-10-01', importe: 900 }])
    expect(papel.retenciones).toEqual([{ cobranzaId: 'c1', numeroRecibo: 'RS-9', clienteNombre: 'Kiosco', tipo: 'iibb_pba', nroCertificado: '5', importe: 100 }])
  })
  it('decisiones: sin tildar bloquea; "no entregado" sin motivo bloquea; completo deja pasar', () => {
    expect(decisionesCompletas(papel, {})).toMatchObject({ ok: false, faltanDecidir: [kCh, kRe] })
    expect(decisionesCompletas(papel, { [kCh]: { recibido: true }, [kRe]: { recibido: false, motivo: '  ' } })).toMatchObject({ ok: false, faltanDecidir: [], sinMotivo: [kRe] })
    expect(decisionesCompletas(papel, { [kCh]: { recibido: true }, [kRe]: { recibido: false, motivo: 'lo trae mañana' } }).ok).toBe(true)
    expect(decisionesCompletas({ cheques: [], retenciones: [] }, {}).ok).toBe(true)
  })
  it('aRendidos guarda la decisión en cada valor', () => {
    const r = aRendidos(papel, { [kCh]: { recibido: true }, [kRe]: { recibido: false, motivo: 'lo trae mañana ' } })
    expect(r.cheques[0]).toMatchObject({ numero: '77', importe: 900, cobranzaId: 'c1', numeroRecibo: 'RS-9', recibido: true })
    expect(r.cheques[0]).not.toHaveProperty('motivoNoEntregado')
    expect(r.retenciones[0]).toMatchObject({ tipo: 'iibb_pba', nroCertificado: '5', recibido: false, motivoNoEntregado: 'lo trae mañana' })
  })
  it('resumenValores separa recibidos de faltantes; ausente = recibido (docs viejos)', () => {
    const r = aRendidos(papel, { [kCh]: { recibido: true }, [kRe]: { recibido: false, motivo: 'x' } })
    expect(resumenValores(r.cheques, r.retenciones)).toEqual({
      cheques: { cantidad: 1, total: 900, recibidos: 1, faltantes: 0, totalFaltante: 0 },
      retenciones: { cantidad: 1, total: 100, recibidos: 0, faltantes: 1, totalFaltante: 100 },
      faltantes: { cantidad: 1, total: 100 },
    })
    expect(esRecibido({})).toBe(true)
    expect(esRecibido({ recibido: false })).toBe(false)
  })
})
