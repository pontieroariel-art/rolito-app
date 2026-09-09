import { describe, it, expect, vi } from 'vitest'
import { emitirNotaCreditoTotal } from './notaCredito'
import type { FacturaGuardada, RegistroFactura } from './facturacionVenta'
import type { PuertoArca } from './emision'
import { ArcaError } from './wsfev1'
import { rutaContador } from './numeracion'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'
import type { ConfigArca } from './configuracion'
import type { FacturaOrigen, FECAEDetRequest } from './comprobante'
import { construirDetalleNotaCreditoTotal, NOTA_CREDITO_POR_FACTURA, TIPO_COMPROBANTE } from './comprobante'

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
  ambiente: 'homologacion', cuit: '30697668973', puntoVenta: 1104,
  preciosIncluyenIva: false, tributoIdPercepcionIIBB: 7, habilitado: true,
}
const NC_A = TIPO_COMPROBANTE.NOTA_CREDITO_A
const RUTA_CONTADOR_NC_A = rutaContador({ ptoVta: 1104, cbteTipo: NC_A })

const detalleFactura: FECAEDetRequest = {
  Concepto: 1, DocTipo: 80, DocNro: 30697668973, CbteDesde: 116, CbteHasta: 116, CbteFch: '20260909',
  ImpTotal: 12300, ImpTotConc: 0, ImpNeto: 10000, ImpOpEx: 0, ImpTrib: 200, ImpIVA: 2100,
  MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: 1,
  Iva: [{ Id: 5, BaseImp: 10000, Importe: 2100 }],
  Tributos: [{ Id: 7, Desc: 'Percepción IIBB CABA', BaseImp: 10000, Alic: 2, Importe: 200 }],
}
const factura: FacturaOrigen = {
  puntoVenta: 1104, cbteTipo: 1, numero: 116,
  importes: { fecha: '20260909', neto: 10000, iva: 2100, tributos: 200, total: 12300 },
  detalle: detalleFactura,
}
const ahora = new Date('2026-09-10T15:00:00-03:00')

function puerto(overrides: Partial<PuertoArca> = {}): PuertoArca {
  return {
    solicitarCae: vi.fn(async () => ({ resultado: 'A' as const, cae: '75999999999999', caeFchVto: '20260920', cbteDesde: 1, observaciones: [] })),
    // Por defecto la factura original existe con el mismo total.
    consultarComprobante: vi.fn(async () => ({ existe: true, cae: '75123456789012', caeFchVto: '20260919', cbteFch: '20260909', impTotal: 12300 })),
    ...overrides,
  }
}

function almacen(inicial?: FacturaGuardada) {
  let actual = inicial
  const escrituras: RegistroFactura[] = []
  return {
    escrituras,
    get actual() { return actual },
    leer: async () => actual,
    guardar: async (r: RegistroFactura) => { escrituras.push(r); actual = r as unknown as FacturaGuardada },
  }
}

const opciones = (db: DbLike, arca: PuertoArca, alm: ReturnType<typeof almacen>, extra: Partial<Parameters<typeof emitirNotaCreditoTotal>[0]> = {}) => ({
  db, arca, config, ventaId: 'v1', anulacionId: 'v1', factura: { ...factura, importes: { ...factura.importes } }, ahora,
  leer: alm.leer, guardar: alm.guardar, ...extra,
})

describe('construirDetalleNotaCreditoTotal', () => {
  it('copia el detalle guardado cambiando solo número, fecha y comprobante asociado', () => {
    const { detalle, cbteTipo } = construirDetalleNotaCreditoTotal(factura, { numeroComprobante: 7, fechaEmision: ahora, cuitEmisor: '30-69766897-3', tributoIdPercepcionIIBB: 7 })
    expect(cbteTipo).toBe(NC_A)
    expect(detalle.CbteDesde).toBe(7); expect(detalle.CbteHasta).toBe(7)
    expect(detalle.CbteFch).toBe('20260910')
    expect(detalle.CbtesAsoc).toEqual([{ Tipo: 1, PtoVta: 1104, Nro: 116, Cuit: '30697668973', CbteFch: '20260909' }])
    const { CbteDesde: _a, CbteHasta: _b, CbteFch: _c, CbtesAsoc: _d, ...resto } = detalle
    const { CbteDesde: _e, CbteHasta: _f, CbteFch: _g, ...original } = detalleFactura
    expect(resto).toEqual(original)
  })

  it('sin detalle guardado reconstruye IVA y percepción desde los importes y cierra el total', () => {
    const sinDetalle: FacturaOrigen = { ...factura, detalle: undefined }
    const { detalle } = construirDetalleNotaCreditoTotal(sinDetalle, {
      numeroComprobante: 1, fechaEmision: ahora, cuitEmisor: '30697668973', tributoIdPercepcionIIBB: 7,
      receptor: { razonSocial: 'ACME', cuit: '30697668973', categoriaIvaTango: 'RI' },
    })
    expect(detalle.ImpTotal).toBe(12300); expect(detalle.ImpNeto).toBe(10000); expect(detalle.ImpIVA).toBe(2100); expect(detalle.ImpTrib).toBe(200)
    expect(detalle.Iva).toEqual([{ Id: 5, BaseImp: 10000, Importe: 2100 }])
    // La alícuota sale de lo facturado (200/10000 = 2 %), no del padrón de hoy.
    expect(detalle.Tributos).toEqual([{ Id: 7, Desc: 'Percepción IIBB CABA', BaseImp: 10000, Alic: 2, Importe: 200 }])
    expect(detalle.DocTipo).toBe(80); expect(detalle.CondicionIVAReceptorId).toBe(1)
  })

  it('sin detalle: tira si el cliente cambió de clase o si los importes no cierran', () => {
    const sinDetalle: FacturaOrigen = { ...factura, detalle: undefined }
    expect(() => construirDetalleNotaCreditoTotal(sinDetalle, {
      numeroComprobante: 1, fechaEmision: ahora, cuitEmisor: '30697668973', tributoIdPercepcionIIBB: 7,
      receptor: { razonSocial: 'JUAN', cuit: '20111111112', categoriaIvaTango: 'CF' },
    })).toThrow(/clase B/)
    expect(() => construirDetalleNotaCreditoTotal({ ...sinDetalle, importes: { ...factura.importes, total: 12000 } }, {
      numeroComprobante: 1, fechaEmision: ahora, cuitEmisor: '30697668973', tributoIdPercepcionIIBB: 7,
      receptor: { razonSocial: 'ACME', cuit: '30697668973', categoriaIvaTango: 'RI' },
    })).toThrow(/no cierran/)
    expect(() => construirDetalleNotaCreditoTotal(sinDetalle, { numeroComprobante: 1, fechaEmision: ahora, cuitEmisor: '30697668973', tributoIdPercepcionIIBB: 7 })).toThrow(/receptor/)
  })

  it('mapea A→NC A, B→NC B, C→NC C y tira con un tipo desconocido', () => {
    expect(NOTA_CREDITO_POR_FACTURA[1]).toBe(3); expect(NOTA_CREDITO_POR_FACTURA[6]).toBe(8); expect(NOTA_CREDITO_POR_FACTURA[11]).toBe(13)
    expect(() => construirDetalleNotaCreditoTotal({ ...factura, cbteTipo: 3 }, { numeroComprobante: 1, fechaEmision: ahora, cuitEmisor: '30697668973', tributoIdPercepcionIIBB: 7 })).toThrow(/tipo de comprobante 3/)
  })
})

describe('emitirNotaCreditoTotal', () => {
  it('emite la NC A con el número del contador de NC y el comprobante asociado', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 4, librados: [] } })
    const arca = puerto()
    const alm = almacen()
    const r = await emitirNotaCreditoTotal(opciones(db, arca, alm))
    expect(r.estado).toBe('emitida'); expect(r.tipo).toBe('nota_credito'); expect(r.cbteTipo).toBe(NC_A); expect(r.numero).toBe(5)
    expect(r.cae).toBe('75999999999999')
    expect(r.cbtesAsoc).toEqual([{ Tipo: 1, PtoVta: 1104, Nro: 116, Cuit: '30697668973', CbteFch: '20260909' }])
    expect(r.importes).toEqual({ fecha: '20260910', neto: 10000, iva: 2100, tributos: 200, total: 12300 })
    const enviado = (arca.solicitarCae as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(enviado[0]).toBe(1104); expect(enviado[1]).toBe(NC_A); expect(enviado[2].CbtesAsoc).toHaveLength(1)
    // Rastro antes del CAE: incierta con el número y el asociado.
    expect(alm.escrituras[0]).toMatchObject({ estado: 'incierta', numero: 5, cbteTipo: NC_A, tipo: 'nota_credito', anulacionId: 'v1' })
  })

  it('no reserva número si la factura original no existe en ARCA o su total difiere', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 4, librados: [] } })
    const alm = almacen()
    await expect(emitirNotaCreditoTotal(opciones(db, puerto({ consultarComprobante: vi.fn(async () => ({ existe: false })) }), alm))).rejects.toThrow(/no existe en ARCA/)
    await expect(emitirNotaCreditoTotal(opciones(db, puerto({ consultarComprobante: vi.fn(async () => ({ existe: true, impTotal: 999 })) }), alm))).rejects.toThrow(/no coincide/)
    expect(db.docs.get(RUTA_CONTADOR_NC_A)).toMatchObject({ ultimoAsignado: 4 })
    expect(alm.escrituras).toHaveLength(0)
  })

  it('tira si el contador de NC no está sembrado, sin llamar a ARCA para el CAE', async () => {
    const db = dbFalsa()
    const arca = puerto()
    await expect(emitirNotaCreditoTotal(opciones(db, arca, almacen()))).rejects.toThrow()
    expect(arca.solicitarCae).not.toHaveBeenCalled()
  })

  it('una NC ya emitida no se vuelve a emitir; dos llamadas seguidas emiten una sola', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 0, librados: [] } })
    const arca = puerto()
    const alm = almacen()
    const r1 = await emitirNotaCreditoTotal(opciones(db, arca, alm))
    const r2 = await emitirNotaCreditoTotal(opciones(db, arca, alm))
    expect(r1.numero).toBe(1); expect(r2.numero).toBe(1); expect(r2.estado).toBe('emitida')
    expect(arca.solicitarCae).toHaveBeenCalledTimes(1)
  })

  it('con número reservado sin resolver le pregunta a ARCA en vez de reintentar', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 3, librados: [] } })
    const arca = puerto({ consultarComprobante: vi.fn(async (_p, tipo, n) => (tipo === NC_A && n === 3 ? { existe: true, cae: '70000000000001', caeFchVto: '20260920' } : { existe: false })) })
    const alm = almacen({ estado: 'incierta', numero: 3, cbteTipo: NC_A, tipo: 'nota_credito' })
    const r = await emitirNotaCreditoTotal(opciones(db, arca, alm))
    expect(r).toMatchObject({ estado: 'emitida', numero: 3, cae: '70000000000001' })
    expect(arca.solicitarCae).not.toHaveBeenCalled()
  })

  it('rechazada con el número liberado permite volver a emitir (re-aprobación)', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 3, librados: [3] } })
    const arca = puerto()
    const alm = almacen({ estado: 'rechazada', numero: 3, cbteTipo: NC_A, tipo: 'nota_credito', numeroLiberado: true })
    const r = await emitirNotaCreditoTotal(opciones(db, arca, alm))
    expect(r.estado).toBe('emitida'); expect(arca.solicitarCae).toHaveBeenCalledTimes(1)
  })

  it('un corte de red deja la NC incierta con su número; un rechazo de ARCA la deja rechazada con motivo', async () => {
    const db = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 0, librados: [] } })
    const corte = await emitirNotaCreditoTotal(opciones(db, puerto({ solicitarCae: vi.fn(async () => { throw new Error('ECONNRESET') }) }), almacen()))
    expect(corte).toMatchObject({ estado: 'incierta', numero: 1, cbteTipo: NC_A })

    const db2 = dbFalsa({ [RUTA_CONTADOR_NC_A]: { ultimoAsignado: 0, librados: [] } })
    const rechazo = await emitirNotaCreditoTotal(opciones(db2, puerto({
      solicitarCae: vi.fn(async () => { throw new ArcaError('ARCA rechazó: [10192] Falta comprobante asociado', [{ code: 10192, msg: 'Falta comprobante asociado' }]) }),
      consultarComprobante: vi.fn(async (_p, tipo) => (tipo === NC_A ? { existe: false } : { existe: true, impTotal: 12300, cbteFch: '20260909' })),
    }), almacen()))
    expect(rechazo).toMatchObject({ estado: 'rechazada', numero: 1, numeroLiberado: true })
    expect(rechazo.motivo).toMatch(/10192/)
  })
})
