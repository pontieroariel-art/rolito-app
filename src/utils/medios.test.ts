import { describe, expect, it } from 'vitest'
import { textoCheque } from './medios'

describe('textoCheque', () => {
  it('lleva número, banco, emisión y fecha de pago; distingue el e-cheq', () => {
    expect(textoCheque({ numero: '00778123', bancoNombre: 'Banco Galicia', fechaEmision: '2026-09-24', fechaAcreditacion: '2026-11-08', dias: 45, esEcheq: true }))
      .toBe('e-cheq Nº 00778123 · Banco Galicia · emitido 24/09 · paga 08/11 (45 días)')
    expect(textoCheque({ numero: '00045712', bancoNombre: 'Banco Nación', fechaEmision: '2026-09-24', fechaAcreditacion: '2026-10-09', dias: 15 }))
      .toBe('cheque Nº 00045712 · Banco Nación · emitido 24/09 · paga 09/10 (15 días)')
    expect(textoCheque({ numero: '1', bancoNombre: 'Banco', fechaEmision: '', fechaAcreditacion: '', dias: 0 }))
      .toBe('cheque Nº 1 · Banco · emitido — · paga —')
  })
})
import type { Cobranza } from '@/types'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from './medios'

const base = { id: 'c', origen: 'caja', registradoPor: { uid: 'u', nombre: 'N' }, clienteId: 'x', clienteNombre: 'X', fecha: { toMillis: () => 0 } } as unknown as Cobranza

describe('medios de una cobranza', () => {
  it('cobranza simple vieja: por formaPago', () => {
    expect(efectivoDe({ ...base, importe: 1000, formaPago: 'contado_efectivo' })).toBe(1000)
    expect(transferenciaDe({ ...base, importe: 1000, formaPago: 'contado_efectivo' })).toBe(0)
    expect(transferenciaDe({ ...base, importe: 700, formaPago: 'contado_transferencia' })).toBe(700)
    expect(chequesDe(base)).toEqual([])
    expect(retencionesDe(base)).toEqual([])
  })
  it('cobranza completa: por medios', () => {
    const c: Cobranza = {
      ...base, importe: 2500, formaPago: 'mixto',
      medios: { efectivo: 1000, transferencia: 500, cheques: [{ numero: '1', bancoCodigo: '007', bancoNombre: 'G', fechaEmision: '2026-09-09', fechaAcreditacion: '2026-09-09', dias: 0, importe: 800 }], retenciones: [{ tipo: 'iibb_pba', nroCertificado: '9', importe: 200 }] },
    }
    expect(efectivoDe(c)).toBe(1000)
    expect(transferenciaDe(c)).toBe(500)
    expect(sumaImportes(chequesDe(c))).toBe(800)
    expect(sumaImportes(retencionesDe(c))).toBe(200)
  })
})
