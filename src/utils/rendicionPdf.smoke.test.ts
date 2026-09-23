import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'fs'
import type { Rendicion } from '@/types'
import { generateRendicionMostrador, type DetalleRendicionPdf } from './rendicionPdf'

// Smoke del PDF del cierre de caja de ventanilla fuera del navegador (sin
// logo). La fixture dibuja TODAS las tablas del generador: plata por origen,
// cierre, repartidores recibidos, bultos, valores en papel (cheques +
// retenciones), detalle de ventas y detalle de cobranzas; el detalle es largo
// a propósito para que las tablas salten de página y la firma caiga en otra.
// Con REND_SMOKE_OUT=<carpeta> guarda los PDF para mirarlos o comparar bytes.
//
// La hora del sistema va fija: el pie dice "Generado <fecha y hora>" y, sin
// esto, dos corridas en minutos distintos darían bytes distintos por el pie
// y no por el dibujo.

const ts = (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }) as unknown as Rendicion['createdAt']
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const rendicionCompleta = (): Rendicion => ({
  id: '2026-09-16_caja1', numero: 12, codigo: 'RD-DT-000012', tipo: 'mostrador', fecha: '2026-09-16', plantaId: 'torcuato',
  sujetoId: 'caja1', sujetoNombre: 'Nicolás Díaz',
  ventas: { cantidad: 38, contadoEfectivo: 812500, contadoTransferencia: 145000, cuentaCorriente: 366000, promoEfectivo: 298000, promoTransferencia: 0, promoCuentaCorriente: 54000, total: 1675500 },
  cobranzas: { cantidad: 3, efectivo: 220000, transferencia: 80000, cheques: { cantidad: 2, total: 380000 }, retenciones: { cantidad: 1, total: 12450 }, total: 692450 },
  recibido: {
    liquidaciones: [
      { id: '2026-09-16_ch1', choferId: 'ch1', choferNombre: 'Gerez Walter', efectivoARendir: 402300, efectivoRecibido: 402300, diferenciaEfectivo: 0 },
      { id: '2026-09-16_ch2', choferId: 'ch2', choferNombre: 'Mira Cristian', efectivoARendir: 655300, efectivoRecibido: 645300, diferenciaEfectivo: -10000 },
    ],
    efectivo: 1047600,
  },
  bultos: [
    { productoId: 'HR15', nombre: 'Hielo rolado 15 kg', cantidad: 210 },
    { productoId: 'HR4', nombre: 'Hielo rolado 4 kg', cantidad: 96 },
    { productoId: 'AG6', nombre: 'Agua desmineralizada 6 l', cantidad: 12 },
  ],
  cheques: [
    { numero: '00412887', bancoCodigo: '007', bancoNombre: 'Galicia', fechaEmision: '2026-09-10', fechaAcreditacion: '2026-09-30', dias: 20, importe: 280000, cobranzaId: 'c1', numeroRecibo: 'RC-000702', clienteNombre: 'FSE SOCIEDAD ANONIMA', recibido: true, empresa: 'redonhielo' },
    { numero: '11002', bancoCodigo: '011', bancoNombre: 'Nación', fechaEmision: '2026-09-12', fechaAcreditacion: '2026-10-15', dias: 33, importe: 100000, esEcheq: true, cobranzaId: 'c2', numeroRecibo: 'RC-000703', clienteNombre: 'ALKUSAN SRL', recibido: false, motivoNoEntregado: 'Quedó en la caja fuerte', empresa: 'redonhielo' },
  ],
  retenciones: [{ tipo: 'iibb_pba', nroCertificado: '0000-00311', importe: 12450, cobranzaId: 'c3', numeroRecibo: 'RC-000704', clienteNombre: 'LA ROTONDA DE TANDIL S.R.L.', recibido: true, empresa: 'redonhielo' }],
  efectivoARendir: 2378100, efectivoContado: 2368100, diferenciaEfectivo: -10000,
  diferencia: { motivo: 'faltante_caja', nota: 'Diferencia de la liquidación de Mira' },
  firma: PNG, firmante: 'Nicolás Díaz', confirmoSinPendientes: true,
  ventasIds: [], cobranzasIds: [], liquidacionesIds: ['2026-09-16_ch1', '2026-09-16_ch2'],
  cantidadVentas: 38, cantidadCobranzas: 3,
  desde: ts(new Date(2026, 8, 16, 0, 0)), hasta: ts(new Date(2026, 8, 16, 18, 5)),
  cerradaPor: { uid: 'caja1', nombre: 'Nicolás Díaz' }, createdAt: ts(new Date(2026, 8, 16, 18, 5)),
  validacion: { uid: 'tes1', nombre: 'Mariela Sosa', fecha: ts(new Date(2026, 8, 17, 9, 40)), nota: 'Cuadra con el sobre' },
  entregaId: null,
})

const detalleLargo = (): DetalleRendicionPdf => {
  const clientes = ['KIOSCO EL PARQUE', 'OPERADORA DE ESTACIONES DE SERVICIOS S.A.(NORDELTA)', 'DEHEZA S.A.I.F. e I.', 'ALMACEN DON JOSE', 'HELADERIA VIA FLAMINIA', 'PESCADERIA LA MARINA', 'YPF PILAR', 'CARNICERIA LOS HERMANOS']
  const ventas: NonNullable<DetalleRendicionPdf['ventas']> = []
  for (let i = 0; i < 38; i++) {
    const promo = i % 3 === 0
    ventas.push({
      turno: i + 1, hora: new Date(2026, 8, 16, 6 + Math.floor(i / 4), (i * 13) % 60),
      cliente: clientes[i % clientes.length],
      canal: promo ? 'Promo' : 'Contado',
      formaPago: i % 5 === 0 ? 'Transferencia' : i % 7 === 0 ? 'Cta. cte.' : 'Efectivo',
      total: promo ? 18500 + i * 1000 : 42300 + i * 1500,
      comprobante: promo ? `X 0001-${String(1200 + i).padStart(8, '0')}` : `FC A 1104-${String(880 + i).padStart(8, '0')}`,
    })
  }
  return {
    ventas,
    cobranzas: [
      { hora: new Date(2026, 8, 16, 9, 12), cliente: 'FSE SOCIEDAD ANONIMA', recibo: 'RC-000702', efectivo: 120000, transferencia: 0, cheques: 280000, retenciones: 0 },
      { hora: new Date(2026, 8, 16, 11, 48), cliente: 'ALKUSAN SRL', recibo: 'RC-000703', efectivo: 0, transferencia: 80000, cheques: 100000, retenciones: 0 },
      { hora: new Date(2026, 8, 16, 15, 30), cliente: 'LA ROTONDA DE TANDIL S.R.L.', recibo: 'RC-000704', efectivo: 100000, transferencia: 0, cheques: 0, retenciones: 12450 },
    ],
  }
}

const guardar = (nombre: string, bytes: Buffer) => {
  if (process.env.REND_SMOKE_OUT) writeFileSync(`${process.env.REND_SMOKE_OUT}/${nombre}`, bytes)
}

describe('PDF del cierre de caja de ventanilla (smoke)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 8, 22, 9, 30, 0), toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('con todas las tablas y detalle largo sale en tres páginas', async () => {
    const blob = await generateRendicionMostrador(rendicionCompleta(), detalleLargo())
    const bytes = Buffer.from(await blob.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    const paginas = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    guardar('cierre-caja-completo.pdf', bytes)
    // 38 ventas a 7,5 pt no entran en la primera hoja: el detalle salta de
    // página dos veces y la firma cae en la tercera.
    expect(paginas).toBe(3)
  })

  it('un cierre pelado (sin repartidores, bultos, valores ni detalle) sale en una página', async () => {
    const r: Rendicion = {
      ...rendicionCompleta(),
      recibido: { liquidaciones: [], efectivo: 0 }, bultos: [], cheques: [], retenciones: [],
      diferencia: undefined, diferenciaEfectivo: 0, efectivoContado: 2378100, validacion: null,
    }
    const blob = await generateRendicionMostrador(r)
    const bytes = Buffer.from(await blob.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    guardar('cierre-caja-pelado.pdf', bytes)
    expect((bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1)
  })
})
