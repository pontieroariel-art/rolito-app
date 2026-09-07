import { describe, it, expect } from 'vitest'
import { candidatosAlta, corridaConfiable, decidirBaja, docCuentaDesdeTango, emailAuthDe, type FilaClienteTango } from './clientes'

const fila = (over: Partial<FilaClienteTango> = {}): FilaClienteTango => ({
  idGva14: 100, codGva14: 'FC.900', cuit: '30-52604779-2', razonSocial: 'CLIENTE PRUEBA', domicilio: 'Calle 1', localidad: 'Merlo', provinciaDesc: 'Buenos Aires',
  telefono1: '011 4444-5555', email: 'cliente@ejemplo.com', categoriaIvaCodigo: 'RI', vendedorCodigo: 'AD', ...over,
})

describe('candidatosAlta', () => {
  it('agrupa por CUIT las filas de las dos empresas y descarta CUIT inválido e inhabilitados', () => {
    const { candidatos, descartados } = candidatosAlta([
      { empresa: 'rolito', fila: fila({ idGva14: 7, codGva14: 'FC.900' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 100 }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 101, codGva14: 'FC.901' }) },          // segundo código, mismo CUIT
      { empresa: 'redonhielo', fila: fila({ idGva14: 200, cuit: '00000000000', razonSocial: 'CONSUMIDOR FINAL' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 300, cuit: '20-10433495-5', habilitado: false }) },
    ])
    expect(candidatos).toHaveLength(1)
    expect(candidatos[0].cuit).toBe('30526047792')
    // Redonhielo primero (manda la ficha), después Rolito.
    expect(candidatos[0].filas.map((f) => `${f.empresa}:${f.fila.idGva14}`)).toEqual(['redonhielo:100', 'redonhielo:101', 'rolito:7'])
    expect(descartados.map((d) => d.motivo)).toEqual(['cuit_invalido', 'inhabilitado'])
  })
})

describe('docCuentaDesdeTango', () => {
  const { candidatos } = candidatosAlta([
    { empresa: 'rolito', fila: fila({ idGva14: 7 }) },
    { empresa: 'redonhielo', fila: fila({ idGva14: 100 }) },
    { empresa: 'redonhielo', fila: fila({ idGva14: 101, codGva14: 'FC.901', razonSocial: 'SUCURSAL 2', domicilio: 'Calle 2' }) },
  ])
  const doc = docCuentaDesdeTango(candidatos[0], 'AHORA')

  it('nace activa, con emailAuth por CUIT, sin creadoPor y aprobada por tango', () => {
    expect(doc).toMatchObject({ rol: 'cliente', estado: 'activo', emailAuth: '30526047792@rolito.app', email: 'cliente@ejemplo.com', cuit: '30526047792', aprobadoPor: 'tango', fechaCreacion: 'AHORA' })
    expect(doc.creadoPor).toBeUndefined()
    expect(emailAuthDe('30526047792')).toBe('30526047792@rolito.app')
  })
  it('lleva la identidad por empresa y los alias legacy de Redonhielo', () => {
    expect(doc.tangoIds).toEqual({ redonhielo: [{ idGva14: 100, codigo: 'FC.900' }, { idGva14: 101, codigo: 'FC.901' }], rolito: [{ idGva14: 7, codigo: 'FC.900' }] })
    expect(doc).toMatchObject({ codigoTango: 'FC.900', idGva14Tango: 100, codigoCliente: 'FC.900' })
  })
  it('una dirección por código, la principal primero, sin duplicar el código compartido con Rolito', () => {
    const addrs = doc.addresses as Array<{ id: string; address: string; esPrincipal: boolean; nombre: string }>
    expect(addrs.map((a) => a.id)).toEqual(['FC.900', 'FC.901'])
    expect(addrs[0]).toMatchObject({ esPrincipal: true, nombre: 'Principal', address: 'Calle 1, Merlo, Buenos Aires' })
    expect(addrs[1]).toMatchObject({ esPrincipal: false, nombre: 'SUCURSAL 2', address: 'Calle 2, Merlo, Buenos Aires' })
    expect(doc.address).toBe('Calle 1, Merlo, Buenos Aires')
    expect(doc.telefono).toBe('011 4444-5555')
  })
  it('sin email válido usa el sintético; sin razón social usa el código', () => {
    const { candidatos: c2 } = candidatosAlta([{ empresa: 'rolito', fila: fila({ email: 'nada', razonSocial: '' }) }])
    const d2 = docCuentaDesdeTango(c2[0], 'x')
    expect(d2.email).toBe('30526047792@rolito.app')
    expect(d2.razonSocial).toBe('Cliente FC.900')
    expect(d2.codigoTango).toBeUndefined()   // solo Rolito: sin alias legacy
    expect(d2.tangoIds).toEqual({ rolito: [{ idGva14: 100, codigo: 'FC.900' }] })
  })
})

describe('decidirBaja', () => {
  const ok = { redonhielo: true, rolito: true }
  it('habilitada en alguna empresa → nada, o reactivar si la sync la había bajado', () => {
    expect(decidirBaja({ vinculada: ok, habilitada: { redonhielo: false, rolito: true }, corridaOk: ok }, { estado: 'activo' })).toEqual({ accion: 'nada' })
    expect(decidirBaja({ vinculada: ok, habilitada: { redonhielo: true }, corridaOk: ok }, { estado: 'inactivo', bajaTango: { motivo: 'x' } })).toEqual({ accion: 'reactivar' })
    // Baja hecha a mano por staff (sin bajaTango): no se toca.
    expect(decidirBaja({ vinculada: ok, habilitada: { redonhielo: true }, corridaOk: ok }, { estado: 'inactivo' })).toEqual({ accion: 'nada' })
  })
  it('ausente o inhabilitada en todas sus empresas → baja, con motivo', () => {
    expect(decidirBaja({ vinculada: { redonhielo: true }, habilitada: {}, corridaOk: ok }, { estado: 'activo' })).toEqual({ accion: 'baja', motivo: 'no figura en Tango' })
    expect(decidirBaja({ vinculada: ok, habilitada: { redonhielo: false, rolito: false }, corridaOk: ok }, { estado: 'activo' })).toEqual({ accion: 'baja', motivo: 'inhabilitado en Tango' })
    expect(decidirBaja({ vinculada: ok, habilitada: {}, corridaOk: ok }, { estado: 'inactivo' })).toEqual({ accion: 'nada' })
  })
  it('si alguna de sus empresas no tuvo corrida confiable, no decide', () => {
    expect(decidirBaja({ vinculada: ok, habilitada: {}, corridaOk: { redonhielo: true, rolito: false } }, { estado: 'activo' })).toEqual({ accion: 'nada' })
    expect(decidirBaja({ vinculada: {}, habilitada: {}, corridaOk: ok }, { estado: 'activo' })).toEqual({ accion: 'nada' })
  })
  it('corridaConfiable: 80 % de la anterior; sin anterior alcanza con que traiga algo', () => {
    expect(corridaConfiable(4900, 6087)).toBe(true)
    expect(corridaConfiable(4800, 6087)).toBe(false)
    expect(corridaConfiable(0, undefined)).toBe(false)
    expect(corridaConfiable(10, undefined)).toBe(true)
  })
})

describe('cuentas sin CUIT (consumidor final de Tango, solo promo)', () => {
  it('una fila habilitada sin CUIT válido es candidata por código, agrupando las dos empresas; las genéricas se descartan', () => {
    const { candidatos, descartados } = candidatosAlta([
      { empresa: 'redonhielo', fila: fila({ idGva14: 9023, codGva14: 'CF.38', cuit: '', razonSocial: 'VAZQUEZ' }) },
      { empresa: 'rolito',     fila: fila({ idGva14: 8531, codGva14: 'CF.38', cuit: '', razonSocial: 'VAZQUEZ' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 1, codGva14: 'CF.000', cuit: '', razonSocial: 'CONSUMIDOR FINAL' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 2, codGva14: 'FLEX', cuit: '', razonSocial: 'NO-USAR - FLEXTIL S.A' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 3, codGva14: 'CF.99', cuit: '', razonSocial: 'ALGUIEN', habilitado: false }) },
    ])
    expect(candidatos).toHaveLength(1)
    expect(candidatos[0]).toMatchObject({ cuit: '', clave: 'sincuit-CF_38', sinCuit: true })
    expect(candidatos[0].filas.map((f) => `${f.empresa}:${f.fila.idGva14}`)).toEqual(['redonhielo:9023', 'rolito:8531'])
    expect(descartados.map((d) => d.motivo)).toEqual(['cuit_invalido', 'cuit_invalido', 'inhabilitado'])
  })

  it('la ficha nace sin credencial (sin emailAuth), marcada sinCuit y con la identidad de las dos empresas', () => {
    const { candidatos } = candidatosAlta([
      { empresa: 'rolito',     fila: fila({ idGva14: 8531, codGva14: 'CF.38', cuit: '', razonSocial: 'VAZQUEZ', email: '' }) },
      { empresa: 'redonhielo', fila: fila({ idGva14: 9023, codGva14: 'CF.38', cuit: '', razonSocial: 'VAZQUEZ', email: '' }) },
    ])
    const doc = docCuentaDesdeTango(candidatos[0], 'AHORA')
    expect(doc.sinCuit).toBe(true)
    expect(doc.emailAuth).toBeUndefined()
    expect(doc.email).toBe('')
    expect(doc.cuit).toBe('')
    expect(doc).toMatchObject({ rol: 'cliente', estado: 'activo', codigoTango: 'CF.38', idGva14Tango: 9023, aprobadoPor: 'tango' })
    expect(doc.tangoIds).toEqual({ redonhielo: [{ idGva14: 9023, codigo: 'CF.38' }], rolito: [{ idGva14: 8531, codigo: 'CF.38' }] })
  })

  it('los candidatos con CUIT siguen usando el CUIT como clave', () => {
    const { candidatos } = candidatosAlta([{ empresa: 'redonhielo', fila: fila() }])
    expect(candidatos[0]).toMatchObject({ cuit: '30526047792', clave: '30526047792' })
    expect(candidatos[0].sinCuit).toBeUndefined()
  })
})
