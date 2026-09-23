import { describe, expect, it } from 'vitest'
import { receptorDeVenta } from './receptorDeVenta'

/**
 * El receptor fiscal de la venta: cliente registrado (ficha con datos de
 * Tango) o consumidor final del mostrador (sin ficha), compartido por la
 * factura y la nota de crédito.
 */

const dbCon = (users: Record<string, Record<string, unknown>>) => ({
  doc: (path: string) => ({ get: async () => ({ exists: path.replace('users/', '') in users, data: () => users[path.replace('users/', '')] }) }),
}) as never

describe('receptorDeVenta', () => {
  it('el cliente registrado sale de su ficha, con la categoría de IVA de Tango, y devuelve el perfil para la percepción', async () => {
    const perfil = { razonSocial: 'ACME S.A.', cuit: '30714265233', categoriaIvaTango: 'RI', direccion: 'x' }
    const r = await receptorDeVenta(dbCon({ cli1: perfil }), 'v1', { clienteId: 'cli1' }, 'ventasCamion')
    expect(r).toEqual({ perfil, receptor: { razonSocial: 'ACME S.A.', cuit: '30714265233', categoriaIvaTango: 'RI' } })
  })

  it('una ficha incompleta no rompe: los campos que faltan van como cadena vacía (y validarReceptor los rechaza después)', async () => {
    const r = await receptorDeVenta(dbCon({ cli1: { razonSocial: 'Sin CUIT' } }), 'v1', { clienteId: 'cli1' }, 'ventasVentanilla')
    expect(r.receptor).toEqual({ razonSocial: 'Sin CUIT', cuit: '', categoriaIvaTango: '' })
  })

  it('el ocasional del mostrador es consumidor final con lo que cargó caja (CUIT o DNI), marcado como mostrador', async () => {
    const r = await receptorDeVenta(dbCon({}), 'w1', { clienteOcasional: { nombre: 'Juan Pérez', dni: '12345678' } }, 'ventasVentanilla')
    expect(r).toEqual({ perfil: undefined, receptor: { razonSocial: 'Juan Pérez', cuit: '', dni: '12345678', categoriaIvaTango: 'CF', mostrador: true } })
  })

  it('con clienteId cuya ficha no existe, en ventanilla cae al ocasional; en el camión no hay a quién facturar', async () => {
    const venta = { clienteId: 'borrado', clienteOcasional: { nombre: 'X', cuit: '20123456786' } }
    expect((await receptorDeVenta(dbCon({}), 'w1', venta, 'ventasVentanilla')).receptor).toMatchObject({ mostrador: true, cuit: '20123456786' })
    await expect(receptorDeVenta(dbCon({}), 'v9', venta, 'ventasCamion')).rejects.toThrow('La venta v9 no tiene un cliente resoluble')
    await expect(receptorDeVenta(dbCon({}), 'w2', {}, 'ventasVentanilla')).rejects.toThrow('no tiene un cliente resoluble')
  })
})
