import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COPIAS_TICKET_DEFAULT, copiaTicket, generateTicketsVentanilla, normalizarCopiasTicket, type TurnoTicketData } from './ventanillaTicket'
import type { FacturaArcaData } from './facturaArcaPdf'
import { ANCHO_TICKET } from './ticketTermico'

const FACTURA: FacturaArcaData = {
  letra: 'B',
  codigoTipo: '06',
  puntoVenta: 1104,
  numero: 62,
  fechaEmision: new Date(2026, 8, 7),
  cliente: {
    razonSocial: 'Juan Pérez',
    cuit: 'DNI 36024287',
    condicionIva: 'Consumidor Final',
    domicilio: '',
    condicionVenta: 'Contado',
    vendedor: 'Caja Torcuato',
  },
  renglones: [
    { descripcion: 'Bolsa de hielo 3 kg', cantidad: 10, unidad: 'UNI', precioUnitario: 1680, total: 16800 },
    { descripcion: 'Bolsa de hielo 15 kg rolitos premium extra largo', cantidad: 2, unidad: 'UNI', precioUnitario: 7200, total: 14400 },
  ],
  totales: { subtotal: 31200, bonificaciones: 0, iva: 6552, percIibbCaba: 0, total: 37752 },
  cae: '76362489123456',
  caeVto: new Date(2026, 8, 17),
}

const TURNO: TurnoTicketData = {
  plantaId: 'torcuato',
  canal: 'contado',
  clienteNombre: 'Juan Pérez',
  items: [
    { nombre: 'Bolsa de hielo 3 kg', cantidad: 10, precioUnitario: 2033 },
    { nombre: 'Bolsa de hielo 15 kg rolitos premium extra largo', cantidad: 2, precioUnitario: 8712 },
  ],
  total: 37752,
  formaPago: 'contado_efectivo',
  cajaNombre: 'Caja Torcuato',
  fecha: new Date(2026, 8, 7, 9, 41),
  turno: 7,
  urlTurno: 'https://rolito.app/turnos/torcuato?turno=7',
  facturaNro: '01104-00000062',
}

// jsPDF escribe /MediaBox [0 0 ancho alto] en puntos por página.
const mediaBoxes = (pdf: string) =>
  [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => ({ w: Number(m[1]) / 72 * 25.4, h: Number(m[2]) / 72 * 25.4 }))

describe('tickets de ventanilla (80 mm)', () => {
  it('factura + turno salen como dos páginas de 80 mm de ancho y alto a medida', async () => {
    const blob = await generateTicketsVentanilla({ factura: FACTURA, turno: TURNO })
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    const cajas = mediaBoxes(pdf)
    expect(cajas).toHaveLength(2)
    for (const c of cajas) {
      expect(c.w).toBeCloseTo(ANCHO_TICKET, 0)
      expect(c.h).toBeGreaterThan(80)
      expect(c.h).toBeLessThan(300)
    }
    // Para mirarlo a ojo: se deja el PDF en el directorio de salida de tests.
    if (process.env.TICKETS_OUT) {
      mkdirSync(process.env.TICKETS_OUT, { recursive: true })
      writeFileSync(`${process.env.TICKETS_OUT}/tickets-ventanilla.pdf`, Buffer.from(await blob.arrayBuffer()))
    }
  })

  it('solo el turno es una página', async () => {
    const blob = await generateTicketsVentanilla({ turno: TURNO })
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    expect(mediaBoxes(pdf)).toHaveLength(1)
  })

  it('por triplicado: la factura una vez y el turno tres veces; las copias con firma extra son más largas', async () => {
    const blob = await generateTicketsVentanilla({ factura: FACTURA, turno: TURNO, copiasTurno: 3 })
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    const cajas = mediaBoxes(pdf)
    expect(cajas).toHaveLength(4)
    const [, original, duplicado, triplicado] = cajas
    expect(duplicado.h).toBeGreaterThan(original.h)   // renglón "Entregó (muelle)"
    expect(triplicado.h).toBeCloseTo(duplicado.h, 0)
    if (process.env.TICKETS_OUT) {
      mkdirSync(process.env.TICKETS_OUT, { recursive: true })
      writeFileSync(`${process.env.TICKETS_OUT}/tickets-ventanilla-triplicado.pdf`, Buffer.from(await blob.arrayBuffer()))
    }
  })

  it('la promo sale a nombre de Rolito (una página, sin factura)', async () => {
    const blob = await generateTicketsVentanilla({ turno: { ...TURNO, canal: 'promo', facturaNro: undefined } })
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    expect(mediaBoxes(pdf)).toHaveLength(1)
    if (process.env.TICKETS_OUT) {
      mkdirSync(process.env.TICKETS_OUT, { recursive: true })
      writeFileSync(`${process.env.TICKETS_OUT}/ticket-ventanilla-promo.pdf`, Buffer.from(await blob.arrayBuffer()))
    }
  })

  it('copias fuera de rango se acotan a 1..3 y la config se normaliza', () => {
    expect(normalizarCopiasTicket(3)).toBe(3)
    expect(normalizarCopiasTicket(1)).toBe(1)
    expect(normalizarCopiasTicket(0)).toBe(COPIAS_TICKET_DEFAULT)
    expect(normalizarCopiasTicket('x')).toBe(COPIAS_TICKET_DEFAULT)
    expect(normalizarCopiasTicket(undefined)).toBe(COPIAS_TICKET_DEFAULT)
    expect(copiaTicket(0, 1)).toBeUndefined()
    expect(copiaTicket(1, 3)?.firmaExtra).toBe('Entregó (muelle)')
  })

  it('sin partes no arma nada', async () => {
    await expect(generateTicketsVentanilla({})).rejects.toThrow()
  })
})
