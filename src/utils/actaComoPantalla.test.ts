import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { Cobranza, Liquidacion, Sobre, VentaVentanilla } from '@/types'
import { cajonPorEmpresa, seccionesDelActa } from './actaComoPantalla'

const ts = (hhmm: string) => Timestamp.fromDate(new Date(`2026-09-24T${hhmm}:00`))
const venta = (id: string, hhmm: string, canal: 'contado' | 'promo', formaPago: VentaVentanilla['formaPago'], total: number, extra: Partial<VentaVentanilla> = {}) =>
  ({ id, canal, formaPago, total, fecha: ts(hhmm), clienteNombre: `Cliente ${id}`, items: [], ...extra }) as unknown as VentaVentanilla
const cheque = (numero: string, importe: number) => ({ numero, bancoCodigo: '007', bancoNombre: 'Banco Galicia', fechaEmision: '2026-09-24', fechaAcreditacion: '2026-10-09', dias: 15, importe })
const cobranza = (id: string, hhmm: string, empresa: 'redonhielo' | 'rolito', medios: Cobranza['medios']) =>
  ({ id, fecha: ts(hhmm), empresa, clienteNombre: `Cliente ${id}`, numeroRecibo: `RS-${id}`, importe: 0, medios, origen: 'caja' }) as unknown as Cobranza

const sobre = {
  sistema: {
    efectivo: 300, cheques: [{ ...cheque('1', 100), empresa: 'redonhielo' }, { ...cheque('2', 45), empresa: 'rolito' }], retenciones: [],
    porEmpresa: { redonhielo: { efectivo: 200 }, rolito: { efectivo: 100 } },
  },
} as unknown as Sobre

describe('seccionesDelActa', () => {
  it('arma las dos secciones con los mismos bloques y columnas que la pantalla', () => {
    const ventas = [
      venta('v1', '08:00', 'contado', 'contado_efectivo', 96800),
      venta('v2', '08:45', 'promo', 'contado_efectivo', 16000),
      venta('v3', '10:30', 'contado', 'cuenta_corriente', 120000),
      venta('v4', '11:15', 'contado', 'contado_transferencia', 58080),
      venta('v5', '11:20', 'contado', 'contado_efectivo', 1000, { anulacion: { estado: 'anulada' } } as Partial<VentaVentanilla>),
    ]
    const cobranzas = [
      cobranza('c1', '09:20', 'redonhielo', { efectivo: 15000, transferencia: 0, cheques: [], retenciones: [] }),
      cobranza('c2', '10:10', 'rolito', { efectivo: 5000, transferencia: 0, cheques: [cheque('00120044', 45000)], retenciones: [] }),
      cobranza('c3', '11:40', 'redonhielo', { efectivo: 0, transferencia: 20000, cheques: [{ ...cheque('00778123', 70000), esEcheq: true }], retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-1', importe: 3500, fecha: '2026-09-24' }] }),
    ]
    const liquidaciones = [{
      id: 'l1', codigo: 'LQ-31-000003', choferNombre: 'Supervisor', efectivoRecibido: 210000, diferenciaEfectivo: 0, createdAt: ts('11:50'),
      conteoBilletes: { redonhielo: { total: 150000 }, rolito: { total: 60000 } },
      cheques: [{ ...cheque('00009921', 80000), cobranzaId: 'x', clienteNombre: 'Cliente', numeroRecibo: 'RS-000102', recibido: true, empresa: 'redonhielo' }],
      retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-2', importe: 5000, fecha: '2026-09-24', cobranzaId: 'x', clienteNombre: 'Cliente', recibido: true, empresa: 'redonhielo' }],
    }] as unknown as Liquidacion[]
    const anticipos = [{ id: 'a1', codigo: 'VA-DT-000001', anticipo: { empresa: 'redonhielo' }, sistema: { efectivo: 50000 }, cerradaEn: ts('12:10'), custodia: { nombre: 'Teso' }, entrega: { recibio: { nombre: 'Teso' } } }] as unknown as Sobre[]

    const [liquido, noCaja] = seccionesDelActa({ sobre, ventas, cobranzas, liquidaciones, anticipos })
    expect(liquido!.bloques.map((b) => b.titulo)).toEqual([
      'Ventas de ventanilla en efectivo', 'Cobranzas de mostrador en efectivo', 'Cobranzas de mostrador en cheques',
      'Liquidaciones de choferes y cobradores en efectivo', 'Liquidaciones de choferes y cobradores en cheques', 'Anticipos a tesorería',
    ])
    expect(noCaja!.bloques.map((b) => b.titulo)).toEqual(['Ventas en cuenta corriente', 'Transferencias', 'Retenciones'])

    const [vEf, cEf, cCh, lEf, lCh, ant] = liquido!.bloques
    // La venta anulada se lista tachada pero no suma ni cuenta.
    expect(vEf!.filas).toHaveLength(3)
    expect(vEf!.cantidad).toBe(2)
    expect(vEf).toMatchObject({ redonhielo: 96800, rolito: 16000, total: 112800 })
    expect(cEf).toMatchObject({ cantidad: 2, redonhielo: 15000, rolito: 5000 })
    expect(cCh).toMatchObject({ cantidad: 2, redonhielo: 70000, rolito: 45000 })
    expect(cCh!.filas[1]!.texto).toContain('e-cheq Nº 00778123 · Banco Galicia · emitido 24/09 · paga 09/10 (15 días)')
    expect(lEf!.filas[0]).toMatchObject({ redonhielo: 150000, rolito: 60000, total: 210000 })
    expect(lCh).toMatchObject({ cantidad: 1, redonhielo: 80000, rolito: 0 })
    expect(ant).toMatchObject({ resta: true, redonhielo: 50000, total: 50000 })

    const [cc, tr, re] = noCaja!.bloques
    expect(cc).toMatchObject({ cantidad: 1, redonhielo: 120000 })
    expect(tr).toMatchObject({ cantidad: 2, redonhielo: 78080 })
    expect(re).toMatchObject({ cantidad: 2, redonhielo: 8500 })
  })

  it('el cajón por empresa suma efectivo y cheques como las tarjetas', () => {
    expect(cajonPorEmpresa(sobre)).toEqual({
      redonhielo: { efectivo: 200, cheques: 100, nCheques: 1, total: 300 },
      rolito:     { efectivo: 100, cheques: 45, nCheques: 1, total: 145 },
    })
  })
})
