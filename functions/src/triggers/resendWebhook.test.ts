import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import { estadoDeEvento, firmaValida, pisaEstado } from './resendWebhook'

// Firma Svix como la manda Resend: HMAC-SHA256 de `${id}.${ts}.${body}` con
// el secret base64 que sigue a `whsec_`, en base64, con prefijo "v1,".
const SECRET_B64 = Buffer.from('clave-de-prueba-de-32-bytes-xxxxx').toString('base64')
const SECRET = `whsec_${SECRET_B64}`
const firmar = (id: string, ts: string, body: string) =>
  'v1,' + createHmac('sha256', Buffer.from(SECRET_B64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64')

describe('resendWebhook', () => {
  const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'abc' } })
  const ahora = 1_800_000_000

  it('acepta una firma válida dentro de la ventana de cinco minutos', () => {
    const ts = String(ahora - 60)
    expect(firmaValida(SECRET, 'msg_1', ts, firmar('msg_1', ts, body), Buffer.from(body), ahora)).toBe(true)
  })

  it('acepta cuando una de varias firmas coincide (rotación de secret)', () => {
    const ts = String(ahora)
    const firmas = `v1,AAAA ${firmar('msg_1', ts, body)}`
    expect(firmaValida(SECRET, 'msg_1', ts, firmas, Buffer.from(body), ahora)).toBe(true)
  })

  it('rechaza cuerpo alterado, id distinto, timestamp viejo o headers vacíos', () => {
    const ts = String(ahora)
    const firma = firmar('msg_1', ts, body)
    expect(firmaValida(SECRET, 'msg_1', ts, firma, Buffer.from(body + ' '), ahora)).toBe(false)
    expect(firmaValida(SECRET, 'msg_2', ts, firma, Buffer.from(body), ahora)).toBe(false)
    const viejo = String(ahora - 6 * 60)
    expect(firmaValida(SECRET, 'msg_1', viejo, firmar('msg_1', viejo, body), Buffer.from(body), ahora)).toBe(false)
    expect(firmaValida(SECRET, '', ts, firma, Buffer.from(body), ahora)).toBe(false)
    expect(firmaValida('', 'msg_1', ts, firma, Buffer.from(body), ahora)).toBe(false)
  })

  it('traduce los eventos que importan e ignora el resto', () => {
    expect(estadoDeEvento('email.delivered')).toBe('entregado')
    expect(estadoDeEvento('email.bounced')).toBe('rebotado')
    expect(estadoDeEvento('email.failed')).toBe('rebotado')
    expect(estadoDeEvento('email.complained')).toBe('queja')
    expect(estadoDeEvento('email.delivery_delayed')).toBe('demorado')
    expect(estadoDeEvento('email.sent')).toBeNull()
    expect(estadoDeEvento('email.opened')).toBeNull()
    expect(estadoDeEvento(undefined)).toBeNull()
  })

  it('un evento menos definitivo no pisa al rebote; el entregado sí pisa al demorado', () => {
    expect(pisaEstado('rebotado', 'demorado')).toBe(false)
    expect(pisaEstado('rebotado', 'entregado')).toBe(false)
    expect(pisaEstado('demorado', 'entregado')).toBe(true)
    expect(pisaEstado('entregado', 'queja')).toBe(true)
    expect(pisaEstado('aceptado', 'demorado')).toBe(true)
    expect(pisaEstado(undefined, 'entregado')).toBe(true)
  })
})
