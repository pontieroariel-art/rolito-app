/**
 * Cache del Ticket de Acceso de ARCA.
 *
 * **Esto no es una optimización, es un requisito.** El WSAA entrega un solo TA
 * válido por vez para cada combinación de certificado + servicio, y dura 12
 * horas. Si se pide otro mientras hay uno vigente, ARCA responde con un error
 * ("El CEE ya posee un TA valido para el acceso al WSN solicitado") en lugar de
 * devolver uno nuevo. Sin cache, la primera venta del día funciona y todas las
 * demás fallan.
 *
 * El TA se guarda en Firestore porque las instancias de Cloud Functions son
 * efímeras y hay varias en paralelo: una variable en memoria no alcanza.
 *
 * Ojo: el TA es material sensible (permite operar como la empresa). Se guarda
 * en una colección que las reglas de Firestore deben tener CERRADA a todo
 * cliente — solo lo toca el Admin SDK.
 */

import type { DbLike } from './numeracion'
import type { AmbienteArca, TicketAcceso, OpcionesWsaa } from './wsaa'
import { solicitarTicketAcceso, SERVICIO_WSFE } from './wsaa'

/**
 * Margen con el que se considera "por vencer" un ticket todavía válido.
 *
 * Sin margen, un TA que vence en 3 segundos pasaría el chequeo y la llamada a
 * ARCA fallaría con el token expirado. Diez minutos alcanzan de sobra para el
 * ciclo completo de una emisión.
 */
export const MARGEN_RENOVACION_MS = 10 * 60 * 1000

export function rutaTicket(ambiente: AmbienteArca, servicio: string, cuit: string): string {
  return `arcaTickets/${ambiente}_${servicio}_${cuit}`
}

interface TicketGuardado {
  token?: unknown
  sign?: unknown
  expiracionMs?: unknown
}

function leerTicket(data: Record<string, unknown> | undefined, ahora: Date): TicketAcceso | null {
  if (!data) return null
  const { token, sign, expiracionMs } = data as TicketGuardado
  if (typeof token !== 'string' || typeof sign !== 'string' || typeof expiracionMs !== 'number') {
    return null
  }
  if (expiracionMs - MARGEN_RENOVACION_MS <= ahora.getTime()) return null   // vencido o por vencer
  return { token, sign, expiracion: new Date(expiracionMs) }
}

export interface OpcionesTicket extends OpcionesWsaa {
  db: DbLike
  cuit: string
  /** Inyectable para testear el vencimiento. */
  ahora?: Date
  /** Inyectable para testear sin red. */
  solicitar?: (opts: OpcionesWsaa) => Promise<TicketAcceso>
  /** Inyectable para que los tests no esperen de verdad. */
  esperar?: (ms: number) => Promise<void>
}

/**
 * Cuántas veces se relee el cache cuando ARCA dice que ya hay un TA vigente.
 *
 * El caso: varias instancias arrancan con el cache frío, todas piden un TA, y
 * ARCA se lo da a una sola. Las perdedoras tienen que esperar a que la ganadora
 * termine su llamada y guarde. Como no hay forma de coordinarlas, se releé unas
 * pocas veces con una pausa corta.
 */
const REINTENTOS_RELECTURA = 4
const PAUSA_RELECTURA_MS = 500

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Devuelve un Ticket de Acceso válido, reutilizando el cacheado si sirve.
 *
 * Maneja explícitamente la carrera entre instancias: si dos piden un TA a la
 * vez, ARCA le da uno a la primera y le responde "ya posee un TA valido" a la
 * segunda. En ese caso no hay que propagar el error — hay que releer el cache,
 * donde la ganadora ya dejó el ticket bueno.
 */
export async function obtenerTicketAcceso(opts: OpcionesTicket): Promise<TicketAcceso> {
  const { db, cuit, ambiente } = opts
  const servicio = opts.servicio ?? SERVICIO_WSFE
  const ahora = opts.ahora ?? new Date()
  const solicitar = opts.solicitar ?? solicitarTicketAcceso
  const ref = db.doc(rutaTicket(ambiente, servicio, cuit))

  const leerDelCache = () =>
    db.runTransaction(async (tx) => leerTicket((await tx.get(ref)).data(), ahora))

  const cacheado = await leerDelCache()
  if (cacheado) return cacheado

  const guardar = (ta: TicketAcceso) =>
    db.runTransaction(async (tx) => {
      tx.set(
        ref,
        {
          token: ta.token,
          sign: ta.sign,
          expiracionMs: ta.expiracion.getTime(),
          ambiente,
          servicio,
          cuit,
        },
        { merge: true },
      )
    })

  try {
    const ta = await solicitar(opts)
    await guardar(ta)
    return ta
  } catch (e) {
    const mensaje = (e as Error).message ?? ''
    if (!/ya posee un TA valido/i.test(mensaje)) throw e

    // Otra instancia se nos adelantó (o quedó un TA vigente que no teníamos
    // cacheado, por ejemplo tras borrar la colección). Se relee unas cuantas
    // veces: la ganadora puede estar todavía terminando su llamada al WSAA, así
    // que el cache puede seguir vacío por unos cientos de milisegundos.
    const pausa = opts.esperar ?? dormir
    for (let intento = 0; intento < REINTENTOS_RELECTURA; intento++) {
      const reintento = await leerDelCache()
      if (reintento) return reintento
      await pausa(PAUSA_RELECTURA_MS)
    }

    throw new Error(
      'ARCA dice que ya hay un Ticket de Acceso vigente para este certificado, ' +
      'pero no está en el cache. Puede ser que otro sistema esté usando el mismo ' +
      'certificado, o que se haya borrado el cache. Hay que esperar a que venza ' +
      `(hasta 12 h) o usar un certificado propio. Detalle: ${mensaje}`,
    )
  }
}

/**
 * Borra el ticket cacheado.
 *
 * Útil solo para diagnóstico: NO hace que ARCA entregue uno nuevo antes de
 * tiempo — el TA sigue vigente del lado de ellos. Borrarlo acá deja el sistema
 * peor, sin poder emitir hasta que venza.
 */
export async function invalidarTicket(
  db: DbLike,
  ambiente: AmbienteArca,
  cuit: string,
  servicio: string = SERVICIO_WSFE,
): Promise<void> {
  const ref = db.doc(rutaTicket(ambiente, servicio, cuit))
  await db.runTransaction(async (tx) => {
    tx.set(ref, { token: null, sign: null, expiracionMs: 0 }, { merge: true })
  })
}
