import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Anulación de un recibo con autorización (2026-09-15): los tres triggers
 * sobre `anulacionesCobranza/{id}`. Firestore es un doble en memoria; la push
 * y la reconciliación contra Tango son dobles que solo registran a quién se
 * llamó y con qué.
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
  const ref = (path: string) => ({
    path,
    get: async () => snap(path),
    set: async (data: Doc, opts?: { merge?: boolean }) => { docs.set(path, opts?.merge ? fusionar(docs.get(path) ?? {}, data) : { ...data }) },
    update: async (data: Doc) => { if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`); docs.set(path, { ...docs.get(path)!, ...data }) },
  })
  const consulta = (col: string, filtros: [string, string, unknown][]) => ({
    where: (f: string, op: string, v: unknown) => consulta(col, [...filtros, [f, op, v]]),
    get: async () => {
      const lista = [...docs.entries()]
        .filter(([p]) => p.startsWith(`${col}/`))
        .filter(([, d]) => filtros.every(([f, op, v]) => (op === 'in' ? (v as unknown[]).includes(d[f]) : d[f] === v)))
        .map(([p]) => snap(p))
      return { docs: lista }
    },
  })
  return { docs, doc: (path: string) => ref(path), collection: (col: string) => consulta(col, []) }
}

const dobles = vi.hoisted(() => ({
  db: undefined as unknown,
  push: vi.fn(async () => ({ enviados: 1 })),
  reconciliar: vi.fn(async () => ({ pendientes: 2, confirmados: 1 })),
}))
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('firebase-admin/firestore')>()
  return { ...orig, getFirestore: () => dobles.db }
})
vi.mock('../services/push', () => ({ enviarPushAUsuarios: (...args: unknown[]) => dobles.push(...(args as [])) }))
vi.mock('../services/anuladosEnTango', () => ({ confirmarRecibosAnulados: (...args: unknown[]) => dobles.reconciliar(...(args as [])) }))

process.env.VAPID_PUBLIC_KEY = 'pub'
process.env.VAPID_PRIVATE_KEY = 'priv'

import { FieldValue } from 'firebase-admin/firestore'
import { onAnulacionReciboResuelta, onAnulacionReciboSolicitada, reconciliarRecibosAnulados } from './anulacionesCobranza'

let db: ReturnType<typeof firestoreFalso>
beforeEach(() => {
  db = firestoreFalso(); dobles.db = db; dobles.push.mockClear(); dobles.reconciliar.mockClear()
  db.docs.set('users/aut1', { rol: 'logistica', autorizaAnulaciones: true, estado: 'activo' })
  db.docs.set('users/aut2', { rol: 'logistica', autorizaAnulaciones: true, estado: 'inactivo' })
  db.docs.set('users/fac1', { rol: 'facturacion', estado: 'activo' })
  db.docs.set('users/sa', { rol: 'super_admin', estado: 'activo' })
  db.docs.set('users/log', { rol: 'logistica', estado: 'activo' })
  db.docs.set('users/sup', { rol: 'supervisor', estado: 'activo' })
  db.docs.set('cobranzas/c1', { importe: 200000, clienteNombre: 'COMBUSTIBLES' })
})

type Push = { docs: { id: string }[]; aviso: { titulo: string; cuerpo: string; url?: string } }
const pushes = (): Push[] => dobles.push.mock.calls.map((c) => { const [docs, aviso] = c as unknown as [Push['docs'], Push['aviso']]; return { docs, aviso } })

const solicitud = {
  estado: 'pendiente', origen: 'supervisor', numeroRecibo: 'RS-000168', reciboTango: 'X0110600000168', clienteNombre: 'COMBUSTIBLES',
  importe: 200000, motivo: 'cheque_equivocado', nota: 'el número era otro', solicitadoPor: { uid: 'sup', nombre: 'Matías' }, fechaCobranza: '2026-09-15',
}
const creado = (path: string, params: Record<string, string>) => ({ data: { data: () => db.docs.get(path) }, params }) as never
const actualizado = (path: string, antes: Doc, params: Record<string, string>) => ({ data: { before: { data: () => antes }, after: { data: () => db.docs.get(path), ref: db.doc(path) } }, params }) as never

describe('onAnulacionReciboSolicitada', () => {
  it('marca la cobranza como pendiente (sin pisar el resto) y avisa SOLO a los autorizantes activos', async () => {
    db.docs.set('anulacionesCobranza/c1', solicitud)
    await onAnulacionReciboSolicitada.run(creado('anulacionesCobranza/c1', { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).toEqual({ importe: 200000, clienteNombre: 'COMBUSTIBLES', anulacion: { estado: 'pendiente', solicitudId: 'c1' } })
    expect(pushes()).toHaveLength(1)
    expect(pushes()[0]!.docs.map((d) => d.id)).toEqual(['aut1'])
    expect(pushes()[0]!.aviso).toMatchObject({ titulo: 'Anulación de recibo por autorizar', url: '/anulaciones' })
    expect(pushes()[0]!.aviso.cuerpo).toContain('RS-000168')
    expect(pushes()[0]!.aviso.cuerpo).toContain('pidió Matías')
  })

  it('una solicitud que no nace pendiente no toca nada', async () => {
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada' })
    await onAnulacionReciboSolicitada.run(creado('anulacionesCobranza/c1', { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).not.toHaveProperty('anulacion')
    expect(dobles.push).not.toHaveBeenCalled()
  })

  it('si la push falla, la marca en la cobranza ya quedó', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    dobles.push.mockRejectedValueOnce(new Error('vapid roto'))
    db.docs.set('anulacionesCobranza/c1', solicitud)
    await expect(onAnulacionReciboSolicitada.run(creado('anulacionesCobranza/c1', { cobranzaId: 'c1' }))).resolves.toBeUndefined()
    expect(db.docs.get('cobranzas/c1')).toMatchObject({ anulacion: { estado: 'pendiente' } })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('vapid roto'))
    error.mockRestore()
  })
})

describe('onAnulacionReciboResuelta', () => {
  it('aprobada con recibo en Tango: la cobranza queda anulada (mapa entero), la solicitud pendiente_oficina, push al cobrador con "hacer el correcto" y push a facturación/super_admin', async () => {
    db.docs.set('cobranzas/c1', { importe: 200000, anulacion: { estado: 'pendiente', solicitudId: 'c1', basura: 'x' } })
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada', resueltaPor: { uid: 'aut1', nombre: 'Facturación' } })
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', solicitud, { cobranzaId: 'c1' }))

    expect(db.docs.get('cobranzas/c1')).toEqual({
      importe: 200000,
      anulacion: {
        estado: 'anulada', solicitudId: 'c1', motivo: 'cheque_equivocado', nota: 'el número era otro', anuladaPor: { uid: 'aut1', nombre: 'Facturación' },
        anuladaEn: FieldValue.serverTimestamp(), fechaCobranza: '2026-09-15', tango: { estado: 'pendiente_oficina' },
      },
    })
    expect(db.docs.get('anulacionesCobranza/c1')).toMatchObject({ estado: 'aprobada', tango: { estado: 'pendiente_oficina' } })
    expect(pushes()).toHaveLength(2)
    expect(pushes()[0]!.docs.map((d) => d.id)).toEqual(['sup'])
    expect(pushes()[0]!.aviso).toMatchObject({ titulo: 'Recibo anulado', url: '/supervisor/cobrar?reemitir=c1' })
    expect(pushes()[0]!.aviso.cuerpo).toContain('datos del cheque equivocados')
    expect(pushes()[1]!.docs.map((d) => d.id).sort()).toEqual(['fac1', 'sa'])
    expect(pushes()[1]!.aviso).toMatchObject({ titulo: 'Anular un recibo en Tango', url: '/admin/comprobantes' })
    expect(pushes()[1]!.aviso.cuerpo).toContain('X0110600000168')
  })

  it('aprobada sin recibo en Tango: tango no_aplica y no se molesta a facturación; error → aprobada también anula', async () => {
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada', reciboTango: '', origen: 'caja', resueltaPor: { uid: 'aut1', nombre: 'F' } })
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', { ...solicitud, estado: 'error' }, { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).toMatchObject({ anulacion: { estado: 'anulada', tango: { estado: 'no_aplica' } } })
    expect(db.docs.get('anulacionesCobranza/c1')).toMatchObject({ tango: { estado: 'no_aplica' } })
    expect(pushes()).toHaveLength(1)
    expect(pushes()[0]!.aviso.url).toBe('/caja/cobranzas?reemitir=c1')
  })

  it('rechazada: la cobranza sigue vigente (marca rechazada) y el cobrador recibe el motivo en su pantalla', async () => {
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, origen: 'cobrador', estado: 'rechazada', resueltaPor: { uid: 'aut1', nombre: 'Facturación' }, notaResolucion: 'el cheque estaba bien' })
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', solicitud, { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).toMatchObject({ importe: 200000, anulacion: { estado: 'rechazada', solicitudId: 'c1' } })
    expect(pushes()).toHaveLength(1)
    expect(pushes()[0]!.aviso).toMatchObject({ titulo: 'Anulación de recibo rechazada', url: '/chofer/cobrar' })
    expect(pushes()[0]!.aviso.cuerpo).toBe('Facturación no aprobó anular el recibo RS-000168: el cheque estaba bien. El recibo sigue vigente.')
  })

  it('volver a pedir (rechazada → pendiente) marca pendiente y avisa de nuevo a los autorizantes', async () => {
    db.docs.set('anulacionesCobranza/c1', solicitud)
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', { ...solicitud, estado: 'rechazada' }, { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).toMatchObject({ anulacion: { estado: 'pendiente', solicitudId: 'c1' } })
    expect(pushes()[0]!.docs.map((d) => d.id)).toEqual(['aut1'])
  })

  it('las escrituras del propio server (aprobada → aprobada con tango) no disparan nada', async () => {
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada', tango: { estado: 'pendiente_oficina' } })
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada' }, { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).not.toHaveProperty('anulacion')
    expect(dobles.push).not.toHaveBeenCalled()
  })

  it('un cobrador sin ficha de usuario no recibe push y no rompe el circuito', async () => {
    db.docs.set('anulacionesCobranza/c1', { ...solicitud, estado: 'aprobada', reciboTango: '', solicitadoPor: { uid: 'fantasma', nombre: 'X' }, resueltaPor: { uid: 'aut1', nombre: 'F' } })
    await onAnulacionReciboResuelta.run(actualizado('anulacionesCobranza/c1', solicitud, { cobranzaId: 'c1' }))
    expect(db.docs.get('cobranzas/c1')).toMatchObject({ anulacion: { estado: 'anulada' } })
    expect(dobles.push).not.toHaveBeenCalled()
  })
})

describe('reconciliarRecibosAnulados', () => {
  it('cada hora corre la pasada compartida con el botón "Ya lo anulé en Tango"', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await reconciliarRecibosAnulados.run({} as never)
    expect(dobles.reconciliar).toHaveBeenCalledWith(db)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pendientes en Tango: 2, confirmados ahora: 1'))
    log.mockRestore()
  })
})
