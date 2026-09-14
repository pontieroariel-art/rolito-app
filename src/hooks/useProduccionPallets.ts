import { PalletProduccion, PlantaId } from '../types'
import { subscribePalletsDeHoy, subscribePalletsRecientes } from '../services/produccionService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

// Pallets de HOY de una planta, para la tablet de carga (2026-09-14). La
// clave de la suscripción es el día (string) para que se rearme sola a la
// medianoche y no con cada render.
export function useProduccionPalletsHoy(plantaId: PlantaId | undefined, dia: string) {
  const { data: pallets, loading } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => plantaId ? subscribePalletsDeHoy(plantaId, new Date(`${dia}T00:00:00`), cb) : () => {},
    [plantaId, dia],
    [],
  )
  return { pallets, loading }
}

// plantaId undefined = todas las plantas (listado de gerencia); fijo = solo
// esa planta (dashboard del operario, "últimos pallets cargados hoy").
export function useProduccionPallets(plantaId: PlantaId | undefined) {
  const { data: pallets, loading } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsRecientes(plantaId, cb),
    [plantaId],
    [],
  )
  return { pallets, loading }
}
