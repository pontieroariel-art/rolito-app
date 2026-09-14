import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'fs'
import type { Sobre } from '@/types'

// Smoke del acta del sobre fuera del navegador: sin logo, con el detalle por
// persona. Guarda el PDF en la carpeta que diga ACTA_SMOKE_OUT (para mirarlo).
vi.mock('./pdf', () => ({ fetchImageAsBase64: async () => null }))
vi.mock('./compartir', () => ({ compartirArchivo: async () => 'descargado' }))

const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }) as unknown as Sobre['cerradaEn']

describe('acta del sobre (smoke)', () => {
  it('genera el PDF con el detalle por chofer/cobrador', async () => {
    const { generateActaSobre } = await import('./sobrePdf')
    const sobre = {
      id: '2026-09-14_u_1', codigo: 'RV-DT-000001', tipo: 'ventanilla', rindeA: 'tesoreria', plantaId: 'torcuato', fecha: '2026-09-14', numero: 1,
      rindio: { uid: 'u', nombre: 'Nicolas Diaz', rol: 'caja' }, cajaSesionId: '2026-09-14_u_1',
      sistema: {
        efectivo: 3259650, cheques: [
          { numero: '03156837', bancoCodigo: '017', bancoNombre: 'BBVA', fechaEmision: '2026-09-14', fechaAcreditacion: '2026-09-17', dias: 3, importe: 800000, cobranzaId: 'b', numeroRecibo: 'RS-000190', clienteNombre: 'CARPINACCI HNOS. S.A.' },
        ], retenciones: [], transferencias: { cantidad: 0, total: 0 },
        detalle: { fondoInicial: 0, ventasEfectivo: 1895450, cobranzasEfectivo: 0, recibidoDeLiquidaciones: 1364200, recibidoDeSobres: 0 },
        origenIds: { ventasIds: [], cobranzasIds: [], liquidacionesIds: ['l1', 'l2'], sobresRecibidosIds: [] },
      },
      declarado: { efectivo: 1895450, cheques: [{ clave: 'ch|b|03156837', presente: true }], retenciones: [] },
      diferenciaDeclarada: { efectivo: -1364200, valoresFaltantes: { cantidad: 0, total: 0 } },
      motivoDiferencia: { motivo: 'otro', nota: 'Guardó la plata de los choferes aparte' },
      firmaRinde: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', firmanteRinde: 'Nicolas Diaz',
      cerradaEn: ts(new Date(2026, 8, 14, 18, 40)), estado: 'pendiente_recepcion',
      custodia: { uid: 'u', nombre: 'Nicolas Diaz', rol: 'caja', desde: ts(new Date(2026, 8, 14, 18, 40)) },
    } as unknown as Sobre
    const personas = [
      {
        liquidacionId: 'l1', codigo: 'LQ-23-000003', nombre: 'Cristian González', ventasEfectivo: 0, cobranzasEfectivo: 1356984.28, efectivoARendir: 1356984.28, efectivoRecibido: 1357030, diferencia: 45.72,
        recibos: [
          { numeroRecibo: 'RS-000187', clienteNombre: 'ESTACION DE SERVICIO ALCOVER S.R.L', efectivo: 485247.74, transferencia: 0, cheques: [], retenciones: [] },
          { numeroRecibo: 'RS-000188', clienteNombre: 'ESTACION DE SERVICIOS SANTA TERESITA S.R.L.', efectivo: 303278.54, transferencia: 0, cheques: [], retenciones: [] },
          { numeroRecibo: 'RS-000189', clienteNombre: 'FROS S.A', efectivo: 568458, transferencia: 0, cheques: [], retenciones: [] },
          { numeroRecibo: 'RS-000190', clienteNombre: 'CARPINACCI HNOS. S.A.', efectivo: 0, transferencia: 0, cheques: [{ numero: '03156837', bancoNombre: 'BBVA', importe: 800000 }], retenciones: [] },
        ],
        recibosSinDetalle: 0, valores: { cheques: 1, chequesTotal: 800000, retenciones: 0, retencionesTotal: 0 },
      },
      {
        liquidacionId: 'l2', codigo: 'LQ-24-000003', nombre: 'Matias Vinjoy', ventasEfectivo: 0, cobranzasEfectivo: 7163.72, efectivoARendir: 7163.72, efectivoRecibido: 7170, diferencia: 6.28,
        motivo: { motivo: 'redondeo', nota: 'sin cambio chico' },
        recibos: [{ numeroRecibo: 'RS-000166', clienteNombre: 'BOTTAZZINI FAVIO, GABRIEL Y G.R. S.H.', efectivo: 7163.72, transferencia: 0, cheques: [{ numero: '85549582', bancoNombre: 'Banco Supervielle', importe: 1700000 }], retenciones: [] }],
        recibosSinDetalle: 0, valores: { cheques: 1, chequesTotal: 1700000, retenciones: 0, retencionesTotal: 0 },
      },
    ]
    const blob = (await generateActaSobre(sobre, { personas }, { descargar: false })) as Blob
    expect(blob.size).toBeGreaterThan(5000)
    if (process.env.ACTA_SMOKE_OUT) writeFileSync(`${process.env.ACTA_SMOKE_OUT}/acta-smoke.pdf`, Buffer.from(await blob.arrayBuffer()))
  })
})
