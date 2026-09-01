import { describe, it, expect, vi } from 'vitest'
import { facturarVenta, rutaFactura } from './facturacionVenta'
import type { FacturaGuardada, RegistroFactura } from './facturacionVenta'
import type { PuertoArca } from './emision'
import { ArcaError } from './wsfev1'
import { rutaContador } from './numeracion'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'
import type { ConfigArca } from './configuracion'

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

const config: ConfigArca = {
  ambiente: 'homologacion',
  cuit: '30697668973',
  puntoVenta: 1104,
  preciosIncluyenIva: false,
  tributoIdPercepcionIIBB: 7,
  habilitado: true,
}

const FACTURA_A = 1
const RUTA_CONTADOR = rutaContador({ ptoVta: config.puntoVenta, cbteTipo: FACTURA_A })

const datos = {
  receptor: { razonSocial: 'ACME S.A.', cuit: '30697668973', categoriaIvaTango: 'RI' },
  items: [{ descripcion: 'Hielo bolsa 3kg', cantidad: 10, precioUnitario: 1000 }],
  fechaVenta: new Date('2026-09-10T12:00:00-03:00'),
}
const ahora = new Date('2026-09-10T18:00:00-03:00')

function puerto(overrides: Partial<PuertoArca> = {}): PuertoArca {
  return {
    solicitarCae: vi.fn(async () => ({
      resultado: 'A' as const, cae: '75123456789012', caeFchVto: '20260920',
      cbteDesde: 1, observaciones: [],
    })),
    consultarComprobante: vi.fn(async () => ({ existe: false })),
    ...overrides,
  }
}

/** Almacenamiento en memoria para el registro de la factura. */
function almacen(inicial?: FacturaGuardada) {
  let actual = inicial
  const escrituras: RegistroFactura[] = []
  return {
    escrituras,
    get actual() { return actual },
    leer: async () => actual,
    guardar: async (r: RegistroFactura) => {
      escrituras.push(r)
      actual = r as unknown as FacturaGuardada
    },
  }
}

describe('rutaFactura', () => {
  it('usa el id de la venta, así no puede haber dos facturas para una venta', () => {
    expect(rutaFactura('venta-abc')).toBe('facturasArca/venta-abc')
  })
})

describe('facturarVenta — camino feliz', () => {
  it('emite y guarda el CAE', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 100, librados: [] } })
    const store = almacen()

    const r = await facturarVenta({
      db, arca: puerto(), config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(r.estado).toBe('emitida')
    expect(r.numero).toBe(101)
    expect(r.cae).toBe('75123456789012')
  })

  it('deja constancia del número ANTES del CAE (dos escrituras)', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 100, librados: [] } })
    const store = almacen()

    await facturarVenta({
      db, arca: puerto(), config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(store.escrituras).toHaveLength(2)
    expect(store.escrituras[0]).toMatchObject({ estado: 'incierta', numero: 101 })
    expect(store.escrituras[1]).toMatchObject({ estado: 'emitida', numero: 101 })
  })

  it('aplica la percepción de IIBB cuando el cliente la tiene', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 0, librados: [] } })
    const arca = puerto()
    const store = almacen()

    await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      percepcionIIBB: {
        alicuota: 3,
        tributoId: config.tributoIdPercepcionIIBB,
        vigenciaDesde: new Date('2026-09-01T00:00:00-03:00'),
        vigenciaHasta: new Date('2026-09-30T00:00:00-03:00'),
      },
      leer: store.leer, guardar: store.guardar,
    })

    const detalle = (arca.solicitarCae as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(detalle.ImpTrib).toBe(300)
    expect(detalle.ImpTotal).toBe(12400)
  })
})

describe('facturarVenta — idempotencia (el trigger puede llegar dos veces)', () => {
  it('una venta ya facturada no se vuelve a emitir', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto()
    const store = almacen({
      estado: 'emitida', numero: 101, cbteTipo: FACTURA_A,
      cae: '75123456789012', caeFchVto: '20260920',
    })

    const r = await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(r.estado).toBe('emitida')
    expect(r.cae).toBe('75123456789012')
    expect(arca.solicitarCae).not.toHaveBeenCalled()
    expect(arca.consultarComprobante).not.toHaveBeenCalled()
    expect(store.escrituras).toHaveLength(0)   // ni siquiera reescribe
  })

  it('llamarla dos veces seguidas emite UNA sola factura', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 0, librados: [] } })
    const arca = puerto()
    const store = almacen()
    const comun = { db, arca, config, ventaId: 'v1', datos, ahora, leer: store.leer, guardar: store.guardar }

    const primera = await facturarVenta(comun)
    const segunda = await facturarVenta(comun)

    expect(primera.numero).toBe(1)
    expect(segunda.numero).toBe(1)
    expect(arca.solicitarCae).toHaveBeenCalledTimes(1)
  })

  it('con un número reservado sin resolver, pregunta a ARCA en vez de re-emitir', async () => {
    // Simula el corte: quedó la primera escritura (incierta con número) y el
    // trigger volvió a disparar.
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto({
      consultarComprobante: vi.fn(async () => ({
        existe: true, cae: '75999999999999', caeFchVto: '20260920',
      })),
    })
    const store = almacen({ estado: 'incierta', numero: 101, cbteTipo: FACTURA_A })

    const r = await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(arca.solicitarCae).not.toHaveBeenCalled()
    expect(arca.consultarComprobante).toHaveBeenCalledWith(1104, FACTURA_A, 101)
    expect(r.estado).toBe('emitida')
    expect(r.cae).toBe('75999999999999')
  })

  it('si ARCA confirma que ese número no se emitió, lo libera y queda rechazada', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 101, librados: [] } })
    const arca = puerto({ consultarComprobante: vi.fn(async () => ({ existe: false })) })
    const store = almacen({ estado: 'incierta', numero: 101, cbteTipo: FACTURA_A })

    const r = await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(r.estado).toBe('rechazada')
    expect(db.docs.get(RUTA_CONTADOR)).toMatchObject({ ultimoAsignado: 100 })
  })
})

describe('facturarVenta — fallas', () => {
  it('un corte de red deja la factura incierta, con el número registrado', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({ solicitarCae: vi.fn(async () => { throw new Error('ETIMEDOUT') }) })
    const store = almacen()

    const r = await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(r.estado).toBe('incierta')
    expect(r.numero).toBe(101)
    expect(store.actual).toMatchObject({ estado: 'incierta', numero: 101 })
  })

  it('un rechazo de ARCA queda registrado con su motivo', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto({
      solicitarCae: vi.fn(async () => { throw new ArcaError('[10016] no correlativo') }),
    })
    const store = almacen()

    const r = await facturarVenta({
      db, arca, config, ventaId: 'v1', datos, ahora,
      leer: store.leer, guardar: store.guardar,
    })

    expect(r.estado).toBe('rechazada')
    expect(r.motivo).toMatch(/no correlativo/)
  })

  it('un cliente no facturable ni siquiera llega a ARCA', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR]: { ultimoAsignado: 100, librados: [] } })
    const arca = puerto()
    const store = almacen()

    await expect(
      facturarVenta({
        db, arca, config, ventaId: 'v1', ahora,
        datos: { ...datos, receptor: { ...datos.receptor, categoriaIvaTango: '' } },
        leer: store.leer, guardar: store.guardar,
      }),
    ).rejects.toThrow(/no facturable/)

    expect(arca.solicitarCae).not.toHaveBeenCalled()
    expect(db.docs.get(RUTA_CONTADOR)).toMatchObject({ ultimoAsignado: 100 })
  })
})
