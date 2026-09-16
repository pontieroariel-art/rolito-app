import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { contactoDePerfil, envioDeCliente, envioDeRecibo, envioGenerico, nombrePublicado, textoWhatsApp } from './envioComprobante'

describe('envioGenerico', () => {
  it('arma asunto, mensaje y un comprobante "PDF" con el nombre del archivo', () => {
    const e = envioGenerico({ titulo: 'Liquidación LQ-01-000015', subtitulo: 'Jara Gabriel', nombre: 'liquidacion-LQ-01-000015.pdf' })
    expect(e.asunto).toBe('Liquidación LQ-01-000015 — Jara Gabriel')
    expect(e.comprobante).toEqual({ tipo: 'PDF', numero: 'liquidacion-LQ-01-000015' })
    expect(e.clienteNombre).toBe('Jara Gabriel')
    expect(e.para).toBe('')
  })
})

describe('envioDeRecibo', () => {
  it('lleva el número de recibo, la empresa y el cliente para precargar el contacto', () => {
    const e = envioDeRecibo({ id: 'abcdef123456', clienteId: 'u1', clienteNombre: 'FSE SA', importe: 12345.5, numeroRecibo: 'RS-000701', empresa: 'redonhielo', fecha: Timestamp.fromDate(new Date(2026, 8, 15)) }, 'Recibo RS-000701')
    expect(e.comprobante).toEqual({ tipo: 'REC', numero: 'RS-000701', empresa: 'redonhielo' })
    expect(e.clienteUid).toBe('u1')
    expect(e.mensaje).toContain('15/9/2026')
    expect(e.mensaje).toContain('12.345,50')
  })
  it('sin número usa el id corto y sin cliente no manda uid', () => {
    const e = envioDeRecibo({ id: 'abcdef123456', clienteId: '', clienteNombre: 'Mostrador', importe: 10, fecha: Timestamp.fromDate(new Date()) }, 'Recibo de mostrador')
    expect(e.comprobante.numero).toBe('abcdef12')
    expect(e.clienteUid).toBeUndefined()
    expect(e.comprobante).not.toHaveProperty('empresa')
  })
})

describe('contactoDePerfil / envioDeCliente', () => {
  it('toma telefono, cae a phone, y descarta mails inválidos o vacíos', () => {
    expect(contactoDePerfil({ telefono: '', phone: '11 4567-8901', email: 'x' })).toEqual({ telefono: '11 4567-8901', mail: '' })
    expect(contactoDePerfil({ telefono: ' 1155550000 ', phone: '', email: ' Cliente@Empresa.com ' })).toEqual({ telefono: '1155550000', mail: 'cliente@empresa.com' })
    expect(contactoDePerfil(null)).toEqual({ telefono: '', mail: '' })
  })
  it('precarga el celular del perfil y arma el asunto con la razón social', () => {
    const e = envioDeCliente({ uid: 'u9', razonSocial: 'KIOSCO SOL', email: 'sol@mail.com', telefono: '1133334444', phone: '' }, { tipo: 'COMODATO', numero: '77', titulo: 'Contrato de comodato Nº 77', mensaje: 'Te enviamos el contrato firmado.' })
    expect(e.telefono).toBe('1133334444')
    expect(e.para).toBe('')
    expect(e.asunto).toBe('Contrato de comodato Nº 77 — KIOSCO SOL')
    expect(e.clienteUid).toBe('u9')
  })
  it('sin perfil usa el nombre que trae el papel', () => {
    const e = envioDeCliente(null, { tipo: 'RETIRO', numero: '3', titulo: 'Remito de retiro Nº 3', mensaje: 'm', clienteNombre: 'CLIENTE VIEJO' })
    expect(e.clienteNombre).toBe('CLIENTE VIEJO')
    expect(e.clienteUid).toBeUndefined()
  })
})

describe('textoWhatsApp', () => {
  it('saluda por nombre, usa el mensaje del comprobante y termina con el link', () => {
    const t = textoWhatsApp({ titulo: 'Factura 00001-00000123', mensaje: 'Te enviamos adjunta la factura.', link: 'https://x/y.pdf', clienteNombre: 'FSE SA' })
    expect(t.startsWith('Hola FSE SA, Te enviamos adjunta la factura.')).toBe(true)
    expect(t).toContain('https://x/y.pdf')
    expect(t.endsWith('Rolito')).toBe(true)
  })
  it('sin mensaje ni nombre arma uno con el título', () => {
    expect(textoWhatsApp({ titulo: 'Recibo RS-000701', link: 'L' })).toBe('Hola, te enviamos Recibo RS-000701.\n\n📄 Recibo RS-000701:\nL\n\nRolito')
  })
})

describe('nombrePublicado', () => {
  const ahora = new Date(Date.UTC(2026, 8, 15, 20, 5, 9))
  it('antepone la fecha y limpia acentos y caracteres raros', () => {
    expect(nombrePublicado('Nota de crédito 00001-00000045.pdf', ahora)).toBe('20260915200509-Nota-de-credito-00001-00000045.pdf')
  })
  it('agrega .pdf si el nombre no trae extensión y nunca queda vacío', () => {
    expect(nombrePublicado('recibo', ahora)).toBe('20260915200509-recibo.pdf')
    expect(nombrePublicado('¿?', ahora)).toBe('20260915200509-comprobante.pdf')
  })
})
