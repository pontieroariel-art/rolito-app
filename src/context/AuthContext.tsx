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
import { auth } from '../services/firebase'
import { getUserDocument, createUserDocument } from '../services/userService'
import { UserProfile } from '../types'

// ── Reducer ───────────────────────────────────────────────────────────────────

type State = {
  loading: boolean        // true  = Firebase todavía no respondió
  user: UserProfile | null
}

type Action = { type: 'RESOLVED'; user: UserProfile | null }

function authReducer(_: State, action: Action): State {
  if (action.type === 'RESOLVED') return { loading: false, user: action.user }
  return { loading: true, user: null }
}

// ── Contexto ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  loading: boolean
  user: UserProfile | null
  setUser: (user: UserProfile | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, { loading: true, user: null })

  // Evita reprocesar el mismo uid si Firebase llama dos veces (StrictMode)
  const lastUidRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      const uid = firebaseUser?.uid ?? null

      if (uid === lastUidRef.current) return   // mismo usuario, no re-procesar
      lastUidRef.current = uid

      if (!firebaseUser || !firebaseUser.email) {
        dispatch({ type: 'RESOLVED', user: null })
        return
      }

      try {
        let profile = await getUserDocument(firebaseUser.uid)
        if (!profile) {
          await createUserDocument(firebaseUser.uid, {
            email:  firebaseUser.email,
            nombre: firebaseUser.displayName ?? '',
            phone:  '',
          })
          profile = await getUserDocument(firebaseUser.uid)
        }
        dispatch({ type: 'RESOLVED', user: profile })
      } catch {
        dispatch({ type: 'RESOLVED', user: null })
      }
    })
    return unsub
  }, [])  // sin dependencias: se suscribe una sola vez

  const setUser = useCallback((user: UserProfile | null) => {
    dispatch({ type: 'RESOLVED', user })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ loading: state.loading, user: state.user, setUser }),
    [state.loading, state.user, setUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
