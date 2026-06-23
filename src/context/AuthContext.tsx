import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  ReactNode,
} from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { onSnapshot, doc } from 'firebase/firestore'
import { auth } from '../services/firebase'
import { db } from '../services/firebase'
import { getUserDocument, createUserDocument } from '../services/userService'
import { UserProfile } from '../types'

// ── Reducer ───────────────────────────────────────────────────────────────────

type State = {
  isInitializing: boolean   // true = todavía no corrió onAuthStateChanged + Firestore
  user: UserProfile | null
}

type Action = { type: 'RESOLVED'; user: UserProfile | null }

function authReducer(_: State, action: Action): State {
  if (action.type === 'RESOLVED') return { isInitializing: false, user: action.user }
  return { isInitializing: true, user: null }
}

// ── Contexto ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  isInitializing: boolean
  user: UserProfile | null
  setUser: (user: UserProfile | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, { isInitializing: true, user: null })

  // Evita reprocesar el mismo uid si Firebase llama dos veces
  const lastUidRef = useRef<string | null | undefined>(undefined)
  // Ref para acceder al usuario actual dentro de closures sin stale state
  const userRef = useRef<UserProfile | null>(null)
  userRef.current = state.user

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      const uid = firebaseUser?.uid ?? null

      if (uid === lastUidRef.current) return
      lastUidRef.current = uid

      if (!firebaseUser || !firebaseUser.email) {
        dispatch({ type: 'RESOLVED', user: null })
        return
      }

      try {
        let profile = await getUserDocument(firebaseUser.uid)
        if (!profile) {
          await createUserDocument(firebaseUser.uid, {
            email:          firebaseUser.email ?? '',
            razonSocial:    '',
            nombreContacto: firebaseUser.displayName ?? '',
            cuit:           '',
            phone:          '',
          })
          profile = await getUserDocument(firebaseUser.uid)
        }
        dispatch({ type: 'RESOLVED', user: profile })
      } catch {
        dispatch({ type: 'RESOLVED', user: null })
      }
    })
    return unsub
  }, [])

  // Detecta cambios de rol/estado en tiempo real para sesiones activas
  useEffect(() => {
    if (!state.user?.uid) return
    return onSnapshot(
      doc(db, 'users', state.user.uid),
      (snap) => {
        if (!snap.exists()) return
        const d       = snap.data()
        const newRol  = (d.rol ?? d.role ?? 'cliente') as UserProfile['rol']
        const newEst  = (d.estado ?? 'activo') as UserProfile['estado']
        const cur     = userRef.current
        if (!cur || newRol === cur.rol && newEst === cur.estado) return
        dispatch({ type: 'RESOLVED', user: { ...cur, rol: newRol, estado: newEst } })
      },
      (err) => console.error('AuthContext profile snapshot error:', err),
    )
  }, [state.user?.uid])

  const setUser = useCallback((user: UserProfile | null) => {
    dispatch({ type: 'RESOLVED', user })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ isInitializing: state.isInitializing, user: state.user, setUser }),
    [state.isInitializing, state.user, setUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
