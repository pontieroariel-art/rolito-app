import { describe, expect, it } from 'vitest'
import { emailDelCliente } from './comprobantesTango'
import type { TangoComprobantesDoc } from '@/types'

// Mail por sucursal (2026-09-23, caso San Joaquín: cuatro estaciones con su
// propio mail en Tango y todo iba al de la casa central).
const idx = (empresa: 'redonhielo' | 'rolito', codigo: string, email?: string): TangoComprobantesDoc =>
  ({ id: `${empresa}_${codigo}`, empresa, codigo, email, facturas: {}, remitos: {} } as unknown as TangoComprobantesDoc)

const sanJoaquin = {
  email: 'alediaz975@yahoo.com.ar',
  addresses: [
    { id: 'BA.307', emailTango: 'alediaz975@yahoo.com.ar' },
    { id: 'FC.484', emailTango: 'estacioncatan@sanjoaquinsa.com.ar' },
    { id: 'FC.485' },
  ],
}
const indices = [
  idx('redonhielo', 'BA.307', 'alediaz975@yahoo.com.ar'),
  idx('redonhielo', 'FC.484', 'estacioncatan@sanjoaquinsa.com.ar'),
  idx('rolito', 'FC.484', ''),
  idx('redonhielo', 'FC.485', 'estacionlaferrere@sanjoaquinsa.com.ar'),
]

describe('emailDelCliente por sucursal', () => {
  it('con el código de la venta va al mail de ESA sucursal, no al de la casa central', () => {
    expect(emailDelCliente(sanJoaquin, indices, null, 'FC.484')).toBe('estacioncatan@sanjoaquinsa.com.ar')
    expect(emailDelCliente(sanJoaquin, indices, null, 'FC.485')).toBe('estacionlaferrere@sanjoaquinsa.com.ar')
  })

  it('el grupo (empresa + código) de la composición sigue mandando', () => {
    expect(emailDelCliente(sanJoaquin, indices, { empresa: 'redonhielo', codigo: 'FC.484' })).toBe('estacioncatan@sanjoaquinsa.com.ar')
  })

  it('si el índice de la sucursal no trae mail (Rolito), vale el de la dirección de esa sucursal', () => {
    const soloRolito = [idx('rolito', 'FC.484', ''), idx('redonhielo', 'BA.307', 'alediaz975@yahoo.com.ar')]
    expect(emailDelCliente(sanJoaquin, soloRolito, null, 'FC.484')).toBe('estacioncatan@sanjoaquinsa.com.ar')
  })

  it('sin mail propio de la sucursal cae al de la cuenta; sin nada en Tango, al de la app si es real', () => {
    expect(emailDelCliente(sanJoaquin, indices, null, 'FC.486')).toBe('alediaz975@yahoo.com.ar')
    expect(emailDelCliente({ email: 'cliente@gmail.com', addresses: [] }, [], null, 'X.1')).toBe('cliente@gmail.com')
    expect(emailDelCliente({ email: '20111111119@rolito.app', addresses: [] }, [])).toBe('')
  })

  it('sin código se comporta como antes: el primer índice con mail', () => {
    expect(emailDelCliente(sanJoaquin, indices)).toBe('alediaz975@yahoo.com.ar')
  })
})
