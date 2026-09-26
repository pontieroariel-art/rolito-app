import { describe, it, expect } from 'vitest'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { soloLoQueCambia } from './cambiosCliente'

const hora = FieldValue.serverTimestamp()

describe('soloLoQueCambia', () => {
  it('sin cambios en la ficha no escribe nada', () => {
    const alta = Timestamp.fromMillis(1_700_000_000_000)
    const perfil = { razonSocial: 'ACME SA', condicionVenta: 'Cta. cte. 30 días', telefono: '1155556666', fechaAlta: Timestamp.fromMillis(1_700_000_000_000) }
    expect(soloLoQueCambia({ razonSocial: 'ACME SA', condicionVenta: 'Cta. cte. 30 días', telefono: '1155556666', fechaAlta: alta, tangoUltimaSync: hora }, perfil)).toBeNull()
  })

  it('una condición de venta nueva se escribe, con lo demás igual afuera', () => {
    const r = soloLoQueCambia({ razonSocial: 'ACME SA', condicionVenta: 'Contado', tangoUltimaSync: hora }, { razonSocial: 'ACME SA', condicionVenta: 'Cta. cte. 30 días' })
    expect(r).not.toBeNull()
    expect(Object.keys(r!).sort()).toEqual(['condicionVenta', 'tangoUltimaSync'])
    expect(r!.condicionVenta).toBe('Contado')
  })

  it('un campo que el perfil no tenía se escribe', () => {
    expect(soloLoQueCambia({ codVendedor: '12', tangoUltimaSync: hora }, {})).toMatchObject({ codVendedor: '12' })
  })

  it('los campos que el sync pone solo al detectar un cambio nunca se filtran', () => {
    const r = soloLoQueCambia({ 'habilitadoTango.redonhielo': true, 'tangoIds.redonhielo': [{ idGva14: 1, codigo: 'A' }], codigoTango: 'A', tangoUltimaSync: hora },
      { habilitadoTango: { redonhielo: true }, codigoTango: 'A' })
    expect(Object.keys(r!).sort()).toEqual(['codigoTango', 'habilitadoTango.redonhielo', 'tangoIds.redonhielo', 'tangoUltimaSync'])
  })

  it('una fecha de alta distinta se escribe', () => {
    expect(soloLoQueCambia({ fechaAlta: Timestamp.fromMillis(2_000), tangoUltimaSync: hora }, { fechaAlta: Timestamp.fromMillis(1_000) })).not.toBeNull()
  })
})
