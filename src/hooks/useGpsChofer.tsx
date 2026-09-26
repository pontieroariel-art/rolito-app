import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useDriverOrders } from '@/hooks/useOrders'
import { updateDriverLocation, deactivateDriverLocation } from '@/services/locationService'
import { reportError } from '@/services/observability'
import { hayQueEnviarGps, type EnvioGps } from '@/utils/envioGps'

// GPS del chofer para TODAS sus pantallas (2026-09-26, auditoría del chofer, A6).
// Antes vivía en el inicio y en el mapa por separado: al ir a Vender, Entregar o
// Cobrar el cleanup lo apagaba (activo:false) y el chofer desaparecía del mapa en
// vivo justo mientras entregaba. Ahora lo monta una sola vez ChoferShell, el
// contenedor de las rutas /chofer/*, y se apaga al terminar las entregas o al
// salir del módulo. Mismo envío que antes: cada 10 s, solo con la app al frente,
// una posición en vuelo a la vez (sin señal no se acumulan escrituras).
// Parado no se reescribe la misma coordenada: solo con 40 m o un minuto (R5).

export type EstadoGps = 'idle' | 'ok' | 'error'
interface ValorGps { estado: EstadoGps; posicion: { lat: number; lng: number } | null; hayPendientes: boolean }

const GpsContext = createContext<ValorGps>({ estado: 'idle', posicion: null, hayPendientes: false })

export function GpsChoferProvider({ children }: { children: ReactNode }) {
  const { user, verComo } = useAuth()
  const { orders } = useDriverOrders()
  const hayPendientes = useMemo(() => orders.some((o) => o.status !== 'entregado' && o.status !== 'cancelado'), [orders])
  const [estado, setEstado] = useState<EstadoGps>('idle')
  const [posicion, setPosicion] = useState<{ lat: number; lng: number } | null>(null)

  const nombreRef = useRef('')
  const telefonoRef = useRef('')
  useEffect(() => {
    nombreRef.current = user?.nombreContacto || user?.nombre || ''
    telefonoRef.current = user?.telefono || user?.phone || ''
  })
  const enVueloRef = useRef(false)
  const genRef = useRef(0)
  const ultimoEnvioRef = useRef<EnvioGps | null>(null)

  useEffect(() => {
    // En una sesión "Ver como" (super_admin mirando, solo lectura) no se manda GPS.
    if (!hayPendientes || !user?.email || !navigator.geolocation || verComo) return
    const email = user.email
    const gen = ++genRef.current
    // Al (re)activarse el primer envío sale siempre: vuelve a poner activo:true.
    ultimoEnvioRef.current = null

    const send = () => {
      if (document.visibilityState === 'hidden') return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setEstado('ok')
          // Mismo objeto si no cambió: no re-renderiza el inicio ni el mapa cada 10 s (R10).
          setPosicion((p) => (p && p.lat === pos.coords.latitude && p.lng === pos.coords.longitude ? p : { lat: pos.coords.latitude, lng: pos.coords.longitude }))
          if (enVueloRef.current) return
          const { latitude: lat, longitude: lng } = pos.coords
          const ahora = Date.now()
          if (!hayQueEnviarGps(ultimoEnvioRef.current, lat, lng, ahora)) return
          enVueloRef.current = true
          updateDriverLocation(email, lat, lng, nombreRef.current, telefonoRef.current)
            .then(() => { if (genRef.current === gen) ultimoEnvioRef.current = { lat, lng, en: ahora } })
            .catch(() => {})
            .finally(() => { enVueloRef.current = false })
        },
        () => setEstado('error'),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      )
    }

    send()
    const id = setInterval(send, 10_000)
    const onVisible = () => { if (document.visibilityState === 'visible') send() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      // Microtask: si ya montó un efecto nuevo (gen cambió), no desactivar.
      void Promise.resolve().then(() => {
        // Leer el .current actual (no una copia) es justamente el objetivo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (genRef.current === gen) {
          deactivateDriverLocation(email).catch((err) => reportError(err, { origen: 'useGpsChofer' }))
        }
      })
    }
  }, [hayPendientes, user?.email, verComo])

  const valor = useMemo(() => ({ estado, posicion, hayPendientes }), [estado, posicion, hayPendientes])
  return <GpsContext.Provider value={valor}>{children}</GpsContext.Provider>
}

export const useGpsChofer = (): ValorGps => useContext(GpsContext)
