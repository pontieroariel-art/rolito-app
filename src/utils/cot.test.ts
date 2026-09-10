import { describe, expect, it } from 'vitest'
import {
  COT_DEFAULTS, domicilioDeCliente, formatoRespaldo, kgDeItems, letraProvincia, normalizarCotConfig, parsearCalleNumero, patenteValida,
  pesoSugerido, requiereCot, salidaSugerida, validarSolicitudCot,
} from './cot'
import type { CotSolicitud, UserProfile } from '@/types'

describe('COT: configuración y kilos', () => {
  it('normaliza un doc vacío con los defaults y respeta lo cargado', () => {
    const c = normalizarCotConfig(null)
    expect(c.habilitado).toBe(false)
    expect(c.plantas.merlo.domicilio).toMatchObject({ calle: 'PRESIDENTE PERON', numero: 26875, cp: '1722', provincia: 'B' })
    const d = normalizarCotConfig({ habilitado: true, ambiente: 'prueba', cuit: '30-69766897-3', umbralKg: 4000, productos: { bolsa_10kg: { pesoKg: 10, codigoArba: '220190', descripcion: 'BOLSA ROLITO 10KG' } }, plantas: { torcuato: { puerta: '002' } } } as never)
    expect(d).toMatchObject({ habilitado: true, ambiente: 'prueba', cuit: '30697668973', umbralKg: 4000 })
    expect(d.plantas.torcuato.puerta).toBe('002')
    expect(d.plantas.torcuato.codigoPlanta).toBe('001')
    expect(d.productos.bolsa_10kg.pesoKg).toBe(10)
  })

  it('sugiere el peso a partir del nombre del producto', () => {
    expect(pesoSugerido({ nombre: 'Hielo bolsa 10kg' })).toBe(10)
    expect(pesoSugerido({ nombre: 'Hielo bolsa 3kg' })).toBe(3)
    expect(pesoSugerido({ nombre: 'Agua de mesa x 6 litros' })).toBe(6)
    expect(pesoSugerido({ nombre: 'Barra de hielo' })).toBe(0)
  })

  it('suma los kilos y avisa qué productos no tienen peso', () => {
    const productos = { bolsa_10kg: { pesoKg: 10, codigoArba: '220190', descripcion: '' }, bolsa_2kg: { pesoKg: 2, codigoArba: '220190', descripcion: '' } }
    const r = kgDeItems([
      { productoId: 'bolsa_10kg', nombre: 'Hielo bolsa 10kg', cantidad: 140 },
      { productoId: 'bolsa_2kg', nombre: 'Hielo bolsa 2kg', cantidad: 1840 },
      { productoId: 'barra', nombre: 'Barra de hielo', cantidad: 5 },
    ], productos)
    expect(r.kg).toBe(5080)
    expect(r.sinPeso).toEqual(['Barra de hielo'])
  })

  it('requiere COT si supera cualquiera de los dos umbrales', () => {
    expect(requiereCot(4500, 0, COT_DEFAULTS)).toBe(true)
    expect(requiereCot(4499.99, 0, COT_DEFAULTS)).toBe(false)
    expect(requiereCot(100, 9_529_691, COT_DEFAULTS)).toBe(true)
  })
})

describe('COT: domicilios y validación', () => {
  it('separa calle y número, y marca S/N cuando no hay número', () => {
    expect(parsearCalleNumero('AMENABAR 2935')).toEqual({ calle: 'AMENABAR', numero: 2935 })
    expect(parsearCalleNumero('Av. Pres. Juan Domingo Perón 26875')).toEqual({ calle: 'Av. Pres. Juan Domingo Perón', numero: 26875 })
    expect(parsearCalleNumero('COLON ESQ LOS ANDES')).toEqual({ calle: 'COLON ESQ LOS ANDES', numero: 0, complemento: 'S/N' })
    expect(parsearCalleNumero('Belgrano 3434 bis')).toEqual({ calle: 'Belgrano', numero: 3434, complemento: 'BIS' })
  })

  it('mapea la provincia a la letra de ARBA', () => {
    expect(letraProvincia('Buenos Aires')).toBe('B')
    expect(letraProvincia('Provincia de Buenos Aires')).toBe('B')
    expect(letraProvincia('Capital Federal')).toBe('C')
    expect(letraProvincia('Ciudad Autónoma de Buenos Aires')).toBe('C')
    expect(letraProvincia('Córdoba')).toBe('X')
    expect(letraProvincia(undefined)).toBe('B')
  })

  it('arma el domicilio de destino desde la sucursal de Tango, o desde la ficha', () => {
    const cliente = {
      address: 'AMENABAR 2935, CAPITAL FEDERAL', domicilioTango: 'AMENABAR 2935', localidadTango: 'CAPITAL FEDERAL', codigoPostalTango: '1428', provinciaTango: 'CAPITAL FEDERAL',
      addresses: [{ id: 'NO.214', nombre: 'x', address: 'Sucre 1530, CABA', lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '', esPrincipal: false,
        domicilioTango: 'MCAL ANTONIO J.DE SUCRE 1530 P', localidadTango: 'CAPITAL FEDERAL', codigoPostalTango: '1428', provinciaTango: 'CAPITAL FEDERAL' }],
    } as unknown as UserProfile
    expect(domicilioDeCliente(cliente, 'NO.214')).toEqual({ calle: 'MCAL ANTONIO J.DE SUCRE 1530 P', numero: 0, complemento: 'S/N', cp: '1428', localidad: 'CAPITAL FEDERAL', provincia: 'C' })
    expect(domicilioDeCliente(cliente)).toEqual({ calle: 'AMENABAR', numero: 2935, cp: '1428', localidad: 'CAPITAL FEDERAL', provincia: 'C' })
  })

  it('valida patentes y la solicitud', () => {
    expect(patenteValida('AG028YN')).toBe(true)
    expect(patenteValida('ab-123')).toBe(false)
    expect(patenteValida('ABC123')).toBe(true)
    const base: CotSolicitud = {
      destino: { tipo: 'cliente', clienteUid: 'u', razonSocial: 'RAFITA S.A.', cuit: '30-71018593-6', consumidorFinal: false, domicilio: { calle: 'DEL CARMEN Y URUGUAY', numero: 0, complemento: 'S/N', cp: '7221', localidad: 'CAÑUELAS', provincia: 'B' } },
      respaldo: { codigoComprobante: '091', prefijo: 25, numero: 58680, importe: 1_800_000 },
      patente: 'AG028YN',
      recorrido: { tipo: 'M', localidad: 'MERLO', ruta: 'RUTA 205' },
      fechaSalida: '2025-12-10', horaSalida: '07:30',
    }
    expect(validarSolicitudCot(base)).toEqual([])
    expect(validarSolicitudCot({ ...base, patente: 'XX', respaldo: { ...base.respaldo, numero: 0 } })).toHaveLength(2)
    expect(validarSolicitudCot({ ...base, destino: { ...base.destino, cuit: '', consumidorFinal: false } as CotSolicitud['destino'] })).toContain('El destinatario no tiene un CUIT válido: marcalo como consumidor final o elegí otro.')
    expect(validarSolicitudCot({ ...base, destino: { tipo: 'planta', plantaId: 'merlo' }, respaldo: { ...base.respaldo, importe: 0 } })).toEqual([])
  })

  it('sugiere la salida en 30 minutos y formatea el remito R', () => {
    expect(salidaSugerida(new Date(2026, 8, 10, 7, 0))).toEqual({ fechaSalida: '2026-09-10', horaSalida: '07:30' })
    expect(salidaSugerida(new Date(2026, 8, 10, 23, 45))).toEqual({ fechaSalida: '2026-09-11', horaSalida: '00:15' })
    expect(formatoRespaldo({ prefijo: 25, numero: 58680 })).toBe('00025-00058680')
  })
})
