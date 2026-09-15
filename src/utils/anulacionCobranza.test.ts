import { describe, expect, it } from 'vitest'
import { anulacionCobranzaEnCurso, cobranzaAnulada, cobranzasVigentes, reciboAnulable, textoAnulacionCobranza } from './anulacionCobranza'

const base = { registradoPor: { uid: 'sup', nombre: 'Matías' }, numeroRecibo: 'RS-000168' }

describe('anulación de un recibo de cobranza', () => {
  it('solo cuenta como anulada la que el server marcó "anulada"; pendiente/aprobada están en curso', () => {
    expect(cobranzaAnulada({ anulacion: { estado: 'anulada', solicitudId: 'c1' } })).toBe(true)
    expect(cobranzaAnulada({ anulacion: { estado: 'pendiente', solicitudId: 'c1' } })).toBe(false)
    expect(anulacionCobranzaEnCurso({ anulacion: { estado: 'pendiente', solicitudId: 'c1' } })).toBe(true)
    expect(anulacionCobranzaEnCurso({ anulacion: { estado: 'aprobada', solicitudId: 'c1' } })).toBe(true)
    expect(anulacionCobranzaEnCurso({ anulacion: { estado: 'rechazada', solicitudId: 'c1' } })).toBe(false)
    expect(anulacionCobranzaEnCurso({})).toBe(false)
  })

  it('cobranzasVigentes saca solo las anuladas', () => {
    const xs = [{ id: 'a' }, { id: 'b', anulacion: { estado: 'anulada' as const, solicitudId: 'b' } }, { id: 'c', anulacion: { estado: 'pendiente' as const, solicitudId: 'c' } }]
    expect(cobranzasVigentes(xs).map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('puede pedir la anulación solo el que cobró, sobre un recibo numerado sin anulación en curso', () => {
    expect(reciboAnulable(base, 'sup')).toBe(true)
    expect(reciboAnulable(base, 'otro')).toBe(false)
    expect(reciboAnulable({ ...base, numeroRecibo: undefined }, 'sup')).toBe(false)
    expect(reciboAnulable({ ...base, anulacion: { estado: 'pendiente', solicitudId: 'x' } }, 'sup')).toBe(false)
    expect(reciboAnulable({ ...base, anulacion: { estado: 'anulada', solicitudId: 'x' } }, 'sup')).toBe(false)
    // Tras un rechazo se puede volver a pedir.
    expect(reciboAnulable({ ...base, anulacion: { estado: 'rechazada', solicitudId: 'x' } }, 'sup')).toBe(true)
  })

  it('el texto del chip distingue si Tango ya lo tiene anulado', () => {
    expect(textoAnulacionCobranza(undefined)).toBeNull()
    expect(textoAnulacionCobranza({ estado: 'pendiente', solicitudId: 'x' })?.tono).toBe('warn')
    expect(textoAnulacionCobranza({ estado: 'anulada', solicitudId: 'x', tango: { estado: 'pendiente_oficina' } })?.texto).toContain('la oficina lo anula en Tango')
    expect(textoAnulacionCobranza({ estado: 'anulada', solicitudId: 'x', tango: { estado: 'confirmado' } })?.texto).toContain('anulado en Tango')
    expect(textoAnulacionCobranza({ estado: 'anulada', solicitudId: 'x', tango: { estado: 'no_aplica' } })?.texto).toBe('Recibo anulado')
  })
})
