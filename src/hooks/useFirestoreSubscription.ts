import { useEffect, useState, DependencyList } from 'react'

export interface FirestoreSubscriptionResult<T> {
  data:     T
  loading:  boolean
  error:    boolean
  timedOut: boolean
}

// Hook genérico para "suscribirse a Firestore en tiempo real y exponer
// {data, loading, error}" — antes este patrón (setup de onSnapshot, cleanup,
// manejo de loading/error) estaba copiado con variaciones menores en
// useOrders, useVisitas, useFlota y useZonas. `subscribe` es la función de
// servicio ya existente (ej. subscribeKanbanOrders); `deps` dispara una
// nueva suscripción cuando cambia (ej. el uid del usuario).
//
// `timedOut`: si el listener de Firestore nunca llega a conectar (wifi sin
// internet real, red que bloquea el long-polling), onSnapshot no dispara ni
// datos ni error — se queda reintentando en silencio para siempre y `loading`
// no se apagaría nunca. timeoutMs le da a la UI una salida ("no se pudo
// conectar, reintentar") en vez de un spinner infinito.
export function useFirestoreSubscription<T>(
  subscribe: (cb: (data: T) => void, onError?: (err: Error) => void) => () => void,
  deps:      DependencyList,
  initial:   T,
  timeoutMs = 15000,
): FirestoreSubscriptionResult<T> {
  const [data,     setData]     = useState<T>(initial)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    setTimedOut(false)

    const timer = setTimeout(() => setTimedOut(true), timeoutMs)

    const unsub = subscribe(
      (d) => { clearTimeout(timer); setData(d); setLoading(false); setError(false) },
      ()  => { clearTimeout(timer); setLoading(false); setError(true) },
    )
    return () => { clearTimeout(timer); unsub() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, timedOut }
}
