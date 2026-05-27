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
    const savedForId = clientId  // capturar al momento del llamado
    await saveRecurrente(savedForId, data)
    // Si el clientId cambió mientras guardábamos, no actualizar estado
    if (clientId !== savedForId) return
    const updated = await getRecurrenteByClient(savedForId)
    if (clientId !== savedForId) return
    setRecurrente(updated)
  }, [clientId])

  return { recurrente, save }
}
