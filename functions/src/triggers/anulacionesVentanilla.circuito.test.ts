import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Los dos triggers de la anulación de facturas (`anulacionesVentanilla/{id}`):
 * qué escriben en la venta, a quién avisan y con qué URL, y qué pasa cuando
 * la emisión de la NC falla antes de ARCA. La emisión en sí (ARCA) es un doble;
 * el resto del servicio (transición, rechazo, error previo) es el real sobre
 * un Firestore en memoria.
 */

type Doc = Record<string, unknown>
const esMapa = (v: unknown): v is Doc => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
const fusionar = (base: Doc, cambios: Doc): Doc => {
  const out: Doc = { ...base }
  for (const [k, v] of Object.entries(cambios)) out[k] = esMapa(v) && esMapa(out[k]) ? fusionar(out[k] as Doc, v) : v
  return out
}

function firestoreFalso() {
  const docs = new Map<string, Doc>()
  const snap = (path: string) => ({ id: path.split('/').pop()!, exists: docs.has(path), data: () => docs.get(path), ref: ref(path) })
  const setSync = (path: string, data: Doc, opts?: { merge?: boolean }) => { docs.set(path, opts?.merge ? fusionar(docs.get(path) ?? {}, data) : { ...data }) }
  const ref = (path: string) => ({ path, get: async () => snap(path), set: async (data: Doc, opts?: { merge?: boolean }) => setSync(path, data, opts) })
  const consulta = (col: string, filtros: [string, unknown][]) => ({
    where: (f: string, _op: string, v: unknown) => consulta(col, [...filtros, [f, v]]),
    get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.startsWith(`${col}/`) && filtros.every(([f, v]) => d[f] === v)).map(([p]) => snap(p)) }),
  })
  return {
    docs,
    doc: (path: string) => ref(path),
    collection: (col: string) => consulta(col, []),
    batch: () => {
      const ops: (() => void)[] = []
      const b = { set: (r: { path: string }, data: Doc, opts?: { merge?: boolean }) => { ops.push(() => setSync(r.path, data, opts)); return b }, commit: async () => { ops.forEach((f) => f()) } }
      return b
    },
  }
}

const dobles = vi.hoisted(() => ({ db: undefined as unknown, push: vi.fn(async () => ({ enviados: 1 })), emitir: vi.fn() }))
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('firebase-admin/firestore')>()
  return { ...orig, getFirestore: () => dobles.db }
})
vi.mock('../services/push', () => ({ enviarPushAUsuarios: (...args: unknown[]) => dobles.push(...(args as [])) }))
vi.mock('../services/arca/anulacionVentanilla', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/arca/anulacionVentanilla')>()
  return { ...orig, emitirNotaCreditoDeAnulacion: (...args: unknown[]) => dobles.emitir(...(args as [])) }
})
process.env.VAPID_PUBLIC_KEY = 'pub'
process.env.VAPID_PRIVATE_KEY = 'priv'

import { onAnulacionResuelta, onAnulacionSolicitada } from './anulacionesVentanilla'

let db: ReturnType<typeof firestoreFalso>
beforeEach(() => {
  db = firestoreFalso(); dobles.db = db; dobles.push.mockClear(); dobles.emitir.mockReset()
  db.docs.set('users/aut1', { autorizaAnulaciones: true, estado: 'activo' })
  db.docs.set('users/aut2', { autorizaAnulaciones: true, estado: 'inactivo' })
  db.docs.set('users/caja1', { rol: 'caja', estado: 'activo' })
  db.docs.set('users/chof1', { rol: 'chofer', estado: 'activo' })
  db.docs.set('users/fac1', { rol: 'facturacion', estado: 'activo' })
  db.docs.set('ventasVentanilla/w1', { clienteNombre: 'ACME S.A.', total: 12300 })
  db.docs.set('ventasCamion/v1', { clienteNombre: 'ACME S.A.', total: 5000, choferNombre: 'Pedro' })
})

type Push = { ids: string[]; aviso: { titulo: string; cuerpo: string; url?: string } }
const pushes = (): Push[] => dobles.push.mock.calls.map((c) => { const [docs, aviso] = c as unknown as [{ id: string }[], Push['aviso']]; return { ids: docs.map((d) => d.id), aviso } })

const base = { estado: 'pendiente', motivo: 'Cliente equivocado', nota: 'era la sucursal 2', solicitadoPor: { uid: 'caja1', nombre: 'Nico' } }
const creado = (path: string, params: Record<string, string>) => ({ data: { data: () => db.docs.get(path) }, params }) as never
const actualizado = (path: string, antes: Doc, params: Record<string, string>) => ({ data: { before: { data: () => antes }, after: { data: () => db.docs.get(path), ref: db.doc(path) } }, params }) as never

describe('onAnulacionSolicitada', () => {
  it('ventanilla: marca la venta pendiente y avisa a los autorizantes activos con cliente y total', async () => {
    db.docs.set('anulacionesVentanilla/w1', base)
    await onAnulacionSolicitada.run(creado('anulacionesVentanilla/w1', { ventaId: 'w1' }))
    expect(db.docs.get('ventasVentanilla/w1')).toEqual({ clienteNombre: 'ACME S.A.', total: 12300, anulacion: { estado: 'pendiente', solicitudId: 'w1' } })
    expect(pushes()).toEqual([{ ids: ['aut1'], aviso: { titulo: 'Anulación de factura por autorizar', cuerpo: expect.stringContaining('ACME S.A. · $12.300,00'), url: '/anulaciones' } }])
  })

  it('camión: escribe en ventasCamion y el aviso nombra al chofer', async () => {
    db.docs.set('anulacionesVentanilla/v1', { ...base, coleccion: 'ventasCamion', choferId: 'chof1' })
    await onAnulacionSolicitada.run(creado('anulacionesVentanilla/v1', { ventaId: 'v1' }))
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { estado: 'pendiente', solicitudId: 'v1' } })
    expect(db.docs.get('ventasVentanilla/v1')).toBeUndefined()
    expect(pushes()[0]!.aviso.titulo).toBe('Anulación de factura del camión por autorizar')
    expect(pushes()[0]!.aviso.cuerpo).toContain('chofer Pedro')
  })

  it('una solicitud creada en otro estado no hace nada', async () => {
    db.docs.set('anulacionesVentanilla/w1', { ...base, estado: 'aprobada' })
    await onAnulacionSolicitada.run(creado('anulacionesVentanilla/w1', { ventaId: 'w1' }))
    expect(db.docs.get('ventasVentanilla/w1')).not.toHaveProperty('anulacion')
    expect(dobles.push).not.toHaveBeenCalled()
  })
})

describe('onAnulacionResuelta', () => {
  it('rechazada en el camión: la venta vuelve a contar y avisa al cajero (a su liquidación) y al chofer (a Mis ventas)', async () => {
    db.docs.set('anulacionesVentanilla/v1', { ...base, coleccion: 'ventasCamion', choferId: 'chof1', estado: 'rechazada', resueltaPor: { uid: 'aut1', nombre: 'Gerencia' }, notaResolucion: 'la factura está bien' })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/v1', base, { ventaId: 'v1' }))
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { estado: 'rechazada', solicitudId: 'v1' } })
    expect(pushes().map((p) => [p.ids, p.aviso.url])).toEqual([[['caja1'], '/caja/liquidaciones'], [['chof1'], '/chofer/ventas']])
    expect(pushes()[0]!.aviso.cuerpo).toBe('Gerencia no aprobó la anulación: la factura está bien. La factura sigue vigente.')
    expect(dobles.emitir).not.toHaveBeenCalled()
  })

  it('si el chofer es el que pidió, no recibe la push dos veces; si la pidió facturación, vuelve a la ficha del cliente', async () => {
    db.docs.set('anulacionesVentanilla/v1', { ...base, coleccion: 'ventasCamion', choferId: 'chof1', solicitadoPor: { uid: 'chof1', nombre: 'Pedro' }, estado: 'rechazada' })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/v1', base, { ventaId: 'v1' }))
    expect(pushes().map((p) => p.ids)).toEqual([['chof1']])
    dobles.push.mockClear()
    db.docs.set('anulacionesVentanilla/w1', { ...base, origen: 'facturacion', clienteId: 'cli9', solicitadoPor: { uid: 'fac1', nombre: 'Fac' }, estado: 'rechazada' })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', base, { ventaId: 'w1' }))
    expect(pushes()[0]!.aviso.url).toBe('/admin/comprobantes?cliente=cli9')
  })

  it('aprobada: la venta pasa a aprobada ANTES de ir a ARCA y, con la NC emitida, avisa el número y qué hacer', async () => {
    db.docs.set('anulacionesVentanilla/w1', { ...base, estado: 'aprobada' })
    dobles.emitir.mockImplementation(async () => {
      expect(db.docs.get('ventasVentanilla/w1')).toMatchObject({ anulacion: { estado: 'aprobada', solicitudId: 'w1' } })
      return { estado: 'emitida', puntoVenta: 1104, numero: 7 }
    })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', base, { ventaId: 'w1' }))
    expect(dobles.emitir).toHaveBeenCalledWith(db, 'w1')
    expect(pushes()).toEqual([{ ids: ['caja1'], aviso: { titulo: 'Factura anulada', cuerpo: 'Salió la nota de crédito 01104-00000007. Ya podés hacer la factura correcta.', url: '/caja/ventanilla' } }])
  })

  it('en el camión el aviso habla de la liquidación y también le llega al chofer', async () => {
    db.docs.set('anulacionesVentanilla/v1', { ...base, coleccion: 'ventasCamion', choferId: 'chof1', estado: 'aprobada' })
    dobles.emitir.mockResolvedValue({ estado: 'emitida', puntoVenta: 1104, numero: 8 })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/v1', { ...base, estado: 'error' }, { ventaId: 'v1' }))   // error → aprobada reintenta
    expect(pushes().map((p) => p.ids)).toEqual([['caja1'], ['chof1']])
    expect(pushes()[1]!.aviso.cuerpo).toContain('ya no cuenta en la liquidación')
  })

  it('si la emisión no aplica (null) o quedó incierta, no se avisa nada', async () => {
    db.docs.set('anulacionesVentanilla/w1', { ...base, estado: 'aprobada' })
    dobles.emitir.mockResolvedValueOnce(null)
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', base, { ventaId: 'w1' }))
    dobles.emitir.mockResolvedValueOnce({ estado: 'incierta', puntoVenta: 1104, numero: 9 })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', base, { ventaId: 'w1' }))
    expect(dobles.push).not.toHaveBeenCalled()
  })

  it('si la emisión revienta antes de reservar número, deja el registro pendiente para la reconciliación y el motivo en la solicitud, sin relanzar', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.docs.set('anulacionesVentanilla/v1', { ...base, coleccion: 'ventasCamion', estado: 'aprobada' })
    dobles.emitir.mockRejectedValue(new Error('La factura de la venta v1 no tiene importes guardados'))
    await expect(onAnulacionResuelta.run(actualizado('anulacionesVentanilla/v1', base, { ventaId: 'v1' }))).resolves.toBeUndefined()
    expect(db.docs.get('facturasArca/nc_v1')).toMatchObject({ estado: 'pendiente', coleccion: 'ventasCamion', motivo: expect.stringContaining('no tiene importes') })
    expect(db.docs.get('anulacionesVentanilla/v1')).toMatchObject({ estado: 'aprobada', ultimoError: expect.stringContaining('no tiene importes') })
    expect(db.docs.get('ventasCamion/v1')).toMatchObject({ anulacion: { estado: 'aprobada' } })
    expect(dobles.push).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('volver a pedir después de un rechazo: pendiente otra vez y push a los autorizantes', async () => {
    db.docs.set('anulacionesVentanilla/w1', base)
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', { ...base, estado: 'rechazada' }, { ventaId: 'w1' }))
    expect(db.docs.get('ventasVentanilla/w1')).toMatchObject({ anulacion: { estado: 'pendiente', solicitudId: 'w1' } })
    expect(pushes().map((p) => [p.ids, p.aviso.url])).toEqual([[['aut1'], '/anulaciones']])
  })

  it('las escrituras del server (aprobada → emitida) no disparan nada', async () => {
    db.docs.set('anulacionesVentanilla/w1', { ...base, estado: 'emitida' })
    await onAnulacionResuelta.run(actualizado('anulacionesVentanilla/w1', { ...base, estado: 'aprobada' }, { ventaId: 'w1' }))
    expect(dobles.emitir).not.toHaveBeenCalled()
    expect(dobles.push).not.toHaveBeenCalled()
  })
})
