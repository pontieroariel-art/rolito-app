import { useEffect, useState } from 'react'
import { tieneRol } from '@/utils/roles'
import { subscribeRemitosCargaChoferHoy } from '../services/remitoCargaService'
import { RemitoCarga } from '../types'
import { useAuth } from '../context/AuthContext'

// Remitos de carga de HOY del chofer logueado — su "carga del día" real (lo
// que caja despachó a su camión) y, de paso, la fuente del camión asignado.
export function useRemitosCargaChofer() {
  const { user } = useAuth()
  const [remitos, setRemitos] = useState<RemitoCarga[]>([])

  useEffect(() => {
    if (!user || !tieneRol(user, 'chofer')) return
    return subscribeRemitosCargaChoferHoy(user.uid, setRemitos)
  }, [user])

  return { remitos }
}
