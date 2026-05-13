import { useState, useEffect } from 'react'
import { subscribeCamiones } from '../services/flotaService'
import { Camion } from '../types'

export function useFlota() {
  const [camiones, setCamiones] = useState<Camion[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    const unsub = subscribeCamiones((data) => {
      setCamiones(data)
      setLoading(false)
    })
    return unsub
  }, [])

  return { camiones, loading }
}
