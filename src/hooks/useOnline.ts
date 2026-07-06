import { useState, useEffect } from 'react'

// Estado de conexión del navegador. No garantiza llegada a Firestore, pero
// alcanza para avisarle al chofer que está sin señal (y que sus cambios se
// encolan y sincronizan al reconectar).
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const goOnline  = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
