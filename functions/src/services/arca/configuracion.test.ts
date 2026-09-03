import { describe, it, expect } from 'vitest'
import { validarConfig, leerConfig, leerConfigParaEmitir, ConfigArcaInvalida, RUTA_CONFIG } from './configuracion'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'

const valida = {
  ambiente: 'produccion',
  cuit: '30697668973',
  puntoVenta: 1104,
  preciosIncluyenIva: false,
  tributoIdPercepcionIIBB: 7,
  habilitado: true,
}

function dbFalsa(data?: Record<string, unknown>) {
  const db: DbLike = {
    doc: (p: string) => p,
    async runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
      const tx: TransactionLike = {
        async get(): Promise<SnapshotLike> {
          return { exists: data !== undefined, data: () => data }
        },
        set() { /* no se usa */ },
      }
      return fn(tx)
    },
  }
  return db
}

describe('validarConfig', () => {
  it('acepta una configuración completa', () => {
    const c = validarConfig(valida)
    expect(c).toEqual({
      ambiente: 'produccion',
      cuit: '30697668973',
      puntoVenta: 1104,
      preciosIncluyenIva: false,
      tributoIdPercepcionIIBB: 7,
      topeConsumidorFinalSinIdentificar: 0,
      habilitado: true,
    })
  })

  it('el tope del consumidor final sin identificar es opcional y no admite negativos', () => {
    expect(validarConfig({ ...valida, topeConsumidorFinalSinIdentificar: 417288 }).topeConsumidorFinalSinIdentificar).toBe(417288)
    expect(() => validarConfig({ ...valida, topeConsumidorFinalSinIdentificar: -1 })).toThrow(/tope/)
    expect(() => validarConfig({ ...valida, topeConsumidorFinalSinIdentificar: 'mucho' })).toThrow(/tope/)
  })

  it('normaliza el CUIT con guiones', () => {
    expect(validarConfig({ ...valida, cuit: '30-69766897-3' }).cuit).toBe('30697668973')
  })

  it('rechaza un ambiente que no existe', () => {
    expect(() => validarConfig({ ...valida, ambiente: 'testing' })).toThrow(/ambiente/)
  })

  it('rechaza un punto de venta fuera del rango de ARCA', () => {
    expect(() => validarConfig({ ...valida, puntoVenta: 0 })).toThrow(/puntoVenta/)
    expect(() => validarConfig({ ...valida, puntoVenta: 99999 })).toThrow(/puntoVenta/)
    expect(() => validarConfig({ ...valida, puntoVenta: 1.5 })).toThrow(/puntoVenta/)
  })

  it('exige preciosIncluyenIva explícito: no asume nada', () => {
    const { preciosIncluyenIva, ...sinEseCampo } = valida
    expect(preciosIncluyenIva).toBe(false)
    expect(() => validarConfig(sinEseCampo)).toThrow(/preciosIncluyenIva/)
    // Tampoco vale un string que "parece" booleano.
    expect(() => validarConfig({ ...valida, preciosIncluyenIva: 'false' })).toThrow(/preciosIncluyenIva/)
  })

  it('exige el código de tributo de la percepción', () => {
    expect(() => validarConfig({ ...valida, tributoIdPercepcionIIBB: 0 })).toThrow(/tributoIdPercepcionIIBB/)
  })

  it('sin documento, informa TODO lo que falta de una vez', () => {
    try {
      validarConfig(undefined)
      throw new Error('debería haber fallado')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigArcaInvalida)
      expect((e as ConfigArcaInvalida).problemas.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('habilitado es false salvo que diga explícitamente true', () => {
    expect(validarConfig({ ...valida, habilitado: undefined }).habilitado).toBe(false)
    expect(validarConfig({ ...valida, habilitado: 'true' }).habilitado).toBe(false)
    expect(validarConfig({ ...valida, habilitado: true }).habilitado).toBe(true)
  })
})

describe('leerConfig', () => {
  it('lee del documento config/arca', async () => {
    const db = dbFalsa(valida)
    expect((await leerConfig(db)).puntoVenta).toBe(1104)
    expect(RUTA_CONFIG).toBe('config/arca')
  })

  it('falla si el documento no existe', async () => {
    await expect(leerConfig(dbFalsa(undefined))).rejects.toThrow(ConfigArcaInvalida)
  })
})

describe('leerConfigParaEmitir', () => {
  it('deja emitir con la facturación encendida', async () => {
    expect((await leerConfigParaEmitir(dbFalsa(valida))).habilitado).toBe(true)
  })

  it('no deja emitir si está apagada, aunque el resto esté bien', async () => {
    await expect(leerConfigParaEmitir(dbFalsa({ ...valida, habilitado: false })))
      .rejects.toThrow(/deshabilitada/)
  })
})
