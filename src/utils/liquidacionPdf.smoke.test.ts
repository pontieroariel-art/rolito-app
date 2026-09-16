import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'fs'
import type { Liquidacion } from '@/types'

// Smoke del PDF de la liquidación fuera del navegador (sin logo): la hoja
// principal más las hojas de fajo por empresa (rendición por sobres, etapa 1,
// 2026-09-16). Con LIQ_SMOKE_OUT=<carpeta> guarda el PDF para mirarlo.

const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }) as unknown as Liquidacion['createdAt']
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('PDF de liquidación con hojas por empresa (smoke)', () => {
  it('genera tres páginas: liquidación, fajo Redonhielo y fajo Rolito', async () => {
    const { generateLiquidacion } = await import('./pdf')
    const liq: Liquidacion = {
      id: '2026-09-16_sup1', numero: 45, codigo: 'LQ-SD-000045', fecha: '2026-09-16', plantaId: 'torcuato',
      choferId: 'sup1', choferNombre: 'Vinjoy Matías',
      productos: [], envases: { salieron: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0, racks: [] }, volvieron: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0, racks: [] }, diferencia: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 }, racksFaltantes: [], racksSobrantes: [] },
      cambios: { registrados: 0, rotasRecibidas: 0 },
      importes: { contadoEfectivo: 0, contadoTransferencia: 0, cuentaCorriente: 0, total: 0 },
      cobranzasCalle: { cantidad: 6, efectivo: 560300, transferencia: 95000, total: 655300, cheques: { cantidad: 2, total: 380000 }, retenciones: { cantidad: 1, total: 12450 } },
      efectivoARendir: 560300, efectivoRecibido: 550300, diferenciaEfectivo: -10000,
      porEmpresa: {
        redonhielo: { efectivo: 412300, transferencia: 95000, ventas: { cantidad: 0, total: 0 }, cobranzas: { cantidad: 4, total: 899750 }, cheques: { cantidad: 2, total: 380000 }, retenciones: { cantidad: 1, total: 12450 } },
        rolito:     { efectivo: 148000, transferencia: 0, ventas: { cantidad: 0, total: 0 }, cobranzas: { cantidad: 2, total: 148000 }, cheques: { cantidad: 0, total: 0 }, retenciones: { cantidad: 0, total: 0 } },
      },
      conteoBilletes: {
        redonhielo: { billetes: { '20000': 15, '10000': 9, '2000': 6, '1000': 0, '500': 0 }, cambioChico: 300, sinEfectivo: false, total: 402300 },
        rolito:     { billetes: { '20000': 7, '10000': 0, '2000': 4, '1000': 0, '500': 0 }, cambioChico: 0, sinEfectivo: false, total: 148000 },
      },
      diferenciaPorEmpresa: { redonhielo: -10000, rolito: 0 },
      diferencia: { motivo: 'billete_falso', nota: 'Se devolvió al supervisor', denominacion: 10000 },
      firmaRepartidor: PNG, firmanteRepartidor: 'Vinjoy Matías', firmaRecibe: PNG, firmanteRecibe: 'Nicolás Díaz',
      cheques: [
        { numero: '00412887', bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-10', fechaAcreditacion: '2026-09-30', dias: 20, importe: 280000, cobranzaId: 'c1', numeroRecibo: 'RS-000702', clienteNombre: 'FSE SOCIEDAD ANONIMA', recibido: true, empresa: 'redonhielo' },
        { numero: '11002', bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '2026-09-12', fechaAcreditacion: '2026-10-15', dias: 33, importe: 100000, cobranzaId: 'c2', numeroRecibo: 'RS-000703', clienteNombre: 'ALKUSAN SRL', recibido: true, empresa: 'redonhielo' },
      ],
      retenciones: [{ tipo: 'iibb_pba', nroCertificado: '0000-00311', importe: 12450, cobranzaId: 'c3', numeroRecibo: 'RS-000704', clienteNombre: 'LA ROTONDA DE TANDIL S.R.L.', recibido: true, empresa: 'redonhielo' }],
      valoresFaltantes: { cantidad: 0, total: 0 }, entregaId: null, confirmoSinPendientes: true,
      cantidadVentas: 0, cantidadCobranzas: 6, clientesVisitados: 6,
      cerradaPor: { uid: 'caja1', nombre: 'Nicolás Díaz' }, createdAt: ts(new Date(2026, 8, 16, 15, 12)),
    }
    const blob = await generateLiquidacion(liq)
    const bytes = Buffer.from(await blob.arrayBuffer())
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    const paginas = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(paginas).toBe(3)
    if (process.env.LIQ_SMOKE_OUT) writeFileSync(`${process.env.LIQ_SMOKE_OUT}/liquidacion-smoke.pdf`, bytes)
  })

  it('un cierre anterior al 16/09 (sin porEmpresa) sigue saliendo en una sola página', async () => {
    const { generateLiquidacion } = await import('./pdf')
    const liq = {
      id: 'x', fecha: '2026-09-10', plantaId: 'torcuato', choferId: 'ch', choferNombre: 'Gerez', productos: [],
      cambios: { registrados: 0, rotasRecibidas: 0 }, importes: { contadoEfectivo: 1000, contadoTransferencia: 0, cuentaCorriente: 0, total: 1000 },
      efectivoARendir: 1000, efectivoRecibido: 1000, diferenciaEfectivo: 0, cerradaPor: { uid: 'c', nombre: 'Caja' }, createdAt: ts(new Date()),
    } as unknown as Liquidacion
    const bytes = Buffer.from(await (await generateLiquidacion(liq)).arrayBuffer())
    expect((bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1)
  })
})
