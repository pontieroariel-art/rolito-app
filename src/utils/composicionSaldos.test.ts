import { describe, expect, it } from 'vitest'
import { agruparPorEmpresaYCodigo, atrasoMaximo, claveComp, empresaDe } from './composicionSaldos'
import type { ComprobanteSaldoTango } from '@/types'

const c = (over: Partial<ComprobanteSaldoTango>): ComprobanteSaldoTango => ({
  tipo: 'FAC', numero: 'A0010100000001', fechaEmision: '2026-08-01', importeOriginal: 100, saldoPendiente: 100, ...over,
})

describe('composición de saldos', () => {
  it('agrupa por empresa (Redonhielo primero) y por código, con subtotal en centavos exactos', () => {
    const b = agruparPorEmpresaYCodigo([
      c({ empresa: 'rolito', codigoTango: 'FC.280', saldoPendiente: 0.1 }),
      c({ empresa: 'redonhielo', codigoTango: 'FC.280', saldoPendiente: 0.2 }),
      c({ empresa: 'redonhielo', codigoTango: 'FC.281', saldoPendiente: 0.3 }),
      c({ codigoTango: 'FC.280', saldoPendiente: 0.4 }),   // sin empresa → Redonhielo
    ])
    expect(b.map((x) => `${x.grupo.empresa}:${x.grupo.codigo}=${x.subtotal}`)).toEqual(['redonhielo:FC.280=0.6', 'redonhielo:FC.281=0.3', 'rolito:FC.280=0.1'])
  })

  it('claves y atraso', () => {
    expect(empresaDe(c({}))).toBe('redonhielo')
    expect(claveComp(c({ empresa: 'rolito', codigoTango: 'X' }))).toBe('rolito|X|FAC|A0010100000001')
    expect(atrasoMaximo([c({ diasAtraso: 3 }), c({}), c({ diasAtraso: 40 })])).toBe(40)
    expect(atrasoMaximo([])).toBe(0)
  })
})
