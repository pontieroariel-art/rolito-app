import { beforeEach, describe, expect, it } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import { confirmarRecibosAnulados, confirmarRemitosAnulados } from './anuladosEnTango'

/**
 * ¿La oficina ya anuló en Tango lo que la app dio por anulado? (2026-09-20)
 * La regla que importa: el índice del cliente solo puede CONFIRMAR, nunca
 * desmentir (Tango le borra el cliente al comprobante anulado y lo muda al
 * cajón 000000); el comprobante suelto, por número, decide.
 */

type Doc = Record<string, unknown>
const campo = (d: Doc, f: string): unknown => f.split('.').reduce<unknown>((acc, p) => (acc && typeof acc === 'object' ? (acc as Doc)[p] : undefined), d)
const esMapa = (v: unknown): v is Doc => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
const fusionar = (base: Doc, cambios: Doc): Doc => {
  const out: Doc = { ...base }
  for (const [k, v] of Object.entries(cambios)) out[k] = esMapa(v) && esMapa(out[k]) ? fusionar(out[k] as Doc, v) : v
  return out
}

function firestoreFalso() {
  const docs = new Map<string, Doc>()
  const lecturas: string[] = []
  const snap = (path: string) => ({ id: path.split('/').pop()!, exists: docs.has(path), data: () => docs.get(path), ref: ref(path) })
  const ref = (path: string) => ({
    path,
    get: async () => { lecturas.push(path); return snap(path) },
    set: async (data: Doc, opts?: { merge?: boolean }) => { docs.set(path, opts?.merge ? fusionar(docs.get(path) ?? {}, data) : { ...data }) },
  })
  const consulta = (col: string, filtros: [string, string, unknown][]) => ({
    where: (f: string, op: string, v: unknown) => consulta(col, [...filtros, [f, op, v]]),
    limit: () => consulta(col, filtros),
    get: async () => {
      const lista = [...docs.entries()]
        .filter(([p, d]) => p.startsWith(`${col}/`) && filtros.every(([f, op, v]) => (op === 'in' ? (v as unknown[]).includes(campo(d, f)) : campo(d, f) === v)))
        .map(([p]) => snap(p))
      return { docs: lista, size: lista.length }
    },
  })
  return { docs, lecturas, doc: (path: string) => ref(path), collection: (col: string) => consulta(col, []), getAll: async (...refs: { path: string }[]) => refs.map((r) => snap(r.path)) }
}

let db: ReturnType<typeof firestoreFalso>
const fs = () => db as never
beforeEach(() => { db = firestoreFalso() })

const confirmado = { anulacion: { tango: { estado: 'confirmado', en: FieldValue.serverTimestamp() } } }

describe('confirmarRemitosAnulados', () => {
  const remito = (estadoTango: string, extra: Doc = {}) => ({
    clienteCodigoTango: 'FC.280', tango: { remitoNumero: 'R0110500000700' },
    anulacion: { tipo: 'remito', estado: 'anulada', tango: { estado: estadoTango } }, ...extra,
  })

  it('confirma cuando el índice del cliente muestra el remito con estado A, sin ir al comprobante suelto', async () => {
    db.docs.set('ventasCamion/v1', remito('pendiente_oficina'))
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { remitos: { R0110500000700: { estado: 'A' } } })
    expect(await confirmarRemitosAnulados(fs())).toEqual({ pendientes: 1, confirmados: 1 })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ ...confirmado, tango: { remitoNumero: 'R0110500000700' } })
    expect(db.lecturas.filter((p) => p.startsWith('tangoComprobanteDetalle/'))).toEqual([])
  })

  it('el índice dice P (Tango le borró el cliente al anular) pero el comprobante suelto dice A: confirma igual', async () => {
    db.docs.set('ventasCamion/v1', remito('pendiente_oficina'))
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { remitos: { R0110500000700: { estado: 'P' } } })
    db.docs.set('tangoComprobanteDetalle/redonhielo_REM_R0110500000700', { estado: 'a' })
    expect(await confirmarRemitosAnulados(fs())).toEqual({ pendientes: 1, confirmados: 1 })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject(confirmado)
  })

  it('también los `encolado` (bridge caído), y sin código de cliente sigue decidiendo el suelto', async () => {
    db.docs.set('ventasCamion/v1', remito('encolado', { clienteCodigoTango: '' }))
    db.docs.set('tangoComprobanteDetalle/redonhielo_REM_R0110500000700', { estado: 'A' })
    expect(await confirmarRemitosAnulados(fs())).toEqual({ pendientes: 1, confirmados: 1 })
  })

  it('sin evidencia en ningún lado no confirma; sin número no hay nada que buscar; los ya confirmados no se vuelven a mirar', async () => {
    db.docs.set('ventasCamion/v1', remito('pendiente_oficina'))
    db.docs.set('ventasCamion/v2', remito('pendiente_oficina', { tango: {} }))
    db.docs.set('ventasCamion/v3', remito('confirmado'))
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { remitos: { R0110500000700: { estado: 'F' } } })
    db.docs.set('tangoComprobanteDetalle/redonhielo_REM_R0110500000700', { estado: 'F' })
    expect(await confirmarRemitosAnulados(fs())).toEqual({ pendientes: 2, confirmados: 0 })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { tango: { estado: 'pendiente_oficina' } } })
    expect(db.docs.get('ventasCamion/v2')).toMatchObject({ anulacion: { tango: { estado: 'pendiente_oficina' } } })
  })

  it('un cliente con varios remitos pendientes lee su índice una sola vez', async () => {
    db.docs.set('ventasCamion/v1', remito('pendiente_oficina'))
    db.docs.set('ventasCamion/v2', remito('pendiente_oficina', { tango: { remitoNumero: 'R0110500000701' } }))
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { remitos: { R0110500000700: { estado: 'A' }, R0110500000701: { estado: 'A' } } })
    expect(await confirmarRemitosAnulados(fs())).toEqual({ pendientes: 2, confirmados: 2 })
  })
})

describe('confirmarRecibosAnulados', () => {
  const cobranza = (extra: Doc = {}) => ({
    empresa: 'redonhielo', codigoTango: 'FC.280', tango: { reciboNumero: 'X0110600000168' }, anulacion: { estado: 'anulada', tango: { estado: 'pendiente_oficina' } }, ...extra,
  })

  it('confirma por el índice del cliente (REC_<número> en ANU) y también deja confirmada la solicitud', async () => {
    db.docs.set('cobranzas/c1', cobranza())
    db.docs.set('anulacionesCobranza/c1', { estado: 'aprobada', tango: { estado: 'pendiente_oficina' } })
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { facturas: { REC_X0110600000168: { estado: 'ANU' } } })
    expect(await confirmarRecibosAnulados(fs())).toEqual({ pendientes: 1, confirmados: 1 })
    expect(db.docs.get('cobranzas/c1')).toMatchObject(confirmado)
    expect(db.docs.get('anulacionesCobranza/c1')).toMatchObject({ estado: 'aprobada', tango: { estado: 'confirmado', en: FieldValue.serverTimestamp() } })
  })

  it('caso FERRANTE: anulado en Tango bajo el código 000000, el índice del cliente no lo sabe y el suelto decide; en Rolito busca en su empresa', async () => {
    db.docs.set('cobranzas/c1', cobranza({ empresa: 'rolito' }))
    db.docs.set('tangoComprobantes/rolito_FC.280', { facturas: { REC_X0110600000168: { estado: 'IMP' } } })
    db.docs.set('tangoComprobanteDetalle/rolito_REC_X0110600000168', { estado: 'ANU' })
    expect(await confirmarRecibosAnulados(fs())).toEqual({ pendientes: 1, confirmados: 1 })
    expect(db.docs.get('cobranzas/c1')).toMatchObject(confirmado)
  })

  it('sin número de recibo en Tango, o sin evidencia, no confirma', async () => {
    db.docs.set('cobranzas/c1', cobranza({ tango: {} }))
    db.docs.set('cobranzas/c2', cobranza())
    db.docs.set('tangoComprobantes/redonhielo_FC.280', { facturas: { REC_X0110600000168: { estado: 'IMP' } } })
    expect(await confirmarRecibosAnulados(fs())).toEqual({ pendientes: 2, confirmados: 0 })
    expect(db.docs.get('cobranzas/c2')).toMatchObject({ anulacion: { tango: { estado: 'pendiente_oficina' } } })
    expect(db.docs.has('anulacionesCobranza/c2')).toBe(false)
  })
})
