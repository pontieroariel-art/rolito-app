import { describe, expect, it } from 'vitest'
import { esClienteFacturable, esCuitValido } from './facturable'

// Los mismos casos que cubre `validarReceptor` del lado servidor
// (functions/src/services/arca/comprobante.ts): si allá cambian las reglas,
// estos tests son los que deberían empezar a fallar acá.

const clienteOk = {
  razonSocial: 'CLIENTE DE PRUEBA S.A.',
  cuit: '30-69766897-3',
  categoriaIvaTango: 'RI',
}

describe('esCuitValido', () => {
  it('acepta CUIT reales', () => {
    expect(esCuitValido('30697668973')).toBe(true)   // Redonhielo
    expect(esCuitValido('30-68731043-4')).toBe(true) // con guiones
    expect(esCuitValido('20111111112')).toBe(true)
  })

  it('rechaza los que no cierran', () => {
    expect(esCuitValido('30697668974')).toBe(false)  // dígito verificador cambiado
    expect(esCuitValido('123')).toBe(false)
    expect(esCuitValido('')).toBe(false)
    expect(esCuitValido('abcdefghijk')).toBe(false)
  })
})

describe('esClienteFacturable', () => {
  it('deja pasar a un Responsable Inscripto completo, con factura A', () => {
    expect(esClienteFacturable(clienteOk)).toEqual({ facturable: true, clase: 'A' })
  })

  it('a un consumidor final le corresponde factura B', () => {
    expect(esClienteFacturable({ ...clienteOk, categoriaIvaTango: 'CF' }))
      .toEqual({ facturable: true, clase: 'B' })
  })

  it('frena al cliente sin condición frente al IVA', () => {
    // El caso de los 153 clientes que hoy no tienen el dato.
    const r = esClienteFacturable({ ...clienteOk, categoriaIvaTango: undefined })
    expect(r.facturable).toBe(false)
    expect(r).toMatchObject({ motivos: ['no tiene cargada la condición frente al IVA'] })
  })

  it('frena al cliente sin CUIT o con CUIT que no cierra', () => {
    expect(esClienteFacturable({ ...clienteOk, cuit: '' }))
      .toMatchObject({ facturable: false, motivos: ['no tiene CUIT cargado'] })
    expect(esClienteFacturable({ ...clienteOk, cuit: '30697668974' }))
      .toMatchObject({ facturable: false, motivos: ['tiene un CUIT inválido (30697668974)'] })
  })

  it('frena la exportación: no es una venta de calle', () => {
    expect(esClienteFacturable({ ...clienteOk, categoriaIvaTango: 'EXE' }))
      .toMatchObject({ facturable: false, motivos: ['está marcado como exportación'] })
  })

  it('frena una condición desconocida en vez de adivinar', () => {
    const r = esClienteFacturable({ ...clienteOk, categoriaIvaTango: 'ZZ' })
    expect(r.facturable).toBe(false)
    expect(r).toMatchObject({ motivos: ['tiene una condición frente al IVA que no reconocemos ("ZZ")'] })
  })

  it('junta todos los motivos, no solo el primero', () => {
    const r = esClienteFacturable({ razonSocial: '', cuit: '', categoriaIvaTango: '' })
    expect(r.facturable).toBe(false)
    if (!r.facturable) expect(r.motivos).toHaveLength(3)
  })

  it('el nombre de fantasía NO reemplaza a la razón social', () => {
    // El trigger del servidor manda `perfil.razonSocial` tal cual, así que un
    // cliente cargado solo con nombre ("Kiosco de Juan") lo rechaza ARCA. Si acá
    // lo dejáramos pasar, el chofer se enteraría cuando ya no sirve de nada.
    expect(esClienteFacturable({ ...clienteOk, razonSocial: '' }))
      .toMatchObject({ facturable: false, motivos: ['no tiene razón social'] })
  })

  it('no se marea con minúsculas ni espacios en el código', () => {
    expect(esClienteFacturable({ ...clienteOk, categoriaIvaTango: ' ri ' }))
      .toEqual({ facturable: true, clase: 'A' })
  })
})
