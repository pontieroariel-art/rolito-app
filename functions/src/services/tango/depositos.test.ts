import { describe, expect, it, vi } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import { recortarDeposito, sincronizarDepositosTango, tipoDefaultDeposito } from './depositos'
import type { TangoClient } from './client'

/**
 * Catálogo de depósitos de Tango (2026-09-06): cómo se lee cada fila y, en la
 * sync, que lo editable en la app (tipo, activo, usuario) no se pise nunca.
 */

type Doc = Record<string, unknown>
function firestoreFalso(inicial: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(inicial))
  let commits = 0
  const ref = (path: string) => ({ path })
  return {
    docs, commits: () => commits,
    doc: ref,
    collection: (col: string) => ({ select: () => ({ get: async () => ({ docs: [...docs.keys()].filter((p) => p.startsWith(`${col}/`)).map((p) => ({ id: p.split('/').pop()! })) }) }) }),
    batch: () => {
      const ops: (() => void)[] = []
      const b = {
        set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) => { ops.push(() => { docs.set(r.path, opts?.merge ? { ...(docs.get(r.path) ?? {}), ...data } : { ...data }) }); return b },
        commit: async () => { commits++; ops.forEach((f) => f()) },
      }
      return b
    },
  }
}
const tangoCon = (filas: Doc[]) => ({ getAll: vi.fn(async () => filas) }) as unknown as TangoClient

describe('tipoDefaultDeposito', () => {
  it('01/02 son plantas, los contables (26, 29, 81, 97, 98, 99) internos y el resto repartidores', () => {
    expect(tipoDefaultDeposito('01')).toBe('planta')
    expect(tipoDefaultDeposito('02')).toBe('planta')
    for (const c of ['26', '29', '81', '97', '98', '99']) expect(tipoDefaultDeposito(c)).toBe('interno')
    expect(tipoDefaultDeposito('03')).toBe('repartidor')
    expect(tipoDefaultDeposito('55')).toBe('repartidor')
  })
})

describe('recortarDeposito', () => {
  it('lee código, nombre, id e inhabilitado tolerando el casing de la API y recortando espacios', () => {
    expect(recortarDeposito({ cod_sta22: ' 03 ', nombre_suc: 'SERGIO ALVAREZ ', id_sta22: 22, inhabilita: false })).toEqual({ codigo: '03', nombre: 'SERGIO ALVAREZ', idSta22: 22, inhabilitado: false })
    expect(recortarDeposito({ COD_STA22: '99', NOMBRE_SUC: 'MERMAS', ID_STA22: 99, INHABILITA: true })).toMatchObject({ codigo: '99', inhabilitado: true })
    // Inhabilitado solo si es `true` de verdad, no 'S' ni 1.
    expect(recortarDeposito({ COD_STA22: '04', ID_STA22: 4, INHABILITA: 'S' })).toMatchObject({ inhabilitado: false, nombre: '' })
  })
  it('sin código o sin id entero no es un depósito', () => {
    expect(recortarDeposito({ NOMBRE_SUC: 'X', ID_STA22: 1 })).toBeNull()
    expect(recortarDeposito({ COD_STA22: '03', ID_STA22: 'abc' })).toBeNull()
    expect(recortarDeposito({ COD_STA22: '03' })).toBeNull()
  })
})

describe('sincronizarDepositosTango', () => {
  const filas = [
    { COD_STA22: '01', NOMBRE_SUC: 'DON TORCUATO', ID_STA22: 1, INHABILITA: false },
    { COD_STA22: '03', NOMBRE_SUC: 'SERGIO ALVAREZ', ID_STA22: 3, INHABILITA: false },
    { COD_STA22: '55', NOMBRE_SUC: 'VIEJO', ID_STA22: 55, INHABILITA: true },
    { NOMBRE_SUC: 'basura', ID_STA22: 77 },
  ]

  it('exige la empresa de Redonhielo en la config', async () => {
    await expect(sincronizarDepositosTango(firestoreFalso() as never, tangoCon(filas), {})).rejects.toThrow('config/tango.companies.redonhielo')
  })

  it('un código nuevo nace con tipo por defecto, activo = !inhabilitado y sin usuario; uno existente solo actualiza lo de Tango', async () => {
    const db = firestoreFalso({ 'depositosTango/03': { codigo: '03', nombre: 'ALVAREZ S.', tipo: 'planta', activo: false, uid: 'u1', usuarioNombre: 'Sergio' } })
    const tango = tangoCon(filas)
    const resumen = await sincronizarDepositosTango(db as never, tango, { companies: { redonhielo: 1 } })
    expect(tango.getAll).toHaveBeenCalledWith(1, 2941)
    expect(resumen).toEqual({ recibidos: 3, nuevos: 2, actualizados: 1, inhabilitados: 1 })
    expect(db.docs.get('depositosTango/01')).toEqual({ codigo: '01', nombre: 'DON TORCUATO', idSta22: 1, inhabilitado: false, tipo: 'planta', activo: true, uid: null, usuarioNombre: null, usuarioRol: null, actualizadoEn: FieldValue.serverTimestamp(), creadoEn: FieldValue.serverTimestamp() })
    expect(db.docs.get('depositosTango/55')).toMatchObject({ tipo: 'repartidor', activo: false, inhabilitado: true })
    // Lo editable en la app (tipo, activo, usuario) no se toca; el nombre de Tango sí.
    expect(db.docs.get('depositosTango/03')).toEqual({ codigo: '03', nombre: 'SERGIO ALVAREZ', idSta22: 3, inhabilitado: false, tipo: 'planta', activo: false, uid: 'u1', usuarioNombre: 'Sergio', actualizadoEn: FieldValue.serverTimestamp() })
    expect(db.docs.has('depositosTango/undefined')).toBe(false)
    expect(db.commits()).toBe(1)
  })

  it('corta los batches cada 400 escrituras y no commitea uno vacío', async () => {
    const muchos = Array.from({ length: 401 }, (_, i) => ({ COD_STA22: String(1000 + i), NOMBRE_SUC: `D${i}`, ID_STA22: i + 1 }))
    const db = firestoreFalso()
    expect(await sincronizarDepositosTango(db as never, tangoCon(muchos), { companies: { redonhielo: 1 } })).toMatchObject({ recibidos: 401, nuevos: 401 })
    expect(db.commits()).toBe(2)
    expect(db.docs.size).toBe(401)
    const vacio = firestoreFalso()
    expect(await sincronizarDepositosTango(vacio as never, tangoCon([]), { companies: { redonhielo: 1 } })).toEqual({ recibidos: 0, nuevos: 0, actualizados: 0, inhabilitados: 0 })
    expect(vacio.commits()).toBe(0)
  })
})
