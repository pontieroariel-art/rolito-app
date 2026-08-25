import { useEffect, useState } from 'react'
import { getHeladerasStats } from '../services/heladeraService'
import { EstadoHeladera } from '../types'

// Conteo agregado, no en tiempo real — para paneles resumen (tablero de
// directores) que solo necesitan los totales por estado. Ver
// getHeladerasStats para por qué esto no usa useHeladeras() (esa sí trae
// todos los documentos, pensada para el listado de Equipos).
export function useHeladerasStats() {
  const [stats, setStats] = useState<Record<EstadoHeladera, number> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let activo = true
    getHeladerasStats().then((s) => {
      if (activo) { setStats(s); setLoading(false) }
    })
    return () => { activo = false }
  }, [])

  return { stats, loading }
}
