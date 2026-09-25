import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'fs'
import type { Sobre } from '@/types'

// El acta IGUAL a la pantalla (2026-09-24): con ventas, cobranzas y
// liquidaciones del turno. Guarda el PDF en ACTA_SMOKE_OUT para mirarlo.
vi.mock('./pdf', () => ({ fetchImageAsBase64: async () => null }))
vi.mock('./compartir', () => ({ compartirArchivo: async () => 'descargado' }))

const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }) as unknown as Sobre['cerradaEn']
const t = (h: number, m: number) => ts(new Date(2026, 8, 24, h, m))
const cheque = (numero: string, importe: number, dias: number, esEcheq = false) =>
  ({ numero, bancoCodigo: '007', bancoNombre: 'Banco Galicia', fechaEmision: '2026-09-24', fechaAcreditacion: '2026-10-09', dias, importe, esEcheq })

describe('acta del sobre como la pantalla (smoke)', () => {
  it('genera el PDF con los bloques de Liquidación de caja', async () => {
    const { generateActaSobre } = await import('./sobrePdf')
    const sobre = {
      id: 's', codigo: 'RV-DT-000002', tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: '2026-09-24', numero: 2,
      rindio: { uid: 'u', nombre: 'Caja Torcuato Prueba', rol: 'caja' }, cajaSesionId: 's1',
      sistema: {
        efectivo: 302480,
        cheques: [
          { ...cheque('00120044', 45000, 20), bancoNombre: 'Banco Macro', cobranzaId: 'c5', numeroRecibo: 'RS-000105', clienteNombre: 'Cliente de Prueba SA', empresa: 'rolito' },
          { ...cheque('00778123', 70000, 45, true), cobranzaId: 'c6', numeroRecibo: 'RS-000106', clienteNombre: 'Facturable SA', empresa: 'redonhielo' },
          { ...cheque('00009921', 80000, 30, true), cobranzaId: 'x', numeroRecibo: 'RS-000102', clienteNombre: 'Cliente de Prueba SA', empresa: 'redonhielo', cobradoPor: 'Supervisor Prueba', origenCodigo: 'LQ-31-000003' },
        ],
        retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-2026-0512', importe: 3500, fecha: '2026-09-24', cobranzaId: 'c6', numeroRecibo: 'RS-000106', clienteNombre: 'Facturable SA', empresa: 'redonhielo' }],
        transferencias: { cantidad: 0, total: 78080 },
        porEmpresa: {
          redonhielo: { ventasEfectivo: 106480, cobranzasEfectivo: 15000, recibidoDeLiquidaciones: 150000, recibidoDeSobres: 0, anticipos: 50000, efectivo: 221480, transferencias: 78080, cheques: { cantidad: 2, total: 150000 }, retenciones: { cantidad: 2, total: 8500 } },
          rolito:     { ventasEfectivo: 16000, cobranzasEfectivo: 5000, recibidoDeLiquidaciones: 60000, recibidoDeSobres: 0, anticipos: 0, efectivo: 81000, transferencias: 0, cheques: { cantidad: 1, total: 45000 }, retenciones: { cantidad: 0, total: 0 } },
        },
        detalle: { fondoInicial: 0, ventasEfectivo: 122480, cobranzasEfectivo: 20000, recibidoDeLiquidaciones: 210000, recibidoDeSobres: 0, anticipos: 50000 },
        origenIds: { ventasIds: ['v1'], cobranzasIds: ['c4'], liquidacionesIds: ['l1'], sobresRecibidosIds: [], anticiposIds: ['a1'] },
      },
      declarado: {
        efectivo: 302500, conteoBilletes: { billetes: { '20000': 15, '10000': 0, '2000': 1, '1000': 0, '500': 1 }, cambioChico: 0, sinEfectivo: false, total: 302500 },
        cheques: [{ clave: 'ch|c5|00120044', presente: true }, { clave: 'ch|c6|00778123', presente: true }, { clave: 'ch|x|00009921', presente: false, motivo: 'lo tiene el supervisor' }], retenciones: [],
      },
      diferenciaDeclarada: { efectivo: 20, valoresFaltantes: { cantidad: 1, total: 80000 } },
      motivoDiferencia: { motivo: 'otro', nota: 'un billete de 20 de más' },
      firmaRinde: '', firmanteRinde: 'Caja Torcuato Prueba',
      cerradaEn: t(17, 1), estado: 'pendiente_recepcion',
      custodia: { uid: 'u', nombre: 'Caja Torcuato Prueba', rol: 'caja', desde: t(17, 1) },
    } as unknown as Sobre
    const venta = (id: string, hh: number, mm: number, canal: string, formaPago: string, total: number, clienteNombre: string, comp: Record<string, unknown>) =>
      ({ id, canal, formaPago, total, fecha: t(hh, mm), clienteNombre, items: [], ...comp })
    const ventas = [
      venta('v1', 8, 0, 'contado', 'contado_efectivo', 96800, 'Facturable SA', { factura: { puntoVenta: 1104, numero: 505, cbteTipo: 1 } }),
      venta('v2', 8, 45, 'promo', 'contado_efectivo', 16000, 'Kiosco El Sol', { comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: 43 } }),
      venta('v3', 10, 30, 'contado', 'cuenta_corriente', 120000, 'Cliente de Prueba SA', { comprobanteInterno: { tipo: 'remito', puntoVenta: 1, numero: 120 } }),
      venta('v4', 11, 5, 'contado', 'contado_efectivo', 9680, 'Consumidor final', { factura: { puntoVenta: 1104, numero: 506, cbteTipo: 6 } }),
      venta('v5', 11, 15, 'contado', 'contado_transferencia', 58080, 'Facturable SA', { factura: { puntoVenta: 1104, numero: 507, cbteTipo: 1 } }),
    ]
    const cob = (id: string, hh: number, mm: number, empresa: string, clienteNombre: string, medios: Record<string, unknown>) =>
      ({ id, fecha: t(hh, mm), empresa, clienteNombre, numeroRecibo: `RS-0001${id.slice(1).padStart(2, '0')}`, importe: 0, medios, origen: 'caja' })
    const cobranzas = [
      cob('c4', 9, 20, 'redonhielo', 'Cliente de Prueba SA', { efectivo: 15000, transferencia: 0, cheques: [], retenciones: [] }),
      cob('c5', 10, 10, 'rolito', 'Cliente de Prueba SA', { efectivo: 5000, transferencia: 0, cheques: [{ ...cheque('00120044', 45000, 20), bancoNombre: 'Banco Macro' }], retenciones: [] }),
      cob('c6', 11, 40, 'redonhielo', 'Facturable SA', { efectivo: 0, transferencia: 20000, cheques: [cheque('00778123', 70000, 45, true)], retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-2026-0512', importe: 3500, fecha: '2026-09-24' }] }),
    ]
    const liquidaciones = [{
      id: 'l1', codigo: 'LQ-31-000003', choferNombre: 'Supervisor Prueba', efectivoRecibido: 210000, diferenciaEfectivo: 0, createdAt: t(11, 50),
      conteoBilletes: { redonhielo: { total: 150000 }, rolito: { total: 60000 } },
      cheques: [{ ...cheque('00009921', 80000, 30, true), cobranzaId: 'x', clienteNombre: 'Cliente de Prueba SA', numeroRecibo: 'RS-000102', recibido: true, empresa: 'redonhielo' }],
      retenciones: [{ tipo: 'iibb_pba', nroCertificado: 'RET-2026-0471', importe: 5000, fecha: '2026-09-24', cobranzaId: 'x', clienteNombre: 'Cliente de Prueba SA', numeroRecibo: 'RS-000102', recibido: true, empresa: 'redonhielo' }],
    }]
    const anticipos = [{ id: 'a1', codigo: 'VA-DT-000001', tipo: 'anticipo', anticipo: { empresa: 'redonhielo' }, sistema: { efectivo: 50000 }, cerradaEn: t(12, 10), custodia: { nombre: 'Tesorería Prueba' }, entrega: { recibio: { nombre: 'Tesorería Prueba' } } }]
    const blob = (await generateActaSobre(sobre, { ventas, cobranzas, liquidaciones, anticipos } as never, { descargar: false })) as Blob
    expect(blob.size).toBeGreaterThan(5000)
    if (process.env.ACTA_SMOKE_OUT) writeFileSync(`${process.env.ACTA_SMOKE_OUT}/acta-pantalla.pdf`, Buffer.from(await blob.arrayBuffer()))
  })
})
