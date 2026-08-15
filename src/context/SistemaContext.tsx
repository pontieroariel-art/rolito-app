import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { Sistema, sistemasDeUsuario } from '../utils/sistemas'

interface SistemaContextValue {
  sistemasDisponibles: Sistema[]
  sistemaActual:       Sistema | null
  elegirSistema:       (s: Sistema) => void
  cambiarSistema:      () => void
  necesitaEleccion:    boolean
}

const SistemaContext = createContext<SistemaContextValue | null>(null)

export function SistemaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [sistemaActual, setSistemaActual] = useState<Sistema | null>(null)

  const sistemasDisponibles = user ? sistemasDeUsuario(user) : []

  useEffect(() => {
    if (!user?.uid) {
      setSistemaActual(null)
      return
    }
    const disponibles = sistemasDeUsuario(user)

    // Un solo sistema → se selecciona automáticamente
    if (disponibles.length === 1) {
      setSistemaActual(disponibles[0])
      return
    }
    // Múltiples: restaurar desde localStorage
    const stored = localStorage.getItem(`sistema_${user.uid}`) as Sistema | null
    setSistemaActual(stored && disponibles.includes(stored) ? stored : null)
    // sistemasPermitidosKey (no el array en sí, para no recalcular por
    // cambios de referencia) hace que esto se re-evalúe si un admin le
    // recorta los sistemas a este usuario mientras tiene la sesión abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.rol, user?.sistemasPermitidos?.join(',')])

  const elegirSistema = (s: Sistema) => {
    setSistemaActual(s)
    if (user?.uid) {
      localStorage.setItem(`sistema_${user.uid}`, s)
    }
  }

  const cambiarSistema = () => {
    setSistemaActual(null)
    if (user?.uid) {
      localStorage.removeItem(`sistema_${user.uid}`)
    }
  }

  const necesitaEleccion = sistemasDisponibles.length > 1 && !sistemaActual

  return (
    <SistemaContext.Provider value={{ sistemasDisponibles, sistemaActual, elegirSistema, cambiarSistema, necesitaEleccion }}>
      {children}
    </SistemaContext.Provider>
  )
}

export function useSistema(): SistemaContextValue {
  const ctx = useContext(SistemaContext)
  if (!ctx) throw new Error('useSistema debe usarse dentro de SistemaProvider')
  return ctx
}
