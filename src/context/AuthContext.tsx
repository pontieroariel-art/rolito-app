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
        // Revalida que este uid siga siendo el vigente: si en el medio otro
        // usuario ya inició sesión (dispositivo compartido, ej. la tablet de
        // choferes con login por DNI+PIN en cambio de turno), esta respuesta
        // tardía del perfil anterior no debe pisar la sesión ya activa.
        if (uid !== lastUidRef.current) return
        dispatch({ type: 'RESOLVED', user: profile })
      } catch (err) {
        console.error('AuthContext: error al cargar el perfil', err)
        if (uid !== lastUidRef.current) return
        // Un error transitorio (offline, timeout) no debería desloguear a un
        // usuario que ya tenía una sesión activa con este mismo uid — antes
        // cualquier falla de red se trataba igual que un logout real.
        if (userRef.current?.uid === uid) return
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
        const d          = snap.data()
        const newRol     = (d.rol ?? d.role ?? 'cliente') as UserProfile['rol']
        const newEst     = (d.estado ?? 'activo') as UserProfile['estado']
        const newListaId = d.listaPreciosId as string | undefined
        const newPrecios = d.preciosCustom  as Record<string, number> | undefined
        const newAddrs   = d.addresses      as UserProfile['addresses'] | undefined
        const newSistemas = d.sistemasPermitidos as UserProfile['sistemasPermitidos']
        const newPestanas = d.pestanasPermitidas as UserProfile['pestanasPermitidas']
        // Favoritos del checklist de tipos de reparación (técnico de calle) —
        // se tildan/destildan en vivo desde el modal de Registrar trabajo, sin
        // recargar la página.
        const newFavoritos = d.tiposFavoritos as UserProfile['tiposFavoritos']
        const cur        = userRef.current
        if (!cur) return
        const changed =
          newRol     !== cur.rol    ||
          newEst     !== cur.estado ||
          newListaId !== cur.listaPreciosId ||
          JSON.stringify(newPrecios)   !== JSON.stringify(cur.preciosCustom) ||
          JSON.stringify(newAddrs)     !== JSON.stringify(cur.addresses) ||
          JSON.stringify(newSistemas)  !== JSON.stringify(cur.sistemasPermitidos) ||
          JSON.stringify(newPestanas)  !== JSON.stringify(cur.pestanasPermitidas) ||
          JSON.stringify(newFavoritos) !== JSON.stringify(cur.tiposFavoritos)
        if (!changed) return
        dispatch({ type: 'RESOLVED', user: {
          ...cur,
          rol:            newRol,
          estado:         newEst,
          listaPreciosId: newListaId,
          preciosCustom:  newPrecios,
          ...(newAddrs !== undefined ? { addresses: newAddrs } : {}),
          sistemasPermitidos: newSistemas,
          pestanasPermitidas: newPestanas,
          tiposFavoritos: newFavoritos,
        }})
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
