import type { PlantaId, RindeA, Sobre } from '@/types'
import { subscribeSobre, subscribeSobresDelDia, subscribeSobresPendientes } from '@/services/sobreService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

// Sobres de rendición (2026-09-14). Streams acotados por estado, planta o id.

/** Bandeja "Por recibir": pendientes que rinden a X (tesorería o caja), de una planta o de todas. */
export function useSobresPendientes(plantaId: PlantaId | undefined, rindeA: RindeA): { sobres: Sobre[]; loading: boolean; error: boolean } {
  const { data: sobres, loading, error } = useFirestoreSubscription<Sobre[]>(
    (cb, onError) => subscribeSobresPendientes(plantaId, rindeA, cb, onError),
    [plantaId, rindeA],
    [],
  )
  return { sobres, loading, error }
}

/** Todos los sobres del día de una planta (tablero de custodia). */
export function useSobresDelDia(plantaId: PlantaId, fecha: string): { sobres: Sobre[]; loading: boolean; error: boolean } {
  const { data: sobres, loading, error } = useFirestoreSubscription<Sobre[]>(
    (cb, onError) => subscribeSobresDelDia(plantaId, fecha, cb, onError),
    [plantaId, fecha],
    [],
  )
  return { sobres, loading, error }
}

/** Un sobre en vivo. Sin id no se suscribe y entrega null. */
export function useSobre(id: string | undefined): { sobre: Sobre | null; loading: boolean; error: boolean } {
  const { data: sobre, loading, error } = useFirestoreSubscription<Sobre | null>(
    (cb, onError) => {
      if (!id) { cb(null); return () => {} }
      return subscribeSobre(id, cb, onError)
    },
    [id],
    null,
  )
  return { sobre, loading, error }
}
