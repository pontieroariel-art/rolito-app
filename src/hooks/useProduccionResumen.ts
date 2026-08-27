import { useMemo } from 'react'
import { PalletProduccion } from '../types'
import { subscribePalletsEnRango } from '../services/produccionService'
import { useFirestoreSubscription } from './useFirestoreSubscription'

export type PeriodoResumen = 'hoy' | '7d' | '30d'

// Mismo patrón (`new Date(); setHours(12,0,0,0)`) usado en todo el proyecto
// para elegir un rango de fechas sin líos de timezone (ver useDespachoBoard.ts).
function rangoPara(periodo: PeriodoResumen): { desde: Date; hasta: Date } {
  const hasta = new Date()
  hasta.setHours(23, 59, 59, 999)

  const desde = new Date()
  if (periodo === '7d') desde.setDate(desde.getDate() - 6)
  else if (periodo === '30d') desde.setDate(desde.getDate() - 29)
  desde.setHours(0, 0, 0, 0)

  return { desde, hasta }
}

export function useProduccionResumen(periodo: PeriodoResumen) {
  const { desde, hasta } = useMemo(() => rangoPara(periodo), [periodo])

  const { data: pallets, loading } = useFirestoreSubscription<PalletProduccion[]>(
    (cb) => subscribePalletsEnRango(desde, hasta, cb),
    [desde.getTime(), hasta.getTime()],
    [],
  )

  return { pallets, loading, desde, hasta }
}
