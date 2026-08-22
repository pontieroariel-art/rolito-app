import { PalletProduccion, PlantaId } from '../types'
import { subscribePalletsRecientes } from '../services/produccionService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

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
