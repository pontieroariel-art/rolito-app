import { describe, it, expect, vi } from 'vitest'
import { emitirComprobante, resolverIncierto } from './emision'
import type { PuertoArca } from './emision'
import { ArcaError } from './wsfev1'
import { rutaContador } from './numeracion'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'

function dbFalsa(inicial: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(inicial))
  let cola: Promise<unknown> = Promise.resolve()
  const db: DbLike & { docs: typeof docs } = {
    docs,
    doc: (p: string) => p,
    runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
      const ejecutar = async (): Promise<T> => {
        const tx: TransactionLike = {
          async get(ref): Promise<SnapshotLike> {
            const data = docs.get(ref as string)
            return { exists: data !== undefined, data: () => data }
          },
          set(ref, data, options) {
            const key = ref as string
            const previo = options?.merge ? (docs.get(key) ?? {}) : {}
            docs.set(key, { ...previo, ...data })
          },
        }
        return fn(tx)
      }
      const r = cola.then(ejecutar, ejecutar)
      cola = r.catch(() => undefined)
      return r
    },
  }
  return db
}

const PTO_VTA = 1104
const FACTURA_A = 1
const RUTA = rutaContador({ ptoVta: PTO_VTA, cbteTipo: FACTURA_A })

const datos = {
  receptor: { razonSocial: 'ACME S.A.', cuit: '30697668973', categoriaIvaTango: 'RI' },
  items: [{ descripcion: 'Hielo bolsa 3kg', cantidad: 10, precioUnitario: 1000 }],
  fechaVenta: new Date('2026-09-10T12:00:00-03:00'),
  numeroComprobante: 0,   // lo asigna la emisión
}
const calculo = { preciosIncluyenIva: false }
const ahora = new Date('2026-09-10T18:00:00-03:00')

function puerto(overrides: Partial<PuertoArca> = {}): PuertoArca {
  return {
    solicitarCae: vi.fn(async () => ({
      resultado: 'A' as const,
      cae: '75123456789012',
      caeFchVto: '20260920',
      cbteDesde: 1,
      observaciones: [],
    })),
    consultarComprobante: vi.fn(async () => ({ existe: false })),
    ...overrides,
  }
}

describe('emitirComprobante — camino feliz', () => {
  it('reserva el número, pide el CAE y lo devuelve', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto()

    const r = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(r.estado).toBe('emitido')
    if (r.estado === 'emitido') {
      expect(r.numero).toBe(101)
      expect(r.cae).toBe('75123456789012')
      expect(r.cbteTipo).toBe(FACTURA_A)
    }
    // El número que viajó a ARCA es el reservado, no el provisorio.
    const detalle = (arca.solicitarCae as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(detalle.CbteDesde).toBe(101)
    expect(detalle.CbteHasta).toBe(101)
  })

  it('numera consecutivo entre ventas sucesivas', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 0, librados: [] } })
    const arca = puerto()
    const a = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })
    const b = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })
    expect([a.numero, b.numero]).toEqual([1, 2])
  })
})

describe('emitirComprobante — validaciones previas (no queman número)', () => {
  it('no emite ni consume número si el cliente no es facturable', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto()

    await expect(
      emitirComprobante({
        db, arca, ptoVta: PTO_VTA, calculo, ahora,
        datos: { ...datos, receptor: { ...datos.receptor, categoriaIvaTango: '' } },
      }),
    ).rejects.toThrow(/no facturable/)

    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
    expect(arca.solicitarCae).not.toHaveBeenCalled()
  })

  it('no emite si la venta quedó fuera de la ventana de 5 días', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto()

    await expect(
      emitirComprobante({
        db, arca, ptoVta: PTO_VTA, datos, calculo,
        ahora: new Date('2026-09-20T12:00:00-03:00'),
      }),
    ).rejects.toThrow(/solo admite 5/)

    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
  })
})

describe('emitirComprobante — rechazo de ARCA', () => {
  it('libera el número si ARCA rechaza y confirma que no existe', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({
      solicitarCae: vi.fn(async () => { throw new ArcaError('ARCA rechazó: [10016] no correlativo') }),
      consultarComprobante: vi.fn(async () => ({ existe: false })),
    })

    const r = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(r.estado).toBe('rechazado')
    if (r.estado === 'rechazado') expect(r.numeroLiberado).toBe(true)
    // Liberado el 101 (era el último), el contador vuelve atrás y se reutiliza.
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
  })

  it('si ARCA dijo rechazo pero el comprobante SÍ existe, gana la consulta', async () => {
    // El caso paranoico: respuesta mal interpretada o perdida. Si el comprobante
    // está autorizado, liberar el número generaría un duplicado más adelante.
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({
      solicitarCae: vi.fn(async () => { throw new ArcaError('rechazado') }),
      consultarComprobante: vi.fn(async () => ({
        existe: true, cae: '75999999999999', caeFchVto: '20260920',
      })),
    })

    const r = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(r.estado).toBe('emitido')
    if (r.estado === 'emitido') expect(r.cae).toBe('75999999999999')
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 101 })   // NO se liberó
  })

  it('ante rechazo que no se puede confirmar, prefiere el hueco al duplicado', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({
      solicitarCae: vi.fn(async () => { throw new ArcaError('rechazado') }),
      consultarComprobante: vi.fn(async () => { throw new Error('sin red') }),
    })

    const r = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(r.estado).toBe('rechazado')
    if (r.estado === 'rechazado') expect(r.numeroLiberado).toBe(false)
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 101 })
  })
})

describe('emitirComprobante — corte de red (el caso peligroso)', () => {
  it('un timeout deja el comprobante INCIERTO y el número consumido', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({
      solicitarCae: vi.fn(async () => { throw new Error('ETIMEDOUT') }),
    })

    const r = await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(r.estado).toBe('incierto')
    expect(r.numero).toBe(101)
    // Clave: NO se libera. ARCA pudo haberlo autorizado.
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 101 })
    expect(db.docs.get(RUTA)!.librados).toEqual([])
  })

  it('no consulta ni reintenta solo: eso lo hace la reconciliación', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({ solicitarCae: vi.fn(async () => { throw new Error('socket hang up') }) })

    await emitirComprobante({ db, arca, ptoVta: PTO_VTA, datos, calculo, ahora })

    expect(arca.solicitarCae).toHaveBeenCalledTimes(1)
    expect(arca.consultarComprobante).not.toHaveBeenCalled()
  })
})

describe('onNumeroReservado (rastro previo a la llamada)', () => {
  it('avisa el número antes de hablar con ARCA', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const orden: string[] = []
    const arca = puerto({
      solicitarCae: vi.fn(async () => {
        orden.push('arca')
        return { resultado: 'A' as const, cae: 'X', caeFchVto: null, cbteDesde: 101, observaciones: [] }
      }),
    })

    await emitirComprobante({
      db, arca, ptoVta: PTO_VTA, datos, calculo, ahora,
      onNumeroReservado: async (n) => { orden.push(`reservado:${n}`) },
    })

    expect(orden).toEqual(['reservado:101', 'arca'])
  })

  it('si no se puede dejar el rastro, no llama a ARCA y devuelve el número', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto()

    await expect(
      emitirComprobante({
        db, arca, ptoVta: PTO_VTA, datos, calculo, ahora,
        onNumeroReservado: async () => { throw new Error('Firestore caído') },
      }),
    ).rejects.toThrow(/se abortó sin llamar a ARCA/)

    expect(arca.solicitarCae).not.toHaveBeenCalled()
    // El número volvió al pozo: no se quemó.
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
  })
})

describe('resolverIncierto', () => {
  it('recupera el CAE si el comprobante había quedado autorizado', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto({
      consultarComprobante: vi.fn(async () => ({
        existe: true, cae: '75123456789012', caeFchVto: '20260920',
      })),
    })

    const r = await resolverIncierto(db, arca, PTO_VTA, FACTURA_A, 101)

    expect(r.estado).toBe('emitido')
    if (r.estado === 'emitido') expect(r.cae).toBe('75123456789012')
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 101 })
  })

  it('libera el número si ARCA confirma que nunca se autorizó', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto({ consultarComprobante: vi.fn(async () => ({ existe: false })) })

    const r = await resolverIncierto(db, arca, PTO_VTA, FACTURA_A, 101)

    expect(r.estado).toBe('rechazado')
    if (r.estado === 'rechazado') expect(r.numeroLiberado).toBe(true)
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
  })

  it('propaga el error si ARCA sigue sin responder (se reintenta después)', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto({ consultarComprobante: vi.fn(async () => { throw new Error('sin red') }) })

    await expect(resolverIncierto(db, arca, PTO_VTA, FACTURA_A, 101)).rejects.toThrow(/sin red/)
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 101 })   // intacto
  })
})
