import { PlantaId } from '../types'
import { reservarLote, RESERVE_THRESHOLD } from './produccionCounterService'

// Reserva de códigos correlativos por adelantado, guardada en localStorage,
// para que un operario pueda seguir generando pallets (y códigos) sin wifi.
// Es la única pieza del módulo de producción sin precedente en el repo — los
// demás usos de localStorage (SistemaContext/BranchContext) son flags
// triviales de sesión, acá el contenido sí importa (no se puede perder ni
// duplicar un rango ya reservado del servidor).

interface RangoLocal { from: number; to: number }
interface RangoActivo extends RangoLocal { usedUpTo: number }

interface ReservaLocalProduccion {
  plantaId:       PlantaId
  activo:         RangoActivo | null
  siguiente:      RangoLocal | null
  reservaEnCurso: number | null   // epoch ms de cuándo arrancó un reservarLote() en vuelo (lock anti-doble-pedido)
}

const STALE_LOCK_MS = 20_000   // una reserva "en curso" de más de 20s se considera abandonada (pestaña cerrada a mitad de la llamada)

const storageKey = (uid: string) => `produccionReserva_${uid}`

function leerReserva(uid: string): ReservaLocalProduccion | null {
  try {
    const raw = localStorage.getItem(storageKey(uid))
    if (!raw) return null
    return JSON.parse(raw) as ReservaLocalProduccion
  } catch {
    return null
  }
}

function guardarReserva(uid: string, r: ReservaLocalProduccion): void {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(r))
  } catch {
    // localStorage no disponible (modo privado agotado, etc.) — sin
    // persistencia local no hay forma de garantizar el offline-safe, pero no
    // rompemos el flujo por eso: el número ya se entregó en memoria.
  }
}

// Si el usuario cambió de planta (admin reasignó), la reserva vieja queda
// para otra planta — se descarta en vez de mezclar numeraciones.
function reservaVigente(uid: string, plantaId: PlantaId): ReservaLocalProduccion {
  const r = leerReserva(uid)
  if (r && r.plantaId === plantaId) return r
  return { plantaId, activo: null, siguiente: null, reservaEnCurso: null }
}

export class ReservaAgotadaError extends Error {}
export class SinNumerosDisponiblesOfflineError extends Error {}

// SÍNCRONO, nunca toca la red. Es lo único que corre en el momento de
// confirmar un pallet — por eso el flujo funciona sin wifi. Escribe el
// nuevo `usedUpTo` en el mismo tick en que entrega el número: si la tablet
// se cierra un instante después de imprimir, el número ya quedó grabado y
// nunca se repite al reabrir.
export function consumirNumero(uid: string, plantaId: PlantaId): number {
  const r = reservaVigente(uid, plantaId)

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

  throw new ReservaAgotadaError('No hay números reservados disponibles.')
}

function margenRestante(r: ReservaLocalProduccion): number {
  return r.activo ? r.activo.to - r.activo.usedUpTo : 0
}

// Llamar al montar el dashboard, antes de habilitar la carga: si ya hay
// margen (activo o siguiente), no hace nada. Si no hay nada y hay red,
// reserva un lote ahora (bloqueante, mostrar spinner). Si no hay nada y no
// hay red, es el único caso que bloquea la carga — trade-off ya aceptado.
export async function asegurarReserva(uid: string, plantaId: PlantaId, online: boolean): Promise<void> {
  const r = reservaVigente(uid, plantaId)
  if (margenRestante(r) > 0 || r.siguiente) return

  if (!online) {
    throw new SinNumerosDisponiblesOfflineError(
      'Sin conexión y sin números disponibles. Reconectate para seguir cargando.',
    )
  }

  const rango = await reservarLote(plantaId)
  guardarReserva(uid, { ...r, activo: { ...rango, usedUpTo: rango.from - 1 } })
}

// Fire-and-forget, se llama después de cada pallet cargado. Si queda poco
// margen y hay red, reserva el próximo lote en background para que nunca
// haga falta esperar en medio de un turno.
export function precargarSiSeAcerca(uid: string, plantaId: PlantaId, online: boolean): void {
  if (!online) return
  const r = reservaVigente(uid, plantaId)
  if (r.siguiente) return
  if (margenRestante(r) > RESERVE_THRESHOLD) return
  if (r.reservaEnCurso && Date.now() - r.reservaEnCurso < STALE_LOCK_MS) return

  guardarReserva(uid, { ...r, reservaEnCurso: Date.now() })
  reservarLote(plantaId)
    .then((rango) => {
      const actual = reservaVigente(uid, plantaId)
      guardarReserva(uid, { ...actual, siguiente: rango, reservaEnCurso: null })
    })
    .catch(() => {
      const actual = reservaVigente(uid, plantaId)
      guardarReserva(uid, { ...actual, reservaEnCurso: null })
    })
}

// Para el indicador de "números disponibles" en el dashboard.
export function margenDisponible(uid: string, plantaId: PlantaId): number {
  const r = reservaVigente(uid, plantaId)
  return margenRestante(r) + (r.siguiente ? r.siguiente.to - r.siguiente.from + 1 : 0)
}
