import { doc, runTransaction, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { PlantaId } from '../types'

// Contador correlativo por planta (config/produccionCounter_torcuato,
// config/produccionCounter_merlo) — mismo patrón transaccional que
// config/ticketServicioCounter. Requiere red: la reserva de un lote entero
// se hace acá, después el consumo número a número es local y offline (ver
// produccionReservaService.ts).
export const BATCH_SIZE        = 30
export const RESERVE_THRESHOLD = 5   // cuando quedan <= 5 números libres, se dispara una recarga en background

const COUNTER_REF = (plantaId: PlantaId) => doc(db, 'config', `produccionCounter_${plantaId}`)

export class ProduccionCounterNoInicializadoError extends Error {}

export interface RangoReservado { from: number; to: number }

// Sin fallback silencioso a "next=1": si el contador de la planta todavía no
// fue inicializado por un super_admin, tira error explícito en vez de
// arrancar la numeración real desde 1 por accidente.
export async function reservarLote(plantaId: PlantaId, size = BATCH_SIZE): Promise<RangoReservado> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(COUNTER_REF(plantaId))
    if (!snap.exists()) {
      throw new ProduccionCounterNoInicializadoError(
        `El contador de la planta ${plantaId} todavía no fue inicializado. Contactá al administrador.`,
      )
    }
    const next = snap.data().next as number
    tx.set(COUNTER_REF(plantaId), { next: next + size })
    return { from: next, to: next + size - 1 }
  })
}

// Uso único, desde la pantalla de alta de operarios (super_admin): fija el
// número de arranque real que indique Ariel. Las reglas de Firestore evitan
// que esto se llame dos veces sobre el mismo doc ya existente.
export async function inicializarContador(plantaId: PlantaId, primerNumero: number): Promise<void> {
  await setDoc(COUNTER_REF(plantaId), { next: primerNumero })
}

// Para mostrar en la pantalla de alta de operarios si el contador de una
// planta ya está inicializado (y en qué número va) antes de ofrecer el botón.
export async function getProximoNumero(plantaId: PlantaId): Promise<number | null> {
  const snap = await getDoc(COUNTER_REF(plantaId))
  return snap.exists() ? (snap.data().next as number) : null
}
