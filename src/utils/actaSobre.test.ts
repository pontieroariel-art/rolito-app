import { describe, expect, it } from 'vitest'
import type { Cobranza, Liquidacion } from '@/types'
import { personasDelActa } from './actaSobre'

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as Cobranza['fecha']
const cob = (x: Partial<Cobranza>): Cobranza => ({ id: 'c', origen: 'supervisor', registradoPor: { uid: 'ch1', nombre: 'Cristian' }, clienteId: 'k', clienteNombre: 'Cliente', importe: 0, formaPago: 'mixto', fecha: ts(1), ...x } as Cobranza)

describe('personasDelActa (acta del sobre, 2026-09-14)', () => {
  const cobranzas = [
    cob({ id: 'a', numeroRecibo: 'RS-000187', clienteNombre: 'ALCOVER', importe: 485247.74, fecha: ts(2), medios: { efectivo: 485247.74, transferencia: 0, cheques: [], retenciones: [] } }),
    cob({ id: 'b', numeroRecibo: 'RS-000190', clienteNombre: 'CARPINACCI', importe: 800000, fecha: ts(3), medios: { efectivo: 0, transferencia: 0, cheques: [{ numero: '03156837', bancoCodigo: '017', bancoNombre: 'BBVA', fechaEmision: '2026-09-14', fechaAcreditacion: '2026-09-17', dias: 3, importe: 800000 }], retenciones: [] } }),
    cob({ id: 'z', numeroRecibo: 'RS-000001', clienteNombre: 'OTRO', importe: 10, registradoPor: { uid: 'x', nombre: 'X' } }),
  ]
  const liq = {
    id: '2026-09-14_ch1', codigo: 'LQ-23-000003', choferId: 'ch1', choferNombre: 'Cristian González',
    importes: { contadoEfectivo: 0, contadoTransferencia: 0, cuentaCorriente: 0, total: 0 },
    cobranzasCalle: { cantidad: 2, efectivo: 485247.74, transferencia: 0, total: 1285247.74 },
    efectivoARendir: 485247.74, efectivoRecibido: 485250, diferenciaEfectivo: 2.26,
    cheques: [{ numero: '03156837', bancoCodigo: '017', bancoNombre: 'BBVA', fechaEmision: '2026-09-14', fechaAcreditacion: '2026-09-17', dias: 3, importe: 800000, cobranzaId: 'b', clienteNombre: 'CARPINACCI', recibido: true }],
    cobranzasIds: ['b', 'a', 'faltante'],
  } as unknown as Liquidacion

  it('arma una persona por liquidación con sus recibos ordenados por hora, efectivo y valores', () => {
    const [p] = personasDelActa([liq], cobranzas)
    expect(p.nombre).toBe('Cristian González')
    expect(p.recibos.map((r) => r.numeroRecibo)).toEqual(['RS-000187', 'RS-000190'])
    expect(p.recibos[0].efectivo).toBe(485247.74)
    expect(p.recibos[1].cheques).toEqual([{ numero: '03156837', bancoNombre: 'BBVA', importe: 800000 }])
    expect(p.cobranzasEfectivo).toBe(485247.74)
    expect(p.efectivoRecibido).toBe(485250)
    expect(p.valores).toEqual({ cheques: 1, chequesTotal: 800000, retenciones: 0, retencionesTotal: 0 })
    expect(p.recibosSinDetalle).toBe(1)
  })
  it('sin cobranzasCalle (liquidación vieja) suma el efectivo de los recibos que encontró', () => {
    const vieja = { ...liq, cobranzasCalle: undefined } as unknown as Liquidacion
    expect(personasDelActa([vieja], cobranzas)[0].cobranzasEfectivo).toBe(485247.74)
  })
})
