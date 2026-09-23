import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { generateFacturaPdf, type FacturaPdfData } from './facturaPdf'

// Smoke del formato HISTÓRICO (Bluesoft) fuera del navegador: una factura A
// con renglones, una nota de orden de compra bajo el primero, remitos, CAE y
// vencimiento, con el logo y la marca de agua del repo (en Node el generador
// no los busca solo: `document` no existe). El detalle se rellena hasta 18
// filas y la grilla se cierra con `finTabla`, que es lo que este smoke
// ejercita. Con FAC_SMOKE_OUT=<carpeta> guarda el PDF.
//
// La hora del sistema va fija para que dos corridas den los mismos bytes
// (jsPDF escribe /CreationDate con la hora actual).

const factura = (): FacturaPdfData => ({
  letra: 'A', codigoTipo: '01', titulo: 'FACTURA', puntoVenta: 101, numero: 282302,
  fechaEmision: new Date(2026, 7, 19), fechaVencimiento: new Date(2026, 8, 18),
  cliente: {
    razonSocial: 'OPERADORA DE ESTACIONES DE SERVICIOS S.A.(NORDELTA)',
    domicilio: 'BOULEVARD MACACHA GUEMES 515', cp: '1106', localidad: 'CAPITAL FEDERAL, (BUENOS AIRES)',
    condicionIva: 'IVA Responsable Inscripto', cuit: '30-67877449-5', codigo: 'YPF063',
    vendedor: 'ADMINISTRACION', condicionVenta: 'VALORES 30 DIAS F.F.',
  },
  remitosOC: 'R 0001-00482647 · O/C 4512-A',
  renglones: [
    { descripcion: 'HIELO ROLADO 15 KG', um: 'BOL', cantidad: 40, precioUnitario: 1680, descuento: 0, importe: 67200, notas: ['O/C 4512-A'] },
    { descripcion: 'HIELO ROLADO 4 KG', um: 'BOL', cantidad: 30, precioUnitario: 620, descuento: 5, importe: 17670 },
    { descripcion: 'AGUA DESMINERALIZADA 6 LTS', um: 'UN', cantidad: 2, precioUnitario: 2372, descuento: 0, importe: 4744 },
  ],
  totales: {
    netoGravado: 89614, exento: 0, percIibbCaba: 0, percIibbCabaAlic: 0,
    iva: 18818.94, ivaAlic: 21, percIibbBa: 0, percIibbBaAlic: 0, internos: 0, total: 108432.94,
  },
  cae: '86339023363846', caeVto: new Date(2026, 7, 29),
  leyendaCopia: 'DUPLICADO — REIMPRESIÓN',
  logoDataUrl: `data:image/png;base64,${readFileSync('public/logo-rolito-factura.png').toString('base64')}`,
  marcaDeAguaDataUrl: `data:image/jpeg;base64,${readFileSync('public/marca-agua-factura.jpg').toString('base64')}`,
  descargar: false,
})

describe('factura histórica (Bluesoft) en PDF (smoke)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 8, 22, 9, 30, 0), toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('genera la factura A de una página con detalle, totales, QR y código de barras', async () => {
    const blob = await generateFacturaPdf(factura())
    const bytes = Buffer.from(await blob.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    expect((bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1)
    if (process.env.FAC_SMOKE_OUT) writeFileSync(`${process.env.FAC_SMOKE_OUT}/factura-historica-00101-00282302.pdf`, bytes)
  })
})
