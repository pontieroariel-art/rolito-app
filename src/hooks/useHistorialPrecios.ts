import { useState, useEffect, useCallback } from 'react'
import { HistorialPrecioEvento } from '../types'
import { getHistorialCliente, getAllHistorial } from '../services/historialPreciosService'

export function useHistorialCliente(clientId: string | null) {
  const [historial, setHistorial] = useState<HistorialPrecioEvento[]>([])
  const [loading,   setLoading]   = useState(false)

  const load = useCallback(() => {
    if (!clientId) return
    setLoading(true)
    getHistorialCliente(clientId)
      .then((data) => setHistorial(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  return { historial, loading, load }
}

export function useAllHistorial() {
  const [historial, setHistorial] = useState<HistorialPrecioEvento[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    getAllHistorial()
      .then((data) => setHistorial(data))
      .catch((err) => {
        console.error('useAllHistorial:', err)
        setError(err?.message ?? 'Error al cargar historial')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  return { historial, loading, error, reload }
}
