import { describe, expect, it } from 'vitest'
import { cuentaParaFila, type IndiceUsuarios } from './tangoSync'

// Índice mínimo como el que arma indiceUsuariosClientes (tangoIds ya normalizados).
function indice(perfiles: Record<string, { cuit?: string; codigoCliente?: string; tangoIds?: { redonhielo?: { idGva14: number; codigo: string }[]; rolito?: { idGva14: number; codigo: string }[] } }>): IndiceUsuarios {
  const i: IndiceUsuarios = {
    perfilPorUid: new Map(), porIdGva14: { redonhielo: new Map(), rolito: new Map() }, porCodigo: { redonhielo: new Map(), rolito: new Map() },
    porCuit: new Map(), porCodigoCliente: new Map(),
  }
  for (const [uid, p] of Object.entries(perfiles)) {
    const perfil = { ...p, tangoIds: p.tangoIds ?? {} }
    i.perfilPorUid.set(uid, perfil)
    for (const e of ['redonhielo', 'rolito'] as const) for (const id of perfil.tangoIds[e] ?? []) { i.porIdGva14[e].set(id.idGva14, uid); i.porCodigo[e].set(id.codigo, uid) }
    const cuit = (p.cuit ?? '').replace(/\D/g, '')
    if (cuit.length >= 6) i.porCuit.set(cuit, [...(i.porCuit.get(cuit) ?? []), uid])
    if (p.codigoCliente) i.porCodigoCliente.set(p.codigoCliente, [...(i.porCodigoCliente.get(p.codigoCliente) ?? []), uid])
  }
  return i
}

describe('cuentaParaFila', () => {
  it('ya vinculada por idGva14 → esa cuenta, sin link nuevo', () => {
    const i = indice({ u1: { cuit: '30-52604779-2', tangoIds: { redonhielo: [{ idGva14: 100, codigo: 'FC.900' }] } } })
    expect(cuentaParaFila({ idGva14: 100, codGva14: 'FC.900', cuit: '30-52604779-2' }, 'redonhielo', i)).toEqual({ uid: 'u1', via: 'idGva14', esNuevoLink: false })
  })
  it('por CUIT válido; con dos cuentas del mismo CUIT es ambigua; un CUIT relleno no cuenta', () => {
    const i = indice({ u1: { cuit: '30-52604779-2' }, u2: { cuit: '30-52604779-2' }, u3: { cuit: '20-10433495-5' } })
    expect(cuentaParaFila({ idGva14: 1, codGva14: 'A', cuit: '30-52604779-2' }, 'redonhielo', i)).toEqual({ motivo: 'cuitAmbiguo' })
    expect(cuentaParaFila({ idGva14: 1, codGva14: 'A', cuit: '20-10433495-5' }, 'rolito', i)).toEqual({ uid: 'u3', via: 'cuit', esNuevoLink: true })
    expect(cuentaParaFila({ idGva14: 1, codGva14: 'A', cuit: '00000000000' }, 'rolito', i)).toEqual({ motivo: 'sinCuenta' })
  })
  it('Rolito toma el código ya vinculado en Redonhielo cuando el CUIT no alcanza', () => {
    const i = indice({ u1: { cuit: '', tangoIds: { redonhielo: [{ idGva14: 100, codigo: 'CF.35' }] } } })
    expect(cuentaParaFila({ idGva14: 8528, codGva14: 'CF.35', cuit: '' }, 'rolito', i)).toEqual({ uid: 'u1', via: 'codigo', esNuevoLink: true })
    expect(cuentaParaFila({ idGva14: 8528, codGva14: 'CF.35', cuit: '' }, 'redonhielo', i)).toEqual({ motivo: 'sinCuenta' })
  })
  it('cuenta importada con codigoCliente y sin vínculo en la empresa → se vincula por el código (sin CUIT o con el mismo)', () => {
    const i = indice({
      hel: { cuit: '', codigoCliente: 'FC.589' },                                   // importación de heladeras
      otro: { cuit: '30-52604779-2', codigoCliente: 'FC.204' },                     // CUIT distinto al de Tango: no se toca
      ya:  { cuit: '', codigoCliente: 'CU.034', tangoIds: { redonhielo: [{ idGva14: 5, codigo: 'CU.034' }] } },
    })
    expect(cuentaParaFila({ idGva14: 4000, codGva14: 'FC.589', cuit: '30-70817609-1' }, 'redonhielo', i)).toEqual({ uid: 'hel', via: 'codigoCliente', esNuevoLink: true })
    expect(cuentaParaFila({ idGva14: 4001, codGva14: 'FC.204', cuit: '30-70817609-1' }, 'redonhielo', i)).toEqual({ motivo: 'sinCuenta' })
    expect(cuentaParaFila({ idGva14: 4002, codGva14: 'FC.204', cuit: '30-52604779-2' }, 'rolito', i)).toEqual({ uid: 'otro', via: 'cuit', esNuevoLink: true })
    // Ya vinculada en Redonhielo con otro idGva14: no se vuelve a vincular por codigoCliente en esa empresa.
    expect(cuentaParaFila({ idGva14: 6, codGva14: 'CU.034', cuit: '' }, 'redonhielo', i)).toEqual({ motivo: 'sinCuenta' })
  })
})
