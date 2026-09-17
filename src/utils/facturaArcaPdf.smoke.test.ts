import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { armarFacturaTangoArcaPdf } from './comprobantesTango'
import type { FacturaTangoDetalle } from '@/types'

// Smoke del formato nuevo de Tango (2026-09-17) fuera del navegador: la
// factura A 00101-00282930 de DEHEZA leída de Tango, con el logo del repo.
// Con FAC_SMOKE_OUT=<carpeta> guarda el PDF para compararlo a ojo con el
// que imprime Tango (Desktop/Factura Rolito Tango.pdf).

const deheza: FacturaTangoDetalle = {
  empresa: 'redonhielo', tipo: 'FAC', numero: 'A0010100282930', codigo: 'DH.005', fecha: '2026-09-08', letra: 'A', puntoVenta: 101, nro: 282930, cbteTipo: 1, estado: 'PEN',
  cliente: { codigo: 'DH.005', razonSocial: 'DEHEZA S.A.I.F. e I. ( 0031 )', cuit: '30-51618667-0', domicilio: 'Av. FIGUEROA ALCORTA 3099', localidad: '', cp: '', provincia: '00', condicionIva: 'Responsable inscripto', condicionVenta: '15 DIAS F.F.', vendedor: 'ADMINISTRACION' },
  renglones: [{ codigo: 'AG6', descripcion: 'AGUA DESMINERALIZADA 6 LTS', cantidad: 20, precioUnitario: 2950, dtoPct: 0, ivaPct: 21, importe: 59000 }],
  totales: { gravado: 59000, exento: 0, iva: 12390, ivaAlic: 21, internos: 0, otros: 442.5, total: 71832.5 },
  cae: '86362087155301', caeVto: '2026-09-18', remitos: ['R0000100482647'],
}

describe('factura de Tango con el formato nuevo (smoke)', () => {
  it('genera el PDF de una página con QR, referencias del remito y cuota', async () => {
    const { generateFacturaArcaPdf } = await import('./facturaArcaPdf')
    const armado = armarFacturaTangoArcaPdf(deheza, { fechaVencimiento: '2026-09-24' })
    expect(armado.ok).toBe(true)
    if (!armado.ok) return
    const logoDataUrl = `data:image/png;base64,${readFileSync('public/logo-rolito-factura.png').toString('base64')}`
    const blob = await generateFacturaArcaPdf({ ...armado.datos, logoDataUrl })
    const bytes = Buffer.from(await blob.arrayBuffer())
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    expect(bytes.length).toBeGreaterThan(20_000)
    if (process.env.FAC_SMOKE_OUT) writeFileSync(`${process.env.FAC_SMOKE_OUT}/factura-tango-00101-00282930.pdf`, bytes)
  })
})
