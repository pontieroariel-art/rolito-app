import { describe, it, expect, vi } from 'vitest'
import {
  rutaContador,
  inicializarContador,
  reservarNumero,
  marcarNumeroLibre,
  verificarSincronizacion,
} from './numeracion'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'

/**
 * Firestore de mentira: un Map de documentos con transacciones.
 *
 * Las transacciones se ejecutan **una por vez** (cola), que es la garantía que
 * da Firestore para un documento en disputa: usa concurrencia optimista y
 * reintenta la transacción perdedora, con lo cual el efecto observable es que
 * se serializan. Sin esta cola, todas las reservas concurrentes leerían el
 * mismo estado inicial y el test no probaría nada real.
 *
 * Lo que este doble SÍ prueba: que la lógica leer-e-incrementar es correcta
 * bajo ejecución serializada. Lo que NO prueba: que Firestore efectivamente
 * serialice — eso es una garantía del servicio, no de nuestro código.
 */
function dbFalsa(inicial: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(inicial))
  let cola: Promise<unknown> = Promise.resolve()

  const db: DbLike & { docs: typeof docs; transacciones: number } = {
    docs,
    transacciones: 0,
    doc: (path: string) => path,
    runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
      const ejecutar = async (): Promise<T> => {
        db.transacciones++
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
      // Se encadena a la cola, y se la deja "limpia" para que un rechazo no
      // arrastre a las transacciones siguientes.
      const resultado = cola.then(ejecutar, ejecutar)
      cola = resultado.catch(() => undefined)
      return resultado
    },
  }
  return db
}

const CLAVE = { ptoVta: 1104, cbteTipo: 1 }
const RUTA = rutaContador(CLAVE)

describe('rutaContador', () => {
  it('separa por punto de venta y tipo (A y B numeran distinto)', () => {
    expect(rutaContador({ ptoVta: 1104, cbteTipo: 1 })).toBe('config/arcaNumeracion_1104_1')
    expect(rutaContador({ ptoVta: 1104, cbteTipo: 6 })).toBe('config/arcaNumeracion_1104_6')
  })
})

describe('inicializarContador', () => {
  it('siembra el contador con el último número de ARCA', async () => {
    const db = dbFalsa()
    const estado = await inicializarContador(db, CLAVE, async () => 250)
    expect(estado.ultimoAsignado).toBe(250)
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 250, ptoVta: 1104, cbteTipo: 1 })
  })

  it('un punto de venta virgen arranca en 0, así el primero es el 1', async () => {
    const db = dbFalsa()
    await inicializarContador(db, CLAVE, async () => 0)
    expect(await reservarNumero(db, CLAVE)).toBe(1)
  })

  it('es idempotente: no vuelve a preguntarle a ARCA si ya existe', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 99, librados: [] } })
    const consulta = vi.fn(async () => 250)
    const estado = await inicializarContador(db, CLAVE, consulta)
    expect(estado.ultimoAsignado).toBe(99)
    expect(consulta).not.toHaveBeenCalled()
  })

  it('no consulta a ARCA dentro de la transacción (se reintentaría)', async () => {
    const db = dbFalsa()
    let dentroDeTransaccion = false
    const original = db.runTransaction.bind(db)
    db.runTransaction = async (fn) => {
      dentroDeTransaccion = true
      try { return await original(fn) } finally { dentroDeTransaccion = false }
    }
    await inicializarContador(db, CLAVE, async () => {
      expect(dentroDeTransaccion).toBe(false)
      return 10
    })
  })
})

describe('reservarNumero', () => {
  it('entrega números consecutivos', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [] } })
    expect(await reservarNumero(db, CLAVE)).toBe(101)
    expect(await reservarNumero(db, CLAVE)).toBe(102)
    expect(await reservarNumero(db, CLAVE)).toBe(103)
  })

  it('nunca entrega el mismo número dos veces, ni con reservas concurrentes', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 0, librados: [] } })
    const numeros = await Promise.all(
      Array.from({ length: 25 }, () => reservarNumero(db, CLAVE)),
    )
    expect(new Set(numeros).size).toBe(25)
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    )
  })

  it('consume primero los huecos, para no romper la correlatividad', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 100, librados: [55, 33] } })
    expect(await reservarNumero(db, CLAVE)).toBe(33)   // el menor primero
    expect(await reservarNumero(db, CLAVE)).toBe(55)
    expect(await reservarNumero(db, CLAVE)).toBe(101)  // recién ahí sigue
  })

  it('falla en vez de inventar un número si el contador no está inicializado', async () => {
    const db = dbFalsa()
    await expect(reservarNumero(db, CLAVE)).rejects.toThrow(/no está inicializado/)
  })
})

describe('marcarNumeroLibre', () => {
  it('retrocede el contador si el liberado era el último', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 101, librados: [] } })
    await marcarNumeroLibre(db, CLAVE, 101)
    expect(db.docs.get(RUTA)).toMatchObject({ ultimoAsignado: 100 })
    expect(await reservarNumero(db, CLAVE)).toBe(101)   // se vuelve a entregar
  })

  it('anota como hueco un número del medio', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 105, librados: [] } })
    await marcarNumeroLibre(db, CLAVE, 102)
    expect(db.docs.get(RUTA)).toMatchObject({ librados: [102] })
    expect(await reservarNumero(db, CLAVE)).toBe(102)
  })

  it('liberar dos veces el mismo número no lo duplica', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 105, librados: [] } })
    await marcarNumeroLibre(db, CLAVE, 102)
    await marcarNumeroLibre(db, CLAVE, 102)
    expect(db.docs.get(RUTA)!.librados).toEqual([102])
  })

  it('no explota si el contador todavía no existe', async () => {
    const db = dbFalsa()
    await expect(marcarNumeroLibre(db, CLAVE, 5)).resolves.toBeUndefined()
  })
})

describe('verificarSincronizacion', () => {
  it('detecta que estamos en sync', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 250, librados: [] } })
    expect(await verificarSincronizacion(db, CLAVE, async () => 250)).toEqual({
      enSync: true, local: 250, arca: 250,
    })
  })

  it('detecta divergencia (alguien emitió por fuera de la app)', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 250, librados: [] } })
    const r = await verificarSincronizacion(db, CLAVE, async () => 260)
    expect(r.enSync).toBe(false)
    expect(r).toMatchObject({ local: 250, arca: 260 })
  })

  it('con huecos pendientes no se considera sincronizado', async () => {
    const db = dbFalsa({ [RUTA]: { ultimoAsignado: 250, librados: [200] } })
    expect((await verificarSincronizacion(db, CLAVE, async () => 250)).enSync).toBe(false)
  })
})
