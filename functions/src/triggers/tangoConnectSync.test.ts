import { describe, expect, it } from 'vitest'
import { agruparDeudaPorCliente, idGva14DeFila, mapaPorCodigo } from './tangoConnectSync'

// Filas tal como las devuelven las Live de deudas (verificado 2026-09-09 con
// PA.003 ALGAR): la de VENCIDAS trae ID_GVA14; la de A VENCER no.
const vencida = { ID_GVA14: 501, CLIENTE: 'PA.003 - ALGAR S.R.L.-SAN MIGUEL-', TIPO_COMPROBANTE: 'FAC', NRO_COMPROBANTE: 'A0010100281724', FECHA_DE_VENCIMIENTO: '2026-08-18T00:00:00', IMPORTE_PENDIENTE_CTE: 84216, DIAS_DE_ATRASO: 22 }
const aVencer = { CLIENTE: 'PA.003 - ALGAR S.R.L.-SAN MIGUEL-', TIPO_COMPROBANTE: 'FAC', NRO_COMPROBANTE: 'A0010100282787', FECHA_DE_VENCIMIENTO: '2026-09-10T00:00:00', IMPORTE_PENDIENTE_CTE: 84216 }
const desconocida = { CLIENTE: 'ZZ.999 - NADIE', TIPO_COMPROBANTE: 'FAC', NRO_COMPROBANTE: 'A0010100000001', IMPORTE_PENDIENTE_CTE: 1 }
const porCodigo = mapaPorCodigo(new Map([[501, { codigo: 'PA.003' }], [777, { codigo: 'FC.280' }]]))

describe('idGva14DeFila', () => {
  it('usa ID_GVA14 cuando viene, y si no resuelve por el código de CLIENTE', () => {
    expect(idGva14DeFila(vencida, porCodigo)).toBe(501)
    expect(idGva14DeFila(aVencer, porCodigo)).toBe(501)
    expect(idGva14DeFila(desconocida, porCodigo)).toBeNull()
    expect(idGva14DeFila({ CLIENTE: 'sin codigo' }, porCodigo)).toBeNull()
  })
})

describe('agruparDeudaPorCliente', () => {
  it('junta vencidas y a vencer del mismo cliente; cuenta las que no se pueden atribuir', () => {
    const { porCliente, sinCliente } = agruparDeudaPorCliente([vencida, aVencer, desconocida], 'redonhielo', porCodigo)
    expect(sinCliente).toBe(1)
    const algar = porCliente.get(501)!
    expect(algar.codGva14).toBe('PA.003')
    expect(algar.comprobantes.map((c) => c.numero)).toEqual(['A0010100281724', 'A0010100282787'])
    expect(algar.comprobantes[1]).toMatchObject({ fechaVencimiento: '2026-09-10', saldoPendiente: 84216 })
  })
})
