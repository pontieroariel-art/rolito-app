import { describe, expect, it } from 'vitest'
import { plantillasWhatsApp } from './plantillasWhatsApp'
import type { UserProfile } from '@/types'

const cliente = { addresses: [{ id: '1', address: 'Humboldt 1550', esPrincipal: true }] } as unknown as UserProfile
const sinDireccion = {} as UserProfile

describe('plantillas de WhatsApp del supervisor', () => {
  it('se presenta con el nombre de pila y nombra el domicilio', () => {
    const [visita, retencion, libre] = plantillasWhatsApp(cliente, { nombre: 'Matías Vinjoy' })
    expect(visita.texto).toBe('Hola, soy Matías de Rolito. Estoy pasando hoy por Humboldt 1550 para cobrar. ¿Les queda cómodo?')
    expect(retencion.texto).toContain('comprobante de la retención')
    // "Escribir yo" abre el chat vacío: no toda conversación entra en una plantilla.
    expect(libre.texto).toBe('')
  })

  it('sin domicilio cargado no inventa una dirección', () => {
    const [visita] = plantillasWhatsApp(sinDireccion, { nombre: 'Matías' })
    expect(visita.texto).toBe('Hola, soy Matías de Rolito. Estoy pasando hoy para cobrar. ¿Les queda cómodo?')
  })

  it('sin supervisor identificado habla en plural, no dice "soy undefined"', () => {
    const [visita] = plantillasWhatsApp(sinDireccion, null)
    expect(visita.texto).toBe('Hola, te escribimos de Rolito. Estamos pasando hoy para cobrar. ¿Les queda cómodo?')
    expect(visita.texto).not.toContain('undefined')
  })
})
