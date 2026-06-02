import { useState, useEffect } from 'react'
import { ZonaProhibida, subscribeZonas } from '../services/zonasService'

export function useZonasProhibidas() {
  const [zonas, setZonas] = useState<ZonaProhibida[]>([])
  useEffect(() => subscribeZonas(setZonas), [])
  return { zonas }
}
