import { describe, it, expect, vi } from 'vitest'
import { obtenerTicketAcceso, invalidarTicket, rutaTicket, MARGEN_RENOVACION_MS } from './ticketCache'
import type { DbLike, TransactionLike, SnapshotLike } from './numeracion'
import type { TicketAcceso } from './wsaa'

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

const CUIT = '30697668973'
const RUTA = rutaTicket('produccion', 'wsfe', CUIT)
const AHORA = new Date('2026-09-01T15:00:00Z')

const base = {
  ambiente: 'produccion' as const,
  cuit: CUIT,
  certificadoPem: 'cert',
  clavePrivadaPem: 'key',
  ahora: AHORA,
}

const ticketNuevo = (horas = 12): TicketAcceso => ({
  token: 'TOKEN_NUEVO',
  sign: 'SIGN_NUEVO',
  expiracion: new Date(AHORA.getTime() + horas * 3600_000),
})

describe('rutaTicket', () => {
  it('separa por ambiente, servicio y CUIT', () => {
    expect(rutaTicket('produccion', 'wsfe', CUIT)).toBe(`arcaTickets/produccion_wsfe_${CUIT}`)
    expect(rutaTicket('homologacion', 'wsfe', CUIT)).not.toBe(rutaTicket('produccion', 'wsfe', CUIT))
  })
})

describe('obtenerTicketAcceso', () => {
  it('pide uno nuevo si no hay nada cacheado, y lo guarda', async () => {
    const db = dbFalsa()
    const solicitar = vi.fn(async () => ticketNuevo())

    const ta = await obtenerTicketAcceso({ ...base, db, solicitar })

    expect(ta.token).toBe('TOKEN_NUEVO')
    expect(solicitar).toHaveBeenCalledTimes(1)
    expect(db.docs.get(RUTA)).toMatchObject({ token: 'TOKEN_NUEVO', sign: 'SIGN_NUEVO' })
  })

  it('reutiliza el cacheado sin llamar a ARCA', async () => {
    const db = dbFalsa({
      [RUTA]: {
        token: 'TOKEN_CACHE', sign: 'SIGN_CACHE',
        expiracionMs: AHORA.getTime() + 6 * 3600_000,
      },
    })
    const solicitar = vi.fn(async () => ticketNuevo())

    const ta = await obtenerTicketAcceso({ ...base, db, solicitar })

    expect(ta.token).toBe('TOKEN_CACHE')
    expect(solicitar).not.toHaveBeenCalled()
  })

  it('renueva un ticket vencido', async () => {
    const db = dbFalsa({
      [RUTA]: { token: 'VIEJO', sign: 'VIEJO', expiracionMs: AHORA.getTime() - 1000 },
    })
    const solicitar = vi.fn(async () => ticketNuevo())

    expect((await obtenerTicketAcceso({ ...base, db, solicitar })).token).toBe('TOKEN_NUEVO')
    expect(solicitar).toHaveBeenCalledTimes(1)
  })

  it('renueva por adelantado si está por vencer dentro del margen', async () => {
    // Válido todavía, pero por 5 minutos: no alcanza para completar una emisión.
    const db = dbFalsa({
      [RUTA]: {
        token: 'POR_VENCER', sign: 'X',
        expiracionMs: AHORA.getTime() + MARGEN_RENOVACION_MS - 60_000,
      },
    })
    const solicitar = vi.fn(async () => ticketNuevo())

    expect((await obtenerTicketAcceso({ ...base, db, solicitar })).token).toBe('TOKEN_NUEVO')
  })

  it('ignora un documento corrupto y pide uno nuevo', async () => {
    const db = dbFalsa({ [RUTA]: { token: 123, sign: null } })
    const solicitar = vi.fn(async () => ticketNuevo())
    expect((await obtenerTicketAcceso({ ...base, db, solicitar })).token).toBe('TOKEN_NUEVO')
  })

  it('ante "ya posee un TA valido" relee el cache en vez de fallar', async () => {
    // Simula la carrera: otra instancia obtuvo el TA y lo guardó mientras
    // nosotros pedíamos el nuestro.
    const db = dbFalsa()
    const solicitar = vi.fn(async () => {
      db.docs.set(RUTA, {
        token: 'TOKEN_DE_LA_OTRA', sign: 'SIGN_DE_LA_OTRA',
        expiracionMs: AHORA.getTime() + 12 * 3600_000,
      })
      throw new Error('WSAA rechazó el pedido: El CEE ya posee un TA valido para el acceso al WSN solicitado')
    })

    const ta = await obtenerTicketAcceso({ ...base, db, solicitar })
    expect(ta.token).toBe('TOKEN_DE_LA_OTRA')
  })

  it('espera y relee: la instancia ganadora puede tardar en guardar', async () => {
    // Caso realista de la carrera: la perdedora recibe el error ANTES de que la
    // ganadora haya guardado. Releer una sola vez no alcanzaría.
    const db = dbFalsa()
    let pausas = 0
    const esperar = async () => {
      pausas++
      if (pausas === 2) {
        db.docs.set(RUTA, {
          token: 'TOKEN_TARDIO', sign: 'S',
          expiracionMs: AHORA.getTime() + 12 * 3600_000,
        })
      }
    }
    const solicitar = vi.fn(async () => {
      throw new Error('El CEE ya posee un TA valido para el acceso al WSN solicitado')
    })

    const ta = await obtenerTicketAcceso({ ...base, db, solicitar, esperar })
    expect(ta.token).toBe('TOKEN_TARDIO')
  })

  it('si ARCA dice que hay un TA vigente y el cache nunca aparece, explica qué hacer', async () => {
    const db = dbFalsa()
    const solicitar = vi.fn(async () => {
      throw new Error('El CEE ya posee un TA valido para el acceso al WSN solicitado')
    })

    await expect(obtenerTicketAcceso({ ...base, db, solicitar, esperar: async () => {} }))
      .rejects.toThrow(/otro sistema esté usando el mismo certificado|esperar a que venza/)
  })

  it('propaga cualquier otro error tal cual', async () => {
    const db = dbFalsa()
    const solicitar = vi.fn(async () => { throw new Error('certificado vencido') })
    await expect(obtenerTicketAcceso({ ...base, db, solicitar })).rejects.toThrow(/certificado vencido/)
  })

  it('con el cache frío varias instancias piden a la vez, y todas terminan con ticket', async () => {
    // Comportamiento honesto, no el ideal: la lectura del cache y el pedido al
    // WSAA no son atómicos entre sí (no se puede llamar a la red dentro de una
    // transacción), así que N instancias arrancando en frío piden N veces. En
    // producción ARCA le da el TA a una y a las otras les responde "ya posee un
    // TA valido", que el código resuelve releyendo el cache.
    //
    // Que esto pase es tolerable porque ocurre UNA vez cada 12 horas, cuando el
    // ticket vence. A partir de la segunda llamada ya sale del cache.
    const db = dbFalsa()
    let pedidos = 0
    const solicitar = vi.fn(async () => { pedidos++; return ticketNuevo() })

    const tickets = await Promise.all(
      Array.from({ length: 5 }, () => obtenerTicketAcceso({ ...base, db, solicitar })),
    )

    expect(tickets.every((t) => t.token === 'TOKEN_NUEVO')).toBe(true)
    expect(pedidos).toBe(5)

    // Lo que sí importa: una vez cacheado, nadie más molesta a ARCA.
    await obtenerTicketAcceso({ ...base, db, solicitar })
    expect(pedidos).toBe(5)
  })
})

describe('invalidarTicket', () => {
  it('deja el cache vacío', async () => {
    const db = dbFalsa({
      [RUTA]: { token: 'T', sign: 'S', expiracionMs: AHORA.getTime() + 3600_000 },
    })
    await invalidarTicket(db, 'produccion', CUIT)
    expect(db.docs.get(RUTA)).toMatchObject({ token: null, expiracionMs: 0 })
  })
})
