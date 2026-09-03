import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { TipoComprobanteInterno } from '../types'

// Numeración correlativa de los comprobantes INTERNOS de la venta del camión:
// el remito (cuenta corriente de Redonhielo, y remito de promo de Rolito) y la
// factura "X" de promo (Rolito). Decidido 2026-09-03: una sola serie por tipo
// para toda la empresa (van a viajar a Tango, a la empresa Rolito, con este
// número como referencia; el correlativo que valga allá lo pone Tango) y un
// punto de venta APARTE del 1104 de ARCA, para que nunca se confundan con la
// numeración fiscal.
//
// Contadores en config/numeracionInterna_{tipo} = { next, puntoVenta }. Mismo
// patrón que reciboSupervisorService: reserva de lotes en localStorage para
// numerar sin señal en la calle. Huecos por lotes no consumidos: aceptado.
//
// La numeración es OPCIONAL igual que la de recibos: mientras el contador no
// esté inicializado desde la consola/Backoffice, la venta sale sin número y
// nunca se bloquea; el papel dice "sin número" y se puede reimprimir después.

export const BATCH_SIZE        = 20
export const RESERVE_THRESHOLD = 5

const COUNTER_REF = (tipo: TipoComprobanteInterno) => doc(db, 'config', `numeracionInterna_${tipo}`)

export class NumeracionNoInicializadaError extends Error {}
export class ReservaAgotadaError extends Error {}

// La parte pura (tipo + formato del número) vive en utils/numeracionInterna
// para que los utils que arman comprobantes no importen Firebase.
import { NumeroInterno, codigoComprobanteInterno } from '../utils/numeracionInterna'
export type { NumeroInterno }
export { codigoComprobanteInterno }

interface RangoLocal { from: number; to: number; puntoVenta: number }
interface RangoActivo extends RangoLocal { usedUpTo: number }

interface ReservaLocal {
  activo:         RangoActivo | null
  siguiente:      RangoLocal | null
  reservaEnCurso: number | null   // epoch ms — lock anti-doble-pedido
}

const STALE_LOCK_MS = 20_000

const storageKey = (tipo: TipoComprobanteInterno, uid: string) => `numeracionInterna_${tipo}_${uid}`

function leerReserva(tipo: TipoComprobanteInterno, uid: string): ReservaLocal {
  try {
    const raw = localStorage.getItem(storageKey(tipo, uid))
    if (raw) return JSON.parse(raw) as ReservaLocal
  } catch { /* sin storage no hay offline-safe, pero no rompemos el flujo */ }
  return { activo: null, siguiente: null, reservaEnCurso: null }
}

function guardarReserva(tipo: TipoComprobanteInterno, uid: string, r: ReservaLocal): void {
  try {
    localStorage.setItem(storageKey(tipo, uid), JSON.stringify(r))
  } catch { /* idem leerReserva */ }
}

// Sin fallback silencioso a "next=1": si el contador no fue inicializado,
// error explícito (que asegurarReserva convierte en "sin numeración").
export async function reservarLote(tipo: TipoComprobanteInterno, size = BATCH_SIZE): Promise<RangoLocal> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER_REF(tipo))
    if (!snap.exists()) {
      throw new NumeracionNoInicializadaError(
        `El contador de ${tipo} todavía no fue inicializado (config/numeracionInterna_${tipo}).`,
      )
    }
    const data = snap.data()
    const next = data.next as number
    const puntoVenta = Number(data.puntoVenta)
    if (!Number.isInteger(next) || !Number.isInteger(puntoVenta) || puntoVenta < 1) {
      throw new NumeracionNoInicializadaError(
        `El contador de ${tipo} está mal cargado: necesita next (entero) y puntoVenta (entero >= 1).`,
      )
    }
    // Talonario con rango autorizado (remito de imprenta con CAI: "último
    // número habilitado"): el lote nunca lo pasa, y agotado el rango se corta
    // en vez de numerar fuera de lo autorizado. `ultimo` es opcional: sin él,
    // la serie es infinita (factura X, remito promo).
    const ultimo = data.ultimo == null ? null : Number(data.ultimo)
    if (ultimo !== null && next > ultimo) {
      throw new NumeracionAgotadaError(
        `El talonario de ${tipo} se agotó (último número habilitado ${ultimo}). Hay que cargar el talonario nuevo en config/numeracionInterna_${tipo}.`,
      )
    }
    const to = ultimo === null ? next + size - 1 : Math.min(next + size - 1, ultimo)
    tx.set(COUNTER_REF(tipo), { next: to + 1 }, { merge: true })
    return { from: next, to, puntoVenta }
  })
}

export class NumeracionAgotadaError extends Error {}

// Uso único (super_admin): fija punto de venta, número de arranque y,
// opcionalmente, el último número habilitado del talonario.
export async function inicializarContador(
  tipo: TipoComprobanteInterno,
  args: { puntoVenta: number; primerNumero: number; ultimo?: number | null },
): Promise<void> {
  await setDoc(COUNTER_REF(tipo), { next: args.primerNumero, puntoVenta: args.puntoVenta, ultimo: args.ultimo ?? null })
}

export async function getEstadoContador(
  tipo: TipoComprobanteInterno,
): Promise<{ next: number; puntoVenta: number } | null> {
  const snap = await getDoc(COUNTER_REF(tipo))
  if (!snap.exists()) return null
  return { next: snap.data().next as number, puntoVenta: Number(snap.data().puntoVenta) }
}

// SÍNCRONO, nunca toca la red — es lo único que corre al confirmar la venta,
// por eso funciona sin señal. Graba usedUpTo en el mismo tick en que entrega el
// número: nunca se repite aunque se cierre la app.
export function consumirNumero(tipo: TipoComprobanteInterno, uid: string): NumeroInterno {
  const r = leerReserva(tipo, uid)

  if (r.activo && r.activo.usedUpTo < r.activo.to) {
    const numero = r.activo.usedUpTo + 1
    guardarReserva(tipo, uid, { ...r, activo: { ...r.activo, usedUpTo: numero } })
    return { puntoVenta: r.activo.puntoVenta, numero }
  }

  if (r.siguiente) {
    const numero = r.siguiente.from
    guardarReserva(tipo, uid, {
      ...r,
      activo:    { ...r.siguiente, usedUpTo: numero },
      siguiente: null,
    })
    return { puntoVenta: r.siguiente.puntoVenta, numero }
  }

  throw new ReservaAgotadaError(`No hay números de ${tipo} reservados disponibles.`)
}

function margenRestante(r: ReservaLocal): number {
  return r.activo ? r.activo.to - r.activo.usedUpTo : 0
}

// Llamar al montar la pantalla de venta. Devuelve si la numeración está ACTIVA
// (hay números para consumir). Nada tira error: sin red y sin reserva → sin
// número, y la venta sigue.
export async function asegurarReserva(
  tipo: TipoComprobanteInterno,
  uid: string,
  online: boolean,
): Promise<boolean> {
  const r = leerReserva(tipo, uid)
  if (margenRestante(r) > 0 || r.siguiente) return true
  if (!online) return false
  try {
    const rango = await reservarLote(tipo)
    guardarReserva(tipo, uid, { ...r, activo: { ...rango, usedUpTo: rango.from - 1 } })
    return true
  } catch {
    return false
  }
}

// Fire-and-forget después de cada venta: recarga el próximo lote en background
// cuando queda poco margen.
export function precargarSiSeAcerca(tipo: TipoComprobanteInterno, uid: string, online: boolean): void {
  if (!online) return
  const r = leerReserva(tipo, uid)
  if (r.siguiente) return
  if (margenRestante(r) > RESERVE_THRESHOLD) return
  if (r.reservaEnCurso && Date.now() - r.reservaEnCurso < STALE_LOCK_MS) return

  guardarReserva(tipo, uid, { ...r, reservaEnCurso: Date.now() })
  reservarLote(tipo)
    .then((rango) => {
      const actual = leerReserva(tipo, uid)
      guardarReserva(tipo, uid, { ...actual, siguiente: rango, reservaEnCurso: null })
    })
    .catch(() => {
      const actual = leerReserva(tipo, uid)
      guardarReserva(tipo, uid, { ...actual, reservaEnCurso: null })
    })
}
