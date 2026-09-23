import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

/**
 * La cola a Tango (tango-outbox): qué encola cada trigger, con qué id
 * determinístico y qué payload, y cómo vuelve el write-back al doc de origen.
 *
 * Firestore se reemplaza por un doble en memoria (colecciones, consultas con
 * where, transacciones y `create` que rebota ALREADY_EXISTS con código 6, que
 * es lo que hace idempotente a la cola). Todo lo demás es el código real.
 */

type Doc = Record<string, unknown>
const esMapa = (v: unknown): v is Doc => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
const transform = (v: unknown) => (v && typeof v === 'object' ? (v as object).constructor.name : '')

function fusionar(base: Doc, cambios: Doc): Doc {
  const out: Doc = { ...base }
  for (const [k, v] of Object.entries(cambios)) {
    if (transform(v) === 'DeleteTransform') { delete out[k]; continue }
    if (transform(v) === 'ArrayUnionTransform') {
      const previos = Array.isArray(out[k]) ? (out[k] as unknown[]) : []
      const nuevos = (v as { elements: unknown[] }).elements.filter((e) => !previos.some((p) => JSON.stringify(p) === JSON.stringify(e)))
      out[k] = [...previos, ...nuevos]; continue
    }
    out[k] = esMapa(v) && esMapa(out[k]) ? fusionar(out[k] as Doc, v) : v
  }
  return out
}

/** `update` con dot-paths ('tango.estado') como el SDK. */
function conDotPaths(base: Doc, cambios: Doc): Doc {
  let out = { ...base }
  for (const [k, v] of Object.entries(cambios)) {
    const partes = k.split('.')
    const anidado = partes.reduceRight<Doc>((acc, p) => ({ [p]: acc }), v as Doc)
    out = fusionar(out, partes.length > 1 ? anidado : { [k]: v })
  }
  return out
}

const millis = (v: unknown): unknown => (v && typeof v === 'object' && 'toMillis' in (v as object) ? (v as Timestamp).toMillis() : v)
const campo = (d: Doc, f: string): unknown => f.split('.').reduce<unknown>((acc, p) => (acc && typeof acc === 'object' ? (acc as Doc)[p] : undefined), d)

class YaExiste extends Error { code = 6 }

function firestoreFalso(inicial: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(inicial))
  const escrituras: { op: string; path: string; data?: Doc }[] = []
  const snap = (path: string) => {
    const d = docs.get(path)
    return { id: path.split('/').pop()!, exists: d !== undefined, data: () => d, ref: ref(path) }
  }
  const ref = (path: string) => ({
    id: path.split('/').pop()!,
    path,
    get: async () => snap(path),
    create: async (data: Doc) => { if (docs.has(path)) throw new YaExiste('ALREADY_EXISTS'); docs.set(path, { ...data }); escrituras.push({ op: 'create', path, data }) },
    set: async (data: Doc, opts?: { merge?: boolean }) => { setSync(path, data, opts) },
    update: async (data: Doc) => { updateSync(path, data) },
    delete: async () => { docs.delete(path); escrituras.push({ op: 'delete', path }) },
  })
  const setSync = (path: string, data: Doc, opts?: { merge?: boolean }) => {
    docs.set(path, opts?.merge ? fusionar(docs.get(path) ?? {}, data) : fusionar({}, data)); escrituras.push({ op: 'set', path, data })
  }
  const updateSync = (path: string, data: Doc) => {
    if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`)
    docs.set(path, conDotPaths(docs.get(path)!, data)); escrituras.push({ op: 'update', path, data })
  }
  const consulta = (col: string, filtros: [string, string, unknown][], tope?: number) => ({
    where: (f: string, op: string, v: unknown) => consulta(col, [...filtros, [f, op, v]], tope),
    limit: (n: number) => consulta(col, filtros, n),
    select: () => consulta(col, filtros, tope),
    get: async () => {
      let filas = [...docs.entries()].filter(([p]) => p.startsWith(`${col}/`) && !p.slice(col.length + 1).includes('/'))
      for (const [f, op, v] of filtros) {
        filas = filas.filter(([, d]) => {
          const a = millis(campo(d, f)), b = millis(v)
          if (op === '==') return a === b
          if (op === '>=') return (a as number) >= (b as number)
          if (op === '<') return (a as number) < (b as number)
          if (op === 'in') return (v as unknown[]).includes(a)
          throw new Error(`operador no soportado ${op}`)
        })
      }
      const lista = (tope ? filas.slice(0, tope) : filas).map(([p]) => snap(p))
      return { docs: lista, size: lista.length, empty: lista.length === 0 }
    },
  })
  const db = {
    docs, escrituras,
    doc: (path: string) => ref(path),
    collection: (col: string) => ({ ...consulta(col, []), doc: (id: string) => ref(`${col}/${id}`) }),
    getAll: async (...refs: { path: string }[]) => refs.map((r) => snap(r.path)),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
      get: async (r: { path: string }) => snap(r.path),
      set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) => setSync(r.path, data, opts),
      update: (r: { path: string }, data: Doc) => updateSync(r.path, data),
      delete: (r: { path: string }) => { docs.delete(r.path) },
    }),
    batch: () => {
      const ops: (() => void)[] = []
      const b = {
        set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) => { ops.push(() => setSync(r.path, data, opts)); return b },
        update: (r: { path: string }, data: Doc) => { ops.push(() => updateSync(r.path, data)); return b },
        delete: (r: { path: string }) => { ops.push(() => { docs.delete(r.path) }); return b },
        commit: async () => { ops.forEach((f) => f()) },
      }
      return b
    },
  }
  return db
}

const estado = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('firebase-admin/firestore')>()
  return { ...orig, getFirestore: () => estado.db }
})

import {
  codigoDescarga, numerarDescarga, onAnulacionEmitida, onCobranzaCreada, onDescargaCamionCreada, onOutboxConfirmado,
  onProduccionPalletCreado, onRemitoCargaCreado, onRemitoCargaRegreso, onVentaCamionCreada, onVentaCamionFacturada,
  onVentaVentanillaCreada, onVentaVentanillaFacturada,
} from './tangoOutbox'

type Db = ReturnType<typeof firestoreFalso>
let db: Db
beforeEach(() => { db = firestoreFalso(); estado.db = db })

// Eventos de Firestore con la forma mínima que leen los handlers.
const creado = (path: string, params: Record<string, string>) => ({ data: { data: () => db.docs.get(path), id: path.split('/').pop(), ref: db.doc(path) }, params }) as never
const actualizado = (path: string, antes: Doc | undefined, params: Record<string, string>) => ({
  data: { before: { data: () => antes }, after: { data: () => db.docs.get(path), ref: db.doc(path) } }, params,
}) as never

const ts = (iso: string) => Timestamp.fromDate(new Date(iso))
const outbox = (id: string) => db.docs.get(`tango-outbox/${id}`)
const idsOutbox = () => [...db.docs.keys()].filter((k) => k.startsWith('tango-outbox/')).map((k) => k.slice('tango-outbox/'.length)).sort()

const cliente = {
  tangoIds: {
    redonhielo: [{ idGva14: 100, codigo: 'FC.280' }, { idGva14: 101, codigo: 'FC.281' }],
    rolito: [{ idGva14: 900, codigo: 'FC.280' }],
  },
}

describe('codigoDescarga y numerarDescarga (2026-09-18: el número lo pone el server)', () => {
  it('DC-<planta>-<6 dígitos>; una planta desconocida cae a DT', () => {
    expect(codigoDescarga('torcuato', 12)).toBe('DC-DT-000012')
    expect(codigoDescarga('merlo', 7)).toBe('DC-ML-000007')
    expect(codigoDescarga('otra', 1)).toBe('DC-DT-000001')
  })

  it('el primer conteo de la planta es el 1 y el contador queda listo para el siguiente', async () => {
    db.docs.set('descargasCamion/d1', { plantaId: 'torcuato' })
    expect(await numerarDescarga('d1', 'torcuato')).toEqual({ numero: 1, codigo: 'DC-DT-000001' })
    expect(db.docs.get('config/descargaCounter_torcuato')).toEqual({ next: 2 })
    expect(db.docs.get('descargasCamion/d1')).toMatchObject({ numero: 1, codigo: 'DC-DT-000001' })
    db.docs.set('descargasCamion/d2', {})
    expect(await numerarDescarga('d2', 'torcuato')).toEqual({ numero: 2, codigo: 'DC-DT-000002' })
  })

  it('es idempotente: una descarga ya numerada devuelve su código sin gastar otro número', async () => {
    db.docs.set('descargasCamion/d1', { numero: 5, codigo: 'DC-DT-000005' })
    db.docs.set('config/descargaCounter_torcuato', { next: 6 })
    expect(await numerarDescarga('d1', 'torcuato')).toEqual({ numero: 5, codigo: 'DC-DT-000005' })
    expect(db.docs.get('config/descargaCounter_torcuato')).toEqual({ next: 6 })
  })

  it('sin el doc de la descarga no numera nada', async () => {
    expect(await numerarDescarga('nada', 'torcuato')).toBeNull()
    expect(db.docs.has('config/descargaCounter_torcuato')).toBe(false)
  })
})

describe('onProduccionPalletCreado', () => {
  it('encola el pallet con id determinístico, estado pendiente y 0 intentos', async () => {
    db.docs.set('produccionPallets/p1', { plantaId: 'torcuato', bolsas: 120 })
    await onProduccionPalletCreado.run(creado('produccionPallets/p1', { palletId: 'p1' }))
    expect(outbox('produccionPallets_p1')).toMatchObject({
      entidad: 'produccionPallet', origenColeccion: 'produccionPallets', origenId: 'p1', estado: 'pendiente', intentos: 0, ultimoError: null,
      payload: { plantaId: 'torcuato', bolsas: 120 },
    })
  })

  it('un reintento del trigger no duplica el item ni falla (ALREADY_EXISTS se ignora)', async () => {
    db.docs.set('produccionPallets/p1', { bolsas: 1 })
    db.docs.set('tango-outbox/produccionPallets_p1', { estado: 'confirmado', intentos: 1 })
    await expect(onProduccionPalletCreado.run(creado('produccionPallets/p1', { palletId: 'p1' }))).resolves.toBeUndefined()
    expect(outbox('produccionPallets_p1')).toEqual({ estado: 'confirmado', intentos: 1 })
  })
})

describe('onVentaCamionCreada: qué comprobante, en qué empresa y con qué identidad del cliente', () => {
  beforeEach(() => { db.docs.set('users/cli1', cliente) })

  it('cuenta corriente → remito de Redonhielo, sin la firma y con la SUCURSAL elegida en la venta', async () => {
    db.docs.set('ventasCamion/v1', {
      canal: 'contado', formaPago: 'cuenta_corriente', total: 1000, clienteId: 'cli1', clienteCodigoTango: 'FC.281',
      firmaCliente: 'data:image/png;base64,....', items: [{ productoId: 'b3', cantidad: 10 }],
    })
    await onVentaCamionCreada.run(creado('ventasCamion/v1', { ventaId: 'v1' }))
    expect(idsOutbox()).toEqual(['ventasCamion_v1'])
    const item = outbox('ventasCamion_v1') as Doc
    expect(item).toMatchObject({ entidad: 'remito', empresa: 'redonhielo', origenColeccion: 'ventasCamion', origenId: 'v1', estado: 'pendiente' })
    expect(item.payload).toMatchObject({ clienteIdGva14Tango: 101, clienteCodigoTango: 'FC.281' })
    expect(item.payload).not.toHaveProperty('firmaCliente')
  })

  it('sin sucursal elegida usa el código principal de la empresa', async () => {
    db.docs.set('ventasCamion/v1', { canal: 'contado', formaPago: 'cuenta_corriente', total: 1000, clienteId: 'cli1' })
    await onVentaCamionCreada.run(creado('ventasCamion/v1', { ventaId: 'v1' }))
    expect((outbox('ventasCamion_v1') as Doc).payload).toMatchObject({ clienteIdGva14Tango: 100, clienteCodigoTango: 'FC.280' })
  })

  it('contado cobrado NO se encola al crearse: la factura viaja recién con el CAE', async () => {
    db.docs.set('ventasCamion/v1', { canal: 'contado', formaPago: 'contado_efectivo', total: 1000, clienteId: 'cli1' })
    await onVentaCamionCreada.run(creado('ventasCamion/v1', { ventaId: 'v1' }))
    expect(idsOutbox()).toEqual([])
  })

  it('promo → factura X en Rolito con el ID_GVA14 de Rolito, más el egreso de stock en Redonhielo', async () => {
    db.docs.set('ventasCamion/v2', { canal: 'promo', formaPago: 'contado_efectivo', total: 500, clienteId: 'cli1', clienteCodigoTango: 'FC.280' })
    await onVentaCamionCreada.run(creado('ventasCamion/v2', { ventaId: 'v2' }))
    expect(idsOutbox()).toEqual(['ventasCamion_v2', 'ventasCamion_v2_stock'])
    expect(outbox('ventasCamion_v2')).toMatchObject({ entidad: 'factura', empresa: 'rolito', payload: { clienteIdGva14Tango: 900, clienteCodigoTango: 'FC.280' } })
    expect(outbox('ventasCamion_v2_stock')).toMatchObject({
      entidad: 'movimientoStock', empresa: 'redonhielo', origenId: 'v2',
      payload: { movimiento: 'ventaPromo', venta: { clienteIdGva14Tango: 100 } },
    })
  })

  it('un cliente sin vínculo en la empresa destino viaja con lo que trajo la venta (el writer lo reporta)', async () => {
    db.docs.set('ventasCamion/v3', { canal: 'promo', total: 100, clienteId: 'sin-ficha', clienteCodigoTango: 'XX.1' })
    await onVentaCamionCreada.run(creado('ventasCamion/v3', { ventaId: 'v3' }))
    expect((outbox('ventasCamion_v3') as Doc).payload).toMatchObject({ clienteCodigoTango: 'XX.1' })
    expect((outbox('ventasCamion_v3') as Doc).payload).not.toHaveProperty('clienteIdGva14Tango')
  })

  it('con datos que no reconoce no encola nada (mejor no mandar que mandar a la empresa equivocada)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.docs.set('ventasCamion/v4', { canal: 'raro', formaPago: 'contado_efectivo', total: 10 })
    await onVentaCamionCreada.run(creado('ventasCamion/v4', { ventaId: 'v4' }))
    expect(idsOutbox()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no se encola'))
    warn.mockRestore()
  })
})

describe('onVentaVentanillaCreada: el cambio del mostrador va planta → 99 (fase B)', () => {
  it('ventanilla con cambios encola la transferencia con el número del comprobante interno', async () => {
    db.docs.set('ventasVentanilla/w1', {
      canal: 'contado', formaPago: 'cuenta_corriente', total: 300, plantaId: 'torcuato', cajaNombre: 'Nico',
      clienteCodigoTango: 'FC.280', clienteNombre: 'ACME', fecha: 'F',
      comprobanteInterno: { tipo: 'remito', puntoVenta: 1105, numero: 700 },
      cambios: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 2 }],
    })
    await onVentaVentanillaCreada.run(creado('ventasVentanilla/w1', { ventaId: 'w1' }))
    expect(idsOutbox()).toEqual(['ventasVentanilla_w1', 'ventasVentanilla_w1_cambio'])
    expect(outbox('ventasVentanilla_w1_cambio')).toMatchObject({
      entidad: 'transferenciaDeposito', empresa: 'redonhielo', origenColeccion: 'ventasVentanilla',
      payload: { sentido: 'cambioVentanilla', codigo: 'remito 1105-700', plantaId: 'torcuato', cajaNombre: 'Nico', items: [{ productoId: 'b3', cantidad: 2 }] },
    })
  })

  it('sin cambios (o en cero) no hay transferencia; en el camión el cambio no mueve stock', async () => {
    db.docs.set('ventasVentanilla/w2', { canal: 'contado', formaPago: 'cuenta_corriente', total: 300, cambios: [{ productoId: 'b3', cantidad: 0 }] })
    await onVentaVentanillaCreada.run(creado('ventasVentanilla/w2', { ventaId: 'w2' }))
    db.docs.set('ventasCamion/v5', { canal: 'contado', formaPago: 'cuenta_corriente', total: 300, cambios: [{ productoId: 'b3', cantidad: 3 }] })
    await onVentaCamionCreada.run(creado('ventasCamion/v5', { ventaId: 'v5' }))
    expect(idsOutbox()).toEqual(['ventasCamion_v5', 'ventasVentanilla_w2'])
  })
})

describe('onVenta*Facturada: la factura de Redonhielo viaja con el CAE, una sola vez', () => {
  const contado = { canal: 'contado', formaPago: 'contado_efectivo', total: 1210, clienteId: 'cli1' }

  it('al pasar a emitida encola la factura con conCaePropio y el mismo id que usaría el alta', async () => {
    db.docs.set('users/cli1', cliente)
    db.docs.set('ventasCamion/v1', { ...contado, factura: { estado: 'emitida', cae: '123' } })
    await onVentaCamionFacturada.run(actualizado('ventasCamion/v1', { ...contado, factura: { estado: 'pendiente' } }, { ventaId: 'v1' }))
    expect(outbox('ventasCamion_v1')).toMatchObject({ entidad: 'factura', empresa: 'redonhielo', conCaePropio: true, payload: { clienteIdGva14Tango: 100 } })
    db.docs.set('ventasVentanilla/w1', { ...contado, factura: { estado: 'emitida' } })
    await onVentaVentanillaFacturada.run(actualizado('ventasVentanilla/w1', { ...contado }, { ventaId: 'w1' }))
    expect(outbox('ventasVentanilla_w1')).toMatchObject({ entidad: 'factura', conCaePropio: true, origenColeccion: 'ventasVentanilla' })
  })

  it('cualquier otra escritura sobre la venta (ya emitida, incierta, rechazada) no encola', async () => {
    db.docs.set('ventasCamion/v1', { ...contado, factura: { estado: 'emitida' }, nota: 'editada' })
    await onVentaCamionFacturada.run(actualizado('ventasCamion/v1', { ...contado, factura: { estado: 'emitida' } }, { ventaId: 'v1' }))
    db.docs.set('ventasCamion/v2', { ...contado, factura: { estado: 'incierta' } })
    await onVentaCamionFacturada.run(actualizado('ventasCamion/v2', { ...contado }, { ventaId: 'v2' }))
    expect(idsOutbox()).toEqual([])
  })

  it('una venta que no lleva CAE (cta. cte. / promo) no se encola por acá aunque le aparezca una factura', async () => {
    db.docs.set('ventasCamion/v1', { canal: 'promo', total: 100, factura: { estado: 'emitida' } })
    await onVentaCamionFacturada.run(actualizado('ventasCamion/v1', { canal: 'promo', total: 100 }, { ventaId: 'v1' }))
    expect(idsOutbox()).toEqual([])
  })
})

describe('onAnulacionEmitida: la nota de crédito viaja al Facturador', () => {
  const nc = { estado: 'emitida', cae: '999', cbteTipo: 3, puntoVenta: 1104, numero: 7 }
  const solicitud = (extra: Doc) => ({ estado: 'emitida', motivo: 'cliente_equivocado', nota: 'era otro', solicitadoPor: { nombre: 'Nico' }, resueltaPor: { nombre: 'Fac' }, ...extra })

  it('NC de ARCA sobre una factura de contado: item notaCredito con CAE propio en Redonhielo y la solicitud queda tango.pendiente', async () => {
    db.docs.set('users/cli1', cliente)
    db.docs.set('ventasVentanilla/w1', { canal: 'contado', formaPago: 'contado_efectivo', total: 1210, clienteId: 'cli1' })
    db.docs.set('anulacionesVentanilla/w1', solicitud({ notaCredito: nc }))
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/w1', { estado: 'aprobada' }, { ventaId: 'w1' }))
    expect(outbox('anulacionesVentanilla_w1')).toMatchObject({
      entidad: 'notaCredito', empresa: 'redonhielo', conCaePropio: true, origenColeccion: 'anulacionesVentanilla', origenId: 'w1',
      payload: { clienteIdGva14Tango: 100, notaCredito: nc, anulacion: { motivo: 'cliente_equivocado', nota: 'era otro', solicitadoPor: 'Nico', resueltaPor: 'Fac' } },
    })
    expect(db.docs.get('anulacionesVentanilla/w1')).toMatchObject({ tango: { estado: 'pendiente' } })
  })

  it('NC X interna sobre una promo del camión: va a Rolito sin CAE, leyendo la venta de la colección que dice la solicitud', async () => {
    db.docs.set('users/cli1', cliente)
    db.docs.set('ventasCamion/v1', { canal: 'promo', formaPago: 'contado_efectivo', total: 500, clienteId: 'cli1' })
    const nci = { tipo: 'notaCreditoX', puntoVenta: 1104, numero: 1, fecha: '2026-09-11' }
    db.docs.set('anulacionesVentanilla/v1', solicitud({ coleccion: 'ventasCamion', notaCreditoInterna: nci }))
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/v1', { estado: 'aprobada' }, { ventaId: 'v1' }))
    expect(outbox('anulacionesVentanilla_v1')).toMatchObject({ empresa: 'rolito', conCaePropio: false, payload: { clienteIdGva14Tango: 900, notaCreditoInterna: nci } })
    expect((outbox('anulacionesVentanilla_v1') as Doc).payload).not.toHaveProperty('notaCredito')
  })

  it('no encola si la solicitud no pasó a emitida, si la NC no tiene CAE, o si la venta no era factura', async () => {
    db.docs.set('ventasVentanilla/w1', { canal: 'contado', formaPago: 'contado_efectivo', total: 100 })
    db.docs.set('anulacionesVentanilla/w1', solicitud({ notaCredito: nc }))
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/w1', { estado: 'emitida' }, { ventaId: 'w1' }))   // ya estaba emitida
    db.docs.set('anulacionesVentanilla/w2', solicitud({ notaCredito: { ...nc, cae: null } }))
    db.docs.set('ventasVentanilla/w2', { canal: 'contado', formaPago: 'contado_efectivo', total: 100 })
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/w2', { estado: 'aprobada' }, { ventaId: 'w2' }))
    db.docs.set('anulacionesVentanilla/w3', solicitud({ notaCredito: nc }))
    db.docs.set('ventasVentanilla/w3', { canal: 'contado', formaPago: 'cuenta_corriente', total: 100 })   // remito, no factura
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/w3', { estado: 'aprobada' }, { ventaId: 'w3' }))
    // NC de ARCA sobre una promo (incoherente): tampoco.
    db.docs.set('anulacionesVentanilla/w4', solicitud({ notaCredito: nc }))
    db.docs.set('ventasVentanilla/w4', { canal: 'promo', total: 100 })
    await onAnulacionEmitida.run(actualizado('anulacionesVentanilla/w4', { estado: 'aprobada' }, { ventaId: 'w4' }))
    expect(idsOutbox()).toEqual([])
  })
})

describe('remito de carga: índice del camión en la calle + transferencia planta → camión', () => {
  const remito = {
    codigo: 'RC-DT-000010', numero: 10, plantaId: 'torcuato', depositoTango: '03', camionId: 'cam1', camionLabel: 'AB123CD',
    choferId: 'ch1', choferNombre: 'Pedro', items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 100 }], fecha: ts('2026-09-20T08:00:00-03:00'), creadoPor: { uid: 'caja' },
  }

  it('al crearse indexa camionesEnViaje y encola la carga con envases y pallets (null si no vienen)', async () => {
    db.docs.set('remitosCarga/r1', remito)
    await onRemitoCargaCreado.run(creado('remitosCarga/r1', { remitoId: 'r1' }))
    expect(db.docs.get('camionesEnViaje/cam1')).toMatchObject({ remitoId: 'r1', remitoCodigo: 'RC-DT-000010', plantaId: 'torcuato', choferNombre: 'Pedro', volvio: false })
    expect(outbox('remitosCarga_r1')).toMatchObject({
      entidad: 'transferenciaDeposito', empresa: 'redonhielo', origenColeccion: 'remitosCarga',
      payload: { sentido: 'carga', codigo: 'RC-DT-000010', depositoTango: '03', camionId: 'cam1', palletsCarga: null, envases: null, items: remito.items },
    })
  })

  it('el regreso marca volvio SOLO si el índice apunta a este viaje, y solo la primera vez', async () => {
    db.docs.set('camionesEnViaje/cam1', { remitoId: 'r2', volvio: false })
    db.docs.set('remitosCarga/r1', { ...remito, regreso: { uid: 'seg', hora: 'H' } })
    await onRemitoCargaRegreso.run(actualizado('remitosCarga/r1', remito, { remitoId: 'r1' }))
    expect(db.docs.get('camionesEnViaje/cam1')).toMatchObject({ volvio: false })   // apunta a un viaje más nuevo: no se toca

    db.docs.set('camionesEnViaje/cam1', { remitoId: 'r1', volvio: false })
    await onRemitoCargaRegreso.run(actualizado('remitosCarga/r1', remito, { remitoId: 'r1' }))
    expect(db.docs.get('camionesEnViaje/cam1')).toMatchObject({ volvio: true })

    db.docs.set('camionesEnViaje/cam1', { remitoId: 'r1', volvio: false })
    await onRemitoCargaRegreso.run(actualizado('remitosCarga/r1', { ...remito, regreso: { uid: 'x' } }, { remitoId: 'r1' }))   // regreso ya estaba
    expect(db.docs.get('camionesEnViaje/cam1')).toMatchObject({ volvio: false })
  })
})

describe('onDescargaCamionCreada', () => {
  const descargaBase = {
    plantaId: 'torcuato', depositoTango: '03', camionId: 'cam1', camionLabel: 'AB123CD', choferId: 'ch1', choferNombre: 'Pedro',
    fecha: ts('2026-09-20T18:22:00-03:00'), registradoPor: { uid: 'm1', nombre: 'Muelle' },
    items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 5 }], bolsasRotas: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 2 }],
  }

  it('sin remito: numera, completa diaReparto con el día ARGENTINO del conteo y encola la descarga (sin merma si el tipo no está en config)', async () => {
    db.docs.set('descargasCamion/d1', { ...descargaBase, fecha: ts('2026-09-20T23:30:00-03:00') })   // 02:30 UTC del 21
    await onDescargaCamionCreada.run(creado('descargasCamion/d1', { descargaId: 'd1' }))
    expect(db.docs.get('descargasCamion/d1')).toMatchObject({ numero: 1, codigo: 'DC-DT-000001', diaReparto: '2026-09-20' })
    expect(idsOutbox()).toEqual(['descargasCamion_d1'])
    expect(outbox('descargasCamion_d1')).toMatchObject({
      entidad: 'transferenciaDeposito', empresa: 'redonhielo',
      payload: { sentido: 'descarga', items: descargaBase.items, bolsasRotas: descargaBase.bolsasRotas, palletsCompletos: null, envases: null },
    })
  })

  it('con el tipo merma configurado, las rotas van camión → 99 en un item aparte con el código de la descarga', async () => {
    db.docs.set('config/tango', { sql: { stock: { tipos: { merma: { depositoDestino: '99' } } } } })
    db.docs.set('descargasCamion/d1', { ...descargaBase, diaReparto: '2026-09-20' })
    await onDescargaCamionCreada.run(creado('descargasCamion/d1', { descargaId: 'd1' }))
    expect(idsOutbox()).toEqual(['descargasCamion_d1', 'descargasCamion_d1_merma'])
    expect(outbox('descargasCamion_d1_merma')).toMatchObject({ payload: { sentido: 'merma', codigo: 'DC-DT-000001', items: descargaBase.bolsasRotas } })
  })

  it('la descarga teórica no cuenta rotas; una sin rotas tampoco genera merma', async () => {
    db.docs.set('config/tango', { sql: { stock: { tipos: { merma: {} } } } })
    db.docs.set('descargasCamion/d1', { ...descargaBase, diaReparto: '2026-09-20', teorica: true })
    db.docs.set('descargasCamion/d2', { ...descargaBase, diaReparto: '2026-09-20', bolsasRotas: [] })
    await onDescargaCamionCreada.run(creado('descargasCamion/d1', { descargaId: 'd1' }))
    await onDescargaCamionCreada.run(creado('descargasCamion/d2', { descargaId: 'd2' }))
    expect(idsOutbox()).toEqual(['descargasCamion_d1', 'descargasCamion_d2'])
  })

  it('una rectificación NO se encola a Tango (duplicaría el stock), pero sí se numera', async () => {
    db.docs.set('descargasCamion/d9', { ...descargaBase, diaReparto: '2026-09-20', rectificaA: 'd1', motivoRectificacion: 'se tipeó 6 en vez de 60' })
    await onDescargaCamionCreada.run(creado('descargasCamion/d9', { descargaId: 'd9' }))
    expect(db.docs.get('descargasCamion/d9')).toMatchObject({ codigo: 'DC-DT-000001' })
    expect(idsOutbox()).toEqual([])
  })

  it('con remito: el diaReparto es el del VIAJE, escribe el cierre de mercadería, cierra el índice del camión y encola la diferencia al 98', async () => {
    const remito = { camionId: 'cam1', choferId: 'ch1', choferNombre: 'Pedro', codigo: 'RC-DT-000010', plantaId: 'torcuato', depositoTango: '03', fecha: ts('2026-09-19T23:30:00-03:00'), items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 100 }] }
    db.docs.set('remitosCarga/r1', remito)
    db.docs.set('camionesEnViaje/cam1', { remitoId: 'r1' })
    db.docs.set('ventasCamion/v1', { choferId: 'ch1', camionId: 'cam1', remitoId: 'r1', canal: 'contado', fecha: ts('2026-09-19T10:00:00-03:00'), items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 90 }] })
    // Venta sin remitoId del mismo chofer y día: se ubica por camión + día (compat) y no se cuenta dos veces.
    db.docs.set('ventasCamion/v2', { choferId: 'ch1', camionId: 'cam1', canal: 'promo', fecha: ts('2026-09-19T12:00:00-03:00'), items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 1 }] })
    // Venta anulada: no descuenta.
    db.docs.set('ventasCamion/v3', { choferId: 'ch1', camionId: 'cam1', remitoId: 'r1', canal: 'contado', fecha: ts('2026-09-19T13:00:00-03:00'), items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 50 }], anulacion: { estado: 'anulada' } })
    db.docs.set('descargasCamion/d1', { ...descargaBase, remitoId: 'r1', remitoCodigo: 'RC-DT-000010' })
    await onDescargaCamionCreada.run(creado('descargasCamion/d1', { descargaId: 'd1' }))

    expect(db.docs.get('descargasCamion/d1')).toMatchObject({ diaReparto: '2026-09-19', codigo: 'DC-DT-000001' })
    const cierre = db.docs.get('cierresMercaderia/r1') as Doc
    expect(cierre).toMatchObject({ remitoId: 'r1', remitoCodigo: 'RC-DT-000010', choferId: 'ch1', diaReparto: '2026-09-19', descargaIds: ['d1'], descargaCodigos: ['DC-DT-000001'], contadaPor: { uid: 'm1', nombre: 'Muelle' } })
    expect(cierre.productos).toEqual([expect.objectContaining({ productoId: 'b3', carga: 100, ventaContado: 90, ventaPromo: 1, descarga: 5, rotas: 2 })])
    expect(db.docs.has('camionesEnViaje/cam1')).toBe(false)
    expect(idsOutbox()).toEqual(['cierresMercaderia_r1_diferencia', 'descargasCamion_d1'])
    // faltante = 100 − 90 − 1 − 2 rotas − 5 sanas = 2
    expect(outbox('cierresMercaderia_r1_diferencia')).toMatchObject({
      entidad: 'transferenciaDeposito', origenColeccion: 'cierresMercaderia', origenId: 'r1',
      payload: { sentido: 'diferencia', codigo: 'RC-DT-000010', depositoTango: '03', items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 2 }], cerradaPor: { uid: 'm1', nombre: 'Muelle' } },
    })
  })

  it('si el índice ya apunta a un viaje más nuevo, contar el viejo no lo borra; sin faltante no hay diferencia', async () => {
    db.docs.set('remitosCarga/r1', { camionId: 'cam1', choferId: 'ch1', plantaId: 'torcuato', fecha: ts('2026-09-19T08:00:00-03:00'), items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 10 }] })
    db.docs.set('camionesEnViaje/cam1', { remitoId: 'r2' })
    db.docs.set('descargasCamion/d1', { ...descargaBase, remitoId: 'r1', items: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 8 }], bolsasRotas: [{ productoId: 'b3', nombre: 'Bolsa 3', cantidad: 2 }] })
    await onDescargaCamionCreada.run(creado('descargasCamion/d1', { descargaId: 'd1' }))
    expect(db.docs.get('camionesEnViaje/cam1')).toEqual({ remitoId: 'r2' })
    expect(db.docs.has('cierresMercaderia/r1')).toBe(true)
    expect(idsOutbox()).toEqual(['descargasCamion_d1'])
  })
})

describe('onCobranzaCreada: el recibo a Tango y el descuento optimista del saldo', () => {
  const saldo = {
    codigoTango: 'FC.281', saldoTotal: 100,
    comprobantes: [{ tipo: 'FAC', numero: 'A0001', fechaEmision: '2026-09-01', importeOriginal: 100, saldoPendiente: 100, empresa: 'redonhielo', codigoTango: 'FC.281' }],
    porEmpresa: { redonhielo: { saldoTotal: 100, comprobantes: 1, runId: 'r1', origen: 'sync' } }, cobranzasAplicadas: [],
  }
  const recibo = {
    clienteId: 'cli1', clienteNombre: 'ACME', empresa: 'redonhielo', codigoTango: 'FC.281', numeroRecibo: 'RS-000001', importe: 100, aCuenta: 0,
    imputaciones: [{ comprobanteTipo: 'FAC', comprobanteNumero: 'A0001', importeImputado: 100, saldoAlMomento: 100 }],
    medios: { efectivo: 100 }, fecha: ts('2026-09-20T10:00:00-03:00'), registradoPor: { uid: 'sup', nombre: 'Matías' }, origen: 'supervisor',
  }
  beforeEach(() => { db.docs.set('users/cli1', cliente); db.docs.set('saldosTango/cli1', saldo) })

  it('encola el recibo con la identidad del CÓDIGO de la cobranza en su empresa y la referencia idempotente, y descuenta la factura del cache', async () => {
    db.docs.set('cobranzas/c1', recibo)
    await onCobranzaCreada.run(creado('cobranzas/c1', { cobranzaId: 'c1' }))
    expect(outbox('cobranzas_c1')).toMatchObject({
      entidad: 'recibo', empresa: 'redonhielo', origenColeccion: 'cobranzas', origenId: 'c1',
      payload: { numeroRecibo: 'RS-000001', clienteIdGva14Tango: 101, clienteCodigoTango: 'FC.281', importe: 100, aCuenta: 0, origen: 'supervisor', plantaId: null, referenciaIdempotente: 'ROLITO:c1' },
    })
    const s = db.docs.get('saldosTango/cli1') as Doc
    expect(s.comprobantes).toEqual([])
    expect(s.saldoTotal).toBe(0)
    expect(s.cobranzasAplicadas).toEqual(['c1'])
  })

  it('sin código en la cobranza cae al principal de la empresa; en Rolito usa los ids de Rolito', async () => {
    db.docs.set('cobranzas/c2', { ...recibo, codigoTango: undefined })
    await onCobranzaCreada.run(creado('cobranzas/c2', { cobranzaId: 'c2' }))
    expect((outbox('cobranzas_c2') as Doc).payload).toMatchObject({ clienteIdGva14Tango: 100, clienteCodigoTango: 'FC.280' })
    db.docs.set('cobranzas/c3', { ...recibo, empresa: 'rolito', codigoTango: undefined })
    await onCobranzaCreada.run(creado('cobranzas/c3', { cobranzaId: 'c3' }))
    expect(outbox('cobranzas_c3')).toMatchObject({ empresa: 'rolito', payload: { empresa: 'rolito', clienteIdGva14Tango: 900 } })
  })

  it('una cobranza sin imputaciones ni a cuenta no viaja; un reintento no descuenta dos veces', async () => {
    db.docs.set('cobranzas/c4', { ...recibo, imputaciones: [], aCuenta: 0 })
    await onCobranzaCreada.run(creado('cobranzas/c4', { cobranzaId: 'c4' }))
    expect(idsOutbox()).toEqual([])
    db.docs.set('cobranzas/c1', recibo)
    await onCobranzaCreada.run(creado('cobranzas/c1', { cobranzaId: 'c1' }))
    await onCobranzaCreada.run(creado('cobranzas/c1', { cobranzaId: 'c1' }))
    expect((db.docs.get('saldosTango/cli1') as Doc).cobranzasAplicadas).toEqual(['c1'])
    expect(db.escrituras.filter((e) => e.path === 'saldosTango/cli1')).toHaveLength(1)
  })

  it('un recibo que no cuadra (valores ≠ importe) NO va a Tango ni toca el saldo (auditoría 2026-09-22)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.docs.set('cobranzas/c5', { ...recibo, medios: { efectivo: 50 } })
    await onCobranzaCreada.run(creado('cobranzas/c5', { cobranzaId: 'c5' }))
    expect(idsOutbox()).toEqual([])
    expect(db.docs.get('saldosTango/cli1')).toEqual(saldo)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no cuadra'))
    error.mockRestore()
  })

  it('a cuenta puro (sin factura imputada) viaja igual y deja el recibo como saldo negativo', async () => {
    db.docs.set('cobranzas/c6', { ...recibo, imputaciones: [], aCuenta: 100 })
    await onCobranzaCreada.run(creado('cobranzas/c6', { cobranzaId: 'c6' }))
    expect(outbox('cobranzas_c6')).toMatchObject({ payload: { aCuenta: 100, imputaciones: [] } })
    const s = db.docs.get('saldosTango/cli1') as Doc
    expect(s.comprobantes).toEqual([expect.objectContaining({ tipo: 'FAC', saldoPendiente: 100 }), expect.objectContaining({ tipo: 'REC', numero: 'RS-000001', saldoPendiente: -100 })])
    expect(s.saldoTotal).toBe(0)
  })

  it('sin doc de saldo en cache no hay nada que corregir (la cola sí se escribe)', async () => {
    db.docs.delete('saldosTango/cli1')
    db.docs.set('cobranzas/c7', recibo)
    await onCobranzaCreada.run(creado('cobranzas/c7', { cobranzaId: 'c7' }))
    expect(idsOutbox()).toEqual(['cobranzas_c7'])
    expect(db.docs.has('saldosTango/cli1')).toBe(false)
  })
})

describe('onOutboxConfirmado: el write-back al doc de origen', () => {
  const confirmar = async (id: string, item: Doc, antes: Doc = { estado: 'pendiente' }) => {
    db.docs.set(`tango-outbox/${id}`, { estado: 'confirmado', ...item })
    await onOutboxConfirmado.run(actualizado(`tango-outbox/${id}`, antes, { docId: id }))
  }

  it('remito y factura: el número de Tango va a `tango` sin tocar `factura` (que es la identidad de ARCA)', async () => {
    db.docs.set('ventasCamion/v1', { factura: { cae: '1' }, tango: { estado: 'pendiente' } })
    await confirmar('a', { entidad: 'remito', origenColeccion: 'ventasCamion', origenId: 'v1', resultado: { remitoNumero: 'R0110500000700' } })
    expect(db.docs.get('ventasCamion/v1')).toEqual({ factura: { cae: '1' }, tango: { estado: 'confirmado', remitoNumero: 'R0110500000700' } })
    db.docs.set('ventasVentanilla/w1', { tango: { estado: 'pendiente' } })
    await confirmar('b', { entidad: 'factura', origenColeccion: 'ventasVentanilla', origenId: 'w1', resultado: { comprobanteNumero: 'A0110400000001' } })
    expect(db.docs.get('ventasVentanilla/w1')).toEqual({ tango: { estado: 'confirmado', facturaNumero: 'A0110400000001' } })
  })

  it('una venta promo recibe DOS confirmaciones y la segunda no pisa la primera (dot-paths)', async () => {
    db.docs.set('ventasCamion/v2', { tango: { estado: 'pendiente' } })
    await confirmar('c', { entidad: 'factura', origenColeccion: 'ventasCamion', origenId: 'v2', resultado: { facturaNumero: 'B0000300000009' } })
    await confirmar('d', { entidad: 'movimientoStock', origenColeccion: 'ventasCamion', origenId: 'v2', resultado: { stockNumero: 15, tComp: 'VPR' } })
    expect(db.docs.get('ventasCamion/v2')).toEqual({ tango: { estado: 'confirmado', facturaNumero: 'B0000300000009', stockEstado: 'confirmado', stockNumero: '15', stockTipo: 'VPR' } })
  })

  it('transferenciaDeposito: cada sentido tiene su campo para no pisar el número de la DES del mismo doc', async () => {
    db.docs.set('descargasCamion/d1', { tango: {} })
    await confirmar('e', { entidad: 'transferenciaDeposito', origenColeccion: 'descargasCamion', origenId: 'd1', resultado: { transferenciaNumero: 'DES0001' }, payload: { sentido: 'descarga' } })
    await confirmar('f', { entidad: 'transferenciaDeposito', origenColeccion: 'descargasCamion', origenId: 'd1', resultado: { savedId: 44 }, payload: { sentido: 'merma' } })
    expect(db.docs.get('descargasCamion/d1')).toEqual({ tango: { estado: 'confirmado', transferenciaNumero: 'DES0001', mermaEstado: 'confirmado', mermaNumero: '44' } })
    db.docs.set('liquidaciones/l1', {})
    await confirmar('g', { entidad: 'transferenciaDeposito', origenColeccion: 'liquidaciones', origenId: 'l1', resultado: { comprobanteNumero: 'DIF0002' }, payload: { sentido: 'diferencia' } })
    expect(db.docs.get('liquidaciones/l1')).toEqual({ tango: { estado: 'confirmado', diferenciaNumero: 'DIF0002' } })
    // Desde el viaje en dos partes (18/09) la diferencia nace en el cierre de
    // mercadería: el write-back tiene que llegar a esa colección (bug del 22/09).
    db.docs.set('cierresMercaderia/r1', {})
    await confirmar('g2', { entidad: 'transferenciaDeposito', origenColeccion: 'cierresMercaderia', origenId: 'r1', resultado: { comprobanteNumero: 'DIF0003' }, payload: { sentido: 'diferencia' } })
    expect(db.docs.get('cierresMercaderia/r1')).toEqual({ tango: { estado: 'confirmado', diferenciaNumero: 'DIF0003' } })
    db.docs.set('ventasVentanilla/w1', {})
    await confirmar('h', { entidad: 'transferenciaDeposito', origenColeccion: 'ventasVentanilla', origenId: 'w1', resultado: { transferenciaNumero: 'CAM0003' }, payload: { sentido: 'cambioVentanilla' } })
    expect(db.docs.get('ventasVentanilla/w1')).toEqual({ tango: { cambioEstado: 'confirmado', cambioNumero: 'CAM0003' } })
  })

  it('nota de crédito y recibo: confirmado limpia el último error; agotados los reintentos, el doc queda en error con el motivo recortado', async () => {
    db.docs.set('anulacionesVentanilla/w1', { tango: { estado: 'pendiente', ultimoError: 'antes' } })
    await confirmar('i', { entidad: 'notaCredito', origenColeccion: 'anulacionesVentanilla', origenId: 'w1', resultado: { notaCreditoNumero: 'A0110400000003' } })
    expect(db.docs.get('anulacionesVentanilla/w1')).toEqual({ tango: { estado: 'confirmado', numero: 'A0110400000003' } })
    db.docs.set('cobranzas/c1', { tango: { estado: 'pendiente' } })
    db.docs.set('tango-outbox/j', { entidad: 'recibo', origenColeccion: 'cobranzas', origenId: 'c1', estado: 'error', ultimoError: 'x'.repeat(600) })
    await onOutboxConfirmado.run(actualizado('tango-outbox/j', { estado: 'pendiente' }, { docId: 'j' }))
    expect(db.docs.get('cobranzas/c1')).toEqual({ tango: { estado: 'error', ultimoError: 'x'.repeat(500) } })
  })

  it('anulación del remito: anulado / ya_anulado confirman; facturado o inexistente vuelven a la oficina, igual que un error de verdad', async () => {
    for (const [r, esperado] of [['anulado', 'confirmado'], ['ya_anulado', 'confirmado'], ['facturado', 'pendiente_oficina'], ['inexistente', 'pendiente_oficina']]) {
      db.docs.set('ventasCamion/v1', { anulacion: { tipo: 'remito', tango: { estado: 'encolado' } } })
      await confirmar(`k-${r}`, { entidad: 'anulacionRemito', origenColeccion: 'ventasCamion', origenId: 'v1', resultado: { resultado: r } })
      expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { tipo: 'remito', tango: { estado: esperado, resultado: r } } })
    }
    db.docs.set('ventasCamion/v1', { anulacion: { tango: { estado: 'encolado' } } })
    db.docs.set('tango-outbox/l', { entidad: 'anulacionRemito', origenColeccion: 'ventasCamion', origenId: 'v1', estado: 'error', ultimoError: 'la base no responde' })
    await onOutboxConfirmado.run(actualizado('tango-outbox/l', { estado: 'pendiente' }, { docId: 'l' }))
    expect(db.docs.get('ventasCamion/v1')).toEqual({ anulacion: { tango: { estado: 'pendiente_oficina', ultimoError: 'la base no responde' } } })
  })

  it('no escribe nada si el estado no cambió, si la entidad no tiene write-back, si la colección no corresponde, si falta el número, o si el error no tiene destino', async () => {
    db.docs.set('ventasCamion/v1', { tango: { estado: 'pendiente' } })
    await confirmar('m', { entidad: 'remito', origenColeccion: 'ventasCamion', origenId: 'v1', resultado: { remitoNumero: 'R1' } }, { estado: 'confirmado' })
    await confirmar('n', { entidad: 'produccionPallet', origenColeccion: 'produccionPallets', origenId: 'v1', resultado: { savedId: 1 } })
    await confirmar('o', { entidad: 'recibo', origenColeccion: 'ventasCamion', origenId: 'v1', resultado: { reciboNumero: 'X' } })
    await confirmar('p', { entidad: 'remito', origenColeccion: 'ventasCamion', origenId: 'v1', resultado: {} })
    db.docs.set('tango-outbox/q', { entidad: 'remito', origenColeccion: 'ventasCamion', origenId: 'v1', estado: 'error', ultimoError: 'x' })
    await onOutboxConfirmado.run(actualizado('tango-outbox/q', { estado: 'pendiente' }, { docId: 'q' }))
    expect(db.docs.get('ventasCamion/v1')).toEqual({ tango: { estado: 'pendiente' } })
  })
})

describe('FieldValue en el doble', () => {
  it('el doble aplica arrayUnion y delete como Firestore (lo que sostiene los tests de arriba)', () => {
    expect(fusionar({ a: [1], b: 2 }, { a: FieldValue.arrayUnion(1, 3), b: FieldValue.delete() })).toEqual({ a: [1, 3] })
  })
})
