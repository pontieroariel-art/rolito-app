import { useMemo } from 'react'
import { PalletProduccion } from '../types'
import { subscribePalletsEnRango } from '../services/produccionService'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import { useDiaActual } from './useDiaActual'

export type PeriodoResumen = 'hoy' | '7d' | '30d'

// Rango de fechas del período, anclado a un día base (fecha local). Recibir el
// día explícito —en vez de leer `new Date()` acá adentro— es lo que permite
// recalcular al cruzar la medianoche (ver useDiaActual).
function rangoPara(periodo: PeriodoResumen, hoy: Date): { desde: Date; hasta: Date } {
  const hasta = new Date(hoy)
  hasta.setHours(23, 59, 59, 999)

  const desde = new Date(hoy)
  if (periodo === '7d') desde.setDate(desde.getDate() - 6)
  else if (periodo === '30d') desde.setDate(desde.getDate() - 29)
  desde.setHours(0, 0, 0, 0)

  return { desde, hasta }
}

export function useProduccionResumen(periodo: PeriodoResumen) {
  const dia = useDiaActual()
  const { desde, hasta } = useMemo(() => rangoPara(periodo, new Date(`${dia}T12:00:00`)), [periodo, dia])

  const { data: pallets, loading } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsEnRango(desde, hasta, cb),
    [desde.getTime(), hasta.getTime()],
    [],
  )

  return { pallets, loading, desde, hasta }
}
