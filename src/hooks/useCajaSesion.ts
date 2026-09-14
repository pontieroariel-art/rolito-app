import type { CajaSesion, PlantaId } from '@/types'
import { subscribeSesionAbierta, subscribeSesionesDelDia } from '@/services/cajaSesionService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

// Turno de caja (2026-09-14). Streams acotados (un cajero y un día; una planta
// y un día): `useFirestoreSubscription`, no la compartida.

/** La sesión abierta de hoy del cajero, o null. Sin uid (sesión cargando) no se suscribe y entrega null. */
export function useSesionAbierta(uid: string | undefined, fecha: string): { sesion: CajaSesion | null; loading: boolean; error: boolean } {
  const { data: sesion, loading, error } = useFirestoreSubscription<CajaSesion | null>(
    (cb, onError) => {
      if (!uid) { cb(null); return () => {} }
      return subscribeSesionAbierta(uid, fecha, cb, onError)
    },
    [uid, fecha],
    null,
  )
  return { sesion, loading, error }
}

/** Las sesiones del día de una planta (tesorería: cajas abiertas y cerradas). */
export function useSesionesDelDia(plantaId: PlantaId, fecha: string): { sesiones: CajaSesion[]; loading: boolean; error: boolean } {
  const { data: sesiones, loading, error } = useFirestoreSubscription<CajaSesion[]>(
    (cb, onError) => subscribeSesionesDelDia(plantaId, fecha, cb, onError),
    [plantaId, fecha],
    [],
  )
  return { sesiones, loading, error }
}
