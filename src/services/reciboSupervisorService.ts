import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { db } from './firebase'

// Numeración correlativa de recibos de cobranza de supervisor (RS-000123).
// Contador ÚNICO global en config/reciboSupervisorCounter (los supervisores
// no están fijos a una planta), mismo patrón transaccional que
// produccionCounterService + reserva de lotes en localStorage
// (produccionReservaService) para poder emitir recibos sin señal en la calle.
// Es numeración interna de la app: el correlativo fiscal real lo asigna Tango
// cuando el recibo entra por la API. Huecos por lotes no consumidos: aceptado.

export const BATCH_SIZE        = 20
export const RESERVE_THRESHOLD = 5

const COUNTER_REF = () => doc(db, 'config', 'reciboSupervisorCounter')

export class ReciboCounterNoInicializadoError extends Error {}
export class ReservaAgotadaError extends Error {}

export function codigoRecibo(numero: number): string {
  return `RS-${String(numero).padStart(6, '0')}`
}

interface RangoLocal { from: number; to: number }
interface RangoActivo extends RangoLocal { usedUpTo: number }

interface ReservaLocalRecibos {
  activo:         RangoActivo | null
  siguiente:      RangoLocal | null
  reservaEnCurso: number | null   // epoch ms — lock anti-doble-pedido
}

const STALE_LOCK_MS = 20_000

const storageKey = (uid: string) => `reciboSupervisorReserva_${uid}`

function leerReserva(uid: string): ReservaLocalRecibos {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    if (raw) return JSON.parse(raw) as ReservaLocalRecibos
  } catch { /* sin storage no hay offline-safe, pero no rompemos el flujo */ }
  return { activo: null, siguiente: null, reservaEnCurso: null }
}

function guardarReserva(uid: string, r: ReservaLocalRecibos): void {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(r))
  } catch { /* idem leerReserva */ }
}

// Sin fallback silencioso a "next=1": si el contador todavía no fue
// inicializado por un super_admin, error explícito.
export async function reservarLote(size = BATCH_SIZE): Promise<RangoLocal> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER_REF())
    if (!snap.exists()) {
      throw new ReciboCounterNoInicializadoError(
        'El contador de recibos de supervisor todavía no fue inicializado. Contactá al administrador.',
      )
    }
    const next = snap.data().next as number
    tx.set(COUNTER_REF(), { next: next + size })
    return { from: next, to: next + size - 1 }
  })
}

// Uso único desde el Backoffice (super_admin): fija el número de arranque.
export async function inicializarContador(primerNumero: number): Promise<void> {
  await setDoc(COUNTER_REF(), { next: primerNumero })
}

export async function getProximoNumero(): Promise<number | null> {
  const snap = await getDoc(COUNTER_REF())
  return snap.exists() ? (snap.data().next as number) : null
}

// SÍNCRONO, nunca toca la red — es lo único que corre al confirmar la
// cobranza, por eso el flujo funciona sin señal. Graba usedUpTo en el mismo
// tick en que entrega el número: nunca se repite aunque se cierre la app.
export function consumirNumero(uid: string): number {
  const r = leerReserva(uid)

  if (r.activo && r.activo.usedUpTo < r.activo.to) {
    const numero = r.activo.usedUpTo + 1
    guardarReserva(uid, { ...r, activo: { ...r.activo, usedUpTo: numero } })
    return numero
  }

  if (r.siguiente) {
    const numero = r.siguiente.from
    guardarReserva(uid, {
      ...r,
      activo:    { from: r.siguiente.from, to: r.siguiente.to, usedUpTo: numero },
      siguiente: null,
    })
    return numero
  }

  throw new ReservaAgotadaError('No hay números de recibo reservados disponibles.')
}

function margenRestante(r: ReservaLocalRecibos): number {
  return r.activo ? r.activo.to - r.activo.usedUpTo : 0
}

// Llamar al montar la pantalla de cobro. Devuelve si la numeración está
// ACTIVA (hay números para consumir). La numeración es OPCIONAL por decisión
// de Ariel (2026-08-31): mientras config/reciboSupervisorCounter no esté
// inicializado, los recibos salen SIN número y el cobro nunca se bloquea —
// cuando se conecte Tango y se inicialice el contador, la numeración arranca
// sola. Por eso acá nada tira error: sin red y sin reserva → sin número.
export async function asegurarReserva(uid: string, online: boolean): Promise<boolean> {
  const r = leerReserva(uid)
  if (margenRestante(r) > 0 || r.siguiente) return true

  if (!online) return false

  try {
    const rango = await reservarLote()
    guardarReserva(uid, { ...r, activo: { ...rango, usedUpTo: rango.from - 1 } })
    return true
  } catch {
    // Contador no inicializado (modo "sin numeración") o error de red — el
    // cobro sigue sin número.
    return false
  }
}

// Fire-and-forget después de cada cobranza: recarga el próximo lote en
// background cuando queda poco margen.
export function precargarSiSeAcerca(uid: string, online: boolean): void {
  if (!online) return
  const r = leerReserva(uid)
  if (r.siguiente) return
  if (margenRestante(r) > RESERVE_THRESHOLD) return
  if (r.reservaEnCurso && Date.now() - r.reservaEnCurso < STALE_LOCK_MS) return

  guardarReserva(uid, { ...r, reservaEnCurso: Date.now() })
  reservarLote()
    .then((rango) => {
      const actual = leerReserva(uid)
      guardarReserva(uid, { ...actual, siguiente: rango, reservaEnCurso: null })
    })
    .catch(() => {
      const actual = leerReserva(uid)
      guardarReserva(uid, { ...actual, reservaEnCurso: null })
    })
}
