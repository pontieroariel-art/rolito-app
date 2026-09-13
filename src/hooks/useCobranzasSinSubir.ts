import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'

/**
 * Cuántas cobranzas del día quedaron guardadas en el teléfono sin subir
 * (escrituras pendientes de Firestore). El dato ya lo calculaba el inicio; se
 * extrae acá para que el aviso viva en el header y se vea en TODAS las pantallas
 * del supervisor: en la calle, la duda "¿se guardó o no se guardó?" aparece
 * después de cobrar, no cuando se vuelve al inicio.
 */
export function useCobranzasSinSubir(): number {
  const { user } = useAuth()
  const fecha = useFechaDelDia()
  const [sinSubir, setSinSubir] = useState(0)

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, () => {}, setSinSubir)
  }, [user, fecha])

  return sinSubir
}
