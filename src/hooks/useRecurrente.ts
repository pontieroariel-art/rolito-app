import { useState, useEffect, useCallback } from 'react'
import { PedidoRecurrente } from '../types'
import { getRecurrenteByClient, saveRecurrente } from '../services/recurrenteService'

export function useRecurrente(clientId: string | undefined) {
  // undefined = cargando, null = no configurado, PedidoRecurrente = configurado
  const [recurrente, setRecurrente] = useState<PedidoRecurrente | null | undefined>(undefined)

  useEffect(() => {
    if (!clientId) return
    getRecurrenteByClient(clientId).then(setRecurrente)
  }, [clientId])

  const save = useCallback(async (
    data: Omit<PedidoRecurrente, 'id' | 'createdAt' | 'ultimaGeneracion'>,
  ) => {
    if (!clientId) return
    await saveRecurrente(clientId, data)
    const updated = await getRecurrenteByClient(clientId)
    setRecurrente(updated)
  }, [clientId])

  return { recurrente, save }
}
