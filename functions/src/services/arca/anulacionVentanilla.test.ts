import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * Anulación con nota de crédito (2026-09-09 / 2026-09-11): cómo queda cada doc
 * (registro, solicitud, venta) según lo que contestó ARCA, la NC X interna de
 * la promo con su contador, y qué hace `emitirNotaCreditoDeAnulacion` antes de
 * llamar a ARCA. ARCA, la config y el receptor se reemplazan por dobles; la
 * escritura en Firestore corre sobre un doble en memoria con batch y transacción.
 */

type Doc = Record<string, unknown>
const esMapa = (v: unknown): v is Doc => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
const fusionar = (base: Doc, cambios: Doc): Doc => {
  const out: Doc = { ...base }
  for (const [k, v] of Object.entries(cambios)) out[k] = esMapa(v) && esMapa(out[k]) ? fusionar(out[k] as Doc, v) : v
  return out
}

function firestoreFalso(inicial: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(inicial))
  const setSync = (path: string, data: Doc, opts?: { merge?: boolean }) => { docs.set(path, opts?.merge ? fusionar(docs.get(path) ?? {}, data) : { ...data }) }
  const ref = (path: string) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data: Doc, opts?: { merge?: boolean }) => setSync(path, data, opts),
  })
  return {
    docs,
    doc: (path: string) => ref(path),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
      get: async (r: { path: string }) => ({ exists: docs.has(r.path), data: () => docs.get(r.path) }),
      update: (r: { path: string }, data: Doc) => { docs.set(r.path, fusionar(docs.get(r.path) ?? {}, data)) },
    }),
    batch: () => {
      const ops: (() => void)[] = []
      const b = { set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) => { ops.push(() => setSync(r.path, data, opts)); return b }, commit: async () => { ops.forEach((f) => f()) } }
      return b
    },
  }
}

const dobles = vi.hoisted(() => ({
  emitir: vi.fn(),
  config: { ambiente: 'produccion', cuit: '30000000007', puntoVenta: 1104, habilitado: true },
}))
vi.mock('./configuracion', () => ({ leerConfigParaEmitir: vi.fn(async () => dobles.config) }))
vi.mock('./puertoFirebase', () => ({ comoDb: (db: unknown) => db, puertoArca: vi.fn(async () => 'PUERTO_ARCA') }))
vi.mock('./receptorDeVenta', () => ({ receptorDeVenta: vi.fn(async () => ({ receptor: { razonSocial: 'ACME', cuit: '30000000007', categoriaIvaTango: 'RI' }, perfil: {} })) }))
vi.mock('./notaCredito', () => ({ emitirNotaCreditoTotal: (opts: unknown) => dobles.emitir(opts) }))

import {
  coleccionDeAnulacion, emitirNotaCreditoDeAnulacion, emitirNotaCreditoInterna, persistirNotaCredito, registrarErrorPrevio,
  reflejarRechazoEnVenta, rutaAnulacion,
} from './anulacionVentanilla'
import type { RegistroFactura } from './facturacionVenta'

let db: ReturnType<typeof firestoreFalso>
const fs = () => db as unknown as Firestore
beforeEach(() => { db = firestoreFalso(); dobles.emitir.mockReset() })

const registroBase: RegistroFactura = {
  ventaId: 'v1', anulacionId: 'v1', tipo: 'nota_credito', estado: 'emitida', puntoVenta: 1104, cbteTipo: 3, numero: 7, cae: '777', caeFchVto: '20260920',
  importes: { fecha: '20260910', neto: 1000, iva: 210, tributos: 0, total: 1210 }, cbtesAsoc: [{ Tipo: 1, PtoVta: 1104, Nro: 5 }],
}

describe('coleccionDeAnulacion y rutas', () => {
  it('la solicitud dice de qué colección es la venta; sin el campo (solicitudes viejas) es ventanilla', () => {
    expect(coleccionDeAnulacion({ coleccion: 'ventasCamion' })).toBe('ventasCamion')
    expect(coleccionDeAnulacion({ coleccion: 'ventasVentanilla' })).toBe('ventasVentanilla')
    expect(coleccionDeAnulacion({})).toBe('ventasVentanilla')
    expect(coleccionDeAnulacion(undefined)).toBe('ventasVentanilla')
    expect(coleccionDeAnulacion({ coleccion: 'otra' })).toBe('ventasVentanilla')
    expect(rutaAnulacion('v1')).toBe('anulacionesVentanilla/v1')
  })
})

describe('persistirNotaCredito: registro + solicitud + venta en un solo batch', () => {
  it('emitida: la solicitud pasa a emitida con la NC, y la venta queda anulada sin perder sus otros campos', async () => {
    db.docs.set('ventasCamion/v1', { total: 1210, clienteNombre: 'ACME', anulacion: { estado: 'aprobada', solicitudId: 'v1' } })
    await persistirNotaCredito(fs(), registroBase, 'ventasCamion')
    expect(db.docs.get('facturasArca/nc_v1')).toMatchObject({ ...registroBase, tipo: 'nota_credito', coleccion: 'ventasCamion', actualizadoEn: FieldValue.serverTimestamp() })
    expect(db.docs.get('facturasArca/nc_v1')).not.toHaveProperty('avisadoEn')
    const nc = { estado: 'emitida', cbteTipo: 3, puntoVenta: 1104, numero: 7, cae: '777', caeFchVto: '20260920', importes: registroBase.importes, cbtesAsoc: registroBase.cbtesAsoc }
    expect(db.docs.get('anulacionesVentanilla/v1')).toEqual({ estado: 'emitida', notaCredito: nc, ultimoError: null, actualizadoEn: FieldValue.serverTimestamp() })
    expect(db.docs.get('ventasCamion/v1')).toEqual({ total: 1210, clienteNombre: 'ACME', anulacion: { estado: 'anulada', solicitudId: 'v1', notaCredito: nc } })
  })

  it('incierta: la solicitud NO cambia de estado (sigue aprobada) y la venta no se anula todavía', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    await persistirNotaCredito(fs(), { ...registroBase, estado: 'incierta', cae: null, motivo: 'timeout' })
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'aprobada', ultimoError: 'timeout', notaCredito: { estado: 'incierta', numero: 7, cae: null } })
    expect(db.docs.get('ventasVentanilla/v1')).toEqual({ anulacion: { estado: 'aprobada', solicitudId: 'v1' } })
  })

  it('rechazada: solicitud y venta en error con el motivo (o uno por defecto), y el registro queda para volver a avisar', async () => {
    await persistirNotaCredito(fs(), { ...registroBase, estado: 'rechazada', cae: null, motivo: undefined })
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'error', ultimoError: 'ARCA rechazó la nota de crédito' })
    expect(db.docs.get('ventasVentanilla/v1')).toEqual({ anulacion: { estado: 'error', solicitudId: 'v1' } })
    expect(db.docs.get('facturasArca/nc_v1')).toMatchObject({ avisadoEn: null, coleccion: 'ventasVentanilla' })
  })

  it('el default de colección es ventanilla; un registro sin importes ni cbtesAsoc no deja undefined en la NC', async () => {
    await persistirNotaCredito(fs(), { ...registroBase, importes: undefined, cbtesAsoc: undefined })
    const nc = (db.docs.get('anulacionesVentanilla/v1') as Doc).notaCredito as Doc
    expect(nc).not.toHaveProperty('importes')
    expect(nc.cbtesAsoc).toEqual([])
    expect(db.docs.has('ventasVentanilla/v1')).toBe(true)
  })
})

describe('registrarErrorPrevio y reflejarRechazoEnVenta', () => {
  it('un error antes de reservar número deja el registro pendiente (para que la reconciliación reintente) y el motivo en la solicitud', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    await registrarErrorPrevio(fs(), 'v1', 'sin importes', 'ventasCamion')
    expect(db.docs.get('facturasArca/nc_v1')).toMatchObject({ ventaId: 'v1', anulacionId: 'v1', tipo: 'nota_credito', coleccion: 'ventasCamion', estado: 'pendiente', motivo: 'sin importes' })
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'aprobada', ultimoError: 'sin importes' })
  })
  it('el rechazo deja la venta contando de nuevo, en la colección que corresponde', async () => {
    db.docs.set('ventasCamion/v1', { total: 5 })
    await reflejarRechazoEnVenta(fs(), 'v1', 'ventasCamion')
    expect(db.docs.get('ventasCamion/v1')).toEqual({ total: 5, anulacion: { estado: 'rechazada', solicitudId: 'v1' } })
  })
})

describe('emitirNotaCreditoInterna: la NC X de una promo, sin ARCA', () => {
  const venta = { canal: 'promo', total: 500, tango: { estado: 'confirmado', facturaNumero: 'B0000300000009' } }

  it('exige que Tango ya tenga la factura: sin eso, error con el estado y nada numerado', async () => {
    db.docs.set('config/numeracionInterna_notaCreditoX', { next: 1, puntoVenta: 1104 })
    expect(await emitirNotaCreditoInterna(fs(), 'v1', 'ventasCamion', { canal: 'promo' })).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'error', ultimoError: expect.stringContaining('sin enviar') })
    expect(db.docs.get('ventasCamion/v1')).toEqual({ anulacion: { estado: 'error', solicitudId: 'v1' } })
    expect(await emitirNotaCreditoInterna(fs(), 'v2', 'ventasCamion', { tango: { estado: 'pendiente' } })).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v2')).toMatchObject({ ultimoError: expect.stringContaining('estado pendiente') })
    expect(db.docs.get('config/numeracionInterna_notaCreditoX')).toEqual({ next: 1, puntoVenta: 1104 })
  })

  it('sin contador (o mal sembrado) deja la solicitud en error diciendo qué falta', async () => {
    expect(await emitirNotaCreditoInterna(fs(), 'v1', 'ventasCamion', venta)).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'error', ultimoError: expect.stringContaining('numeracionInterna_notaCreditoX') })
    db.docs.set('config/numeracionInterna_notaCreditoX', { next: 'x', puntoVenta: 1104 })
    expect(await emitirNotaCreditoInterna(fs(), 'v1', 'ventasCamion', venta)).toBeNull()
  })

  it('un talonario agotado (next > ultimo) no emite', async () => {
    db.docs.set('config/numeracionInterna_notaCreditoX', { next: 11, puntoVenta: 1104, ultimo: 10 })
    expect(await emitirNotaCreditoInterna(fs(), 'v1', 'ventasCamion', venta)).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ ultimoError: expect.stringContaining('se agotó') })
    expect(db.docs.get('config/numeracionInterna_notaCreditoX')).toMatchObject({ next: 11 })
  })

  it('camino feliz: toma el número, avanza el contador, la solicitud queda emitida y la venta anulada con la NC X', async () => {
    db.docs.set('config/numeracionInterna_notaCreditoX', { next: 3, puntoVenta: 1104, ultimo: 10 })
    db.docs.set('ventasCamion/v1', { ...venta, anulacion: { estado: 'aprobada' } })
    const r = await emitirNotaCreditoInterna(fs(), 'v1', 'ventasCamion', venta)
    expect(r).toEqual({ estado: 'emitida', interna: true, puntoVenta: 1104, numero: 3 })
    expect(db.docs.get('config/numeracionInterna_notaCreditoX')).toMatchObject({ next: 4 })
    const nci = { tipo: 'notaCreditoX', puntoVenta: 1104, numero: 3, fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'emitida', ultimoError: null, notaCreditoInterna: nci })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ canal: 'promo', anulacion: { estado: 'anulada', solicitudId: 'v1', notaCreditoInterna: nci } })
    // La siguiente toma el 4.
    expect(await emitirNotaCreditoInterna(fs(), 'v2', 'ventasCamion', venta)).toMatchObject({ numero: 4 })
  })
})

describe('emitirNotaCreditoDeAnulacion: qué mira antes de ir a ARCA', () => {
  const contado = { canal: 'contado', formaPago: 'contado_efectivo', total: 1210, clienteId: 'cli1' }
  const espejo = { estado: 'emitida', cae: '123', cbteTipo: 1, puntoVenta: 1104, numero: 5, importes: { fecha: '20260910', neto: 1000, iva: 210, total: 1210 } }

  it('sin solicitud aprobada, o sin venta, no hace nada', async () => {
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toBeNull()
    db.docs.set('anulacionesVentanilla/v1', { estado: 'pendiente' })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toBeNull()
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toBeNull()   // la venta no existe
    expect(dobles.emitir).not.toHaveBeenCalled()
  })

  it('una venta que no factura la app (cta. cte. → remito) no tiene NC que emitir', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    db.docs.set('ventasVentanilla/v1', { ...contado, formaPago: 'cuenta_corriente' })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toBeNull()
    expect(dobles.emitir).not.toHaveBeenCalled()
  })

  it('la promo va por la NC interna (sin ARCA), leyendo la venta de la colección de la solicitud', async () => {
    db.docs.set('config/numeracionInterna_notaCreditoX', { next: 1, puntoVenta: 1104 })
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada', coleccion: 'ventasCamion' })
    db.docs.set('ventasCamion/v1', { canal: 'promo', total: 500, tango: { estado: 'confirmado', facturaNumero: 'B1' } })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toMatchObject({ interna: true, numero: 1 })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { estado: 'anulada' } })
    expect(dobles.emitir).not.toHaveBeenCalled()
  })

  it('con la factura original no emitida (incierta / rechazada / sin factura) deja error y pide resolverla primero', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    db.docs.set('ventasVentanilla/v1', { ...contado, factura: { estado: 'incierta' } })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v1')).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'error', ultimoError: expect.stringContaining('estado incierta') })
    expect(db.docs.get('ventasVentanilla/v1')).toMatchObject({ anulacion: { estado: 'error', solicitudId: 'v1' } })
    db.docs.set('anulacionesVentanilla/v2', { estado: 'aprobada' })
    db.docs.set('ventasVentanilla/v2', { ...contado })
    expect(await emitirNotaCreditoDeAnulacion(fs(), 'v2')).toBeNull()
    expect(db.docs.get('anulacionesVentanilla/v2')).toMatchObject({ ultimoError: expect.stringContaining('sin factura') })
    expect(dobles.emitir).not.toHaveBeenCalled()
  })

  it('sin importes guardados en ningún lado no se puede armar la NC: relanza (el trigger deja el registro pendiente)', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    db.docs.set('ventasVentanilla/v1', { ...contado, factura: { ...espejo, importes: undefined } })
    await expect(emitirNotaCreditoDeAnulacion(fs(), 'v1')).rejects.toThrow(/no tiene importes/)
  })

  it('camino feliz: arma la factura de origen desde el registro (con su detalle) por sobre el espejo, y lo que guarda pasa por persistirNotaCredito', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada', coleccion: 'ventasCamion' })
    db.docs.set('ventasCamion/v1', { ...contado, factura: { ...espejo, numero: 999 } })   // el espejo miente: manda el registro
    const detalle = { CbteDesde: 5, CbteHasta: 5, ImpTotal: 1210 }
    db.docs.set('facturasArca/v1', { puntoVenta: 1104, cbteTipo: 1, numero: 5, importes: espejo.importes, detalle })
    dobles.emitir.mockImplementation(async (opts: { guardar: (r: RegistroFactura) => Promise<void> }) => { await opts.guardar(registroBase); return registroBase })

    const r = await emitirNotaCreditoDeAnulacion(fs(), 'v1')
    expect(r).toBe(registroBase)
    const opts = dobles.emitir.mock.calls[0]![0] as Record<string, unknown>
    expect(opts).toMatchObject({ arca: 'PUERTO_ARCA', config: dobles.config, ventaId: 'v1', anulacionId: 'v1', receptor: { razonSocial: 'ACME' } })
    expect(opts.factura).toEqual({ puntoVenta: 1104, cbteTipo: 1, numero: 5, importes: espejo.importes, detalle })
    // `leer` mira el registro de la NC (no el de la factura).
    db.docs.set('facturasArca/nc_v1', { estado: 'incierta', numero: 7 })
    expect(await (opts.leer as () => Promise<unknown>)()).toMatchObject({ estado: 'incierta', numero: 7 })
    // Lo que guardó el doble llegó a los tres docs, en la colección del camión.
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'emitida', notaCredito: { numero: 7, cae: '777' } })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { estado: 'anulada', solicitudId: 'v1' } })
  })

  it('sin registro de la factura (anteriores al 2026-09-09) usa el espejo de la venta y no manda detalle', async () => {
    db.docs.set('anulacionesVentanilla/v1', { estado: 'aprobada' })
    db.docs.set('ventasVentanilla/v1', { ...contado, factura: espejo })
    dobles.emitir.mockResolvedValue(registroBase)
    await emitirNotaCreditoDeAnulacion(fs(), 'v1')
    const opts = dobles.emitir.mock.calls[0]![0] as Record<string, unknown>
    expect(opts.factura).toEqual({ puntoVenta: 1104, cbteTipo: 1, numero: 5, importes: espejo.importes })
  })
})
