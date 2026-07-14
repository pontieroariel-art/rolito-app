import { useEffect, useState, DependencyList } from 'react'

export interface FirestoreSubscriptionResult<T> {
  data:    T
  loading: boolean
  error:   boolean
}

// Hook genérico para "suscribirse a Firestore en tiempo real y exponer
// {data, loading, error}" — antes este patrón (setup de onSnapshot, cleanup,
// manejo de loading/error) estaba copiado con variaciones menores en
// useOrders, useVisitas, useFlota y useZonas. `subscribe` es la función de
// servicio ya existente (ej. subscribeKanbanOrders); `deps` dispara una
// nueva suscripción cuando cambia (ej. el uid del usuario).
export function useFirestoreSubscription<T>(
  subscribe: (cb: (data: T) => void, onError?: (err: Error) => void) => () => void,
  deps:      DependencyList,
  initial:   T,
): FirestoreSubscriptionResult<T> {
  const [data,    setData]    = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    const unsub = subscribe(
      (d) => { setData(d); setLoading(false); setError(false) },
      ()  => { setLoading(false); setError(true) },
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}
