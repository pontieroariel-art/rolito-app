import { useState, useEffect, useCallback, useRef } from 'react'
import { PedidoRecurrente } from '../types'
import { getRecurrenteByClient, saveRecurrente } from '../services/recurrenteService'

export function useRecurrente(clientId: string | undefined) {
  // undefined = cargando, null = no configurado, PedidoRecurrente = configurado
  const [recurrente, setRecurrente] = useState<PedidoRecurrente | null | undefined>(undefined)

  // Ref actualizada en cada render — a diferencia de comparar contra `clientId`
  // capturado en el mismo closure de `save` (que es tautológico: ambos valores
  // vienen de la misma instancia y nunca difieren), esto sí detecta si el
  // clientId cambió mientras un guardado anterior seguía en vuelo.
  const clientIdRef = useRef(clientId)
  useEffect(() => { clientIdRef.current = clientId }, [clientId])

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
    if (clientIdRef.current !== savedForId) return
    const updated = await getRecurrenteByClient(savedForId)
    if (clientIdRef.current !== savedForId) return
    setRecurrente(updated)
  }, [clientId])

  return { recurrente, save }
}
