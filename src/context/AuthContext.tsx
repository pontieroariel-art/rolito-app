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
import { auth, SESION_VER_COMO } from '../services/firebase'
import { db } from '../services/firebase'
import { getUserDocument, createUserDocument } from '../services/userService'
import { reportError, setObservabilityUser } from '../services/observability'
import { iniciarSesionVerComo } from '../services/impersonacionService'
import { UserProfile } from '../types'

// ── Reducer ───────────────────────────────────────────────────────────────────

type State = {
  isInitializing: boolean   // true = todavía no corrió onAuthStateChanged + Firestore
  user: UserProfile | null
  // Sesión "Ver como usuario" (2026-09-10): el super_admin que está mirando
  // la app con la sesión de `user`. Viene del claim `impersonadoPor` del
  // custom token; con esto puesto la sesión es de solo lectura.
  verComo: VerComo | null
}

export interface VerComo {
  por:       string
  porNombre: string
}

type Action = { type: 'RESOLVED'; user: UserProfile | null; verComo?: VerComo | null }

function authReducer(state: State, action: Action): State {
  if (action.type === 'RESOLVED') {
    return {
      isInitializing: false,
      user:    action.user,
      verComo: action.user ? (action.verComo === undefined ? state.verComo : action.verComo) : null,
    }
  }
  return { isInitializing: true, user: null, verComo: null }
}

// ── Contexto ──────────────────────────────────────────────────────────────────

interface AuthContextValue {
  isInitializing: boolean
  user: UserProfile | null
  /** Quién está detrás de una sesión "Ver como" (null en una sesión normal). */
  verComo: VerComo | null
  setUser: (user: UserProfile | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, { isInitializing: true, user: null, verComo: null })

  // Evita reprocesar el mismo uid si Firebase llama dos veces
  const lastUidRef = useRef<string | null | undefined>(undefined)
  // Ref para acceder al usuario actual dentro de closures sin stale state
  const userRef = useRef<UserProfile | null>(null)
  userRef.current = state.user
  // Pestaña "Ver como": el canje del custom token se intenta una sola vez.
  const verComoIntentadoRef = useRef(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      const uid = firebaseUser?.uid ?? null

      if (uid === lastUidRef.current) return
      lastUidRef.current = uid

      if (!firebaseUser || !firebaseUser.email) {
        // Pestaña "Ver como" (sesión en memoria, arranca vacía): canjear el
        // token antes de decidir que no hay sesión. Si falla (venció tras un
        // F5 de más de una hora, revocado), AppContent muestra "la vista
        // terminó" porque SESION_VER_COMO existe y user queda null.
        if (SESION_VER_COMO && !verComoIntentadoRef.current) {
          verComoIntentadoRef.current = true
          iniciarSesionVerComo().catch((err) => {
            reportError(err, { origen: 'AuthContext.verComo' })
            dispatch({ type: 'RESOLVED', user: null })
          })
          return
        }
        dispatch({ type: 'RESOLVED', user: null })
        return
      }

      try {
        // Claims del token: en una sesión "Ver como" traen quién está mirando.
        let verComo: VerComo | null = null
        if (SESION_VER_COMO) {
          const claims = (await firebaseUser.getIdTokenResult()).claims
          if (typeof claims.impersonadoPor === 'string') {
            verComo = { por: claims.impersonadoPor, porNombre: String(claims.impersonadoPorNombre ?? '') }
          }
        }
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
        dispatch({ type: 'RESOLVED', user: profile, verComo })
      } catch (err) {
        reportError(err, { origen: 'AuthContext.cargarPerfil', uid })
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

  // Asocia el usuario logueado (uid + rol, sin PII) con los reportes de errores,
  // para poder rastrear a qué operario/rol le pasó cada falla en producción.
  const observedUid = state.user?.uid
  const observedRol = state.user?.rol
  const observedVerComoPor = state.verComo?.por ?? null
  useEffect(() => {
    setObservabilityUser(observedUid ? { uid: observedUid, rol: observedRol, verComoPor: observedVerComoPor } : null)
  }, [observedUid, observedRol, observedVerComoPor])

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
        // Precios de Tango del cliente (los deja la sync): el perfil y el
        // pedido nuevo los leen del usuario, así que un cambio tiene que
        // reflejarse en vivo.
        const newPreciosTango = d.preciosTango as UserProfile['preciosTango']
        const newListaTango   = d.listaTango   as UserProfile['listaTango']
        const newListaTangoNombre = d.listaTangoNombre as UserProfile['listaTangoNombre']
        const newAddrs   = d.addresses      as UserProfile['addresses'] | undefined
        const newSistemas = d.sistemasPermitidos as UserProfile['sistemasPermitidos']
        const newPestanas = d.pestanasPermitidas as UserProfile['pestanasPermitidas']
        // Favoritos del checklist de tipos de reparación (técnico de calle) —
        // se tildan/destildan en vivo desde el modal de Registrar trabajo, sin
        // recargar la página.
        const newFavoritos = d.tiposFavoritos as UserProfile['tiposFavoritos']
        // Clientes que este usuario de staff ocultó en su propio mapa de
        // Planificación (ver MapaPlanificacion.tsx) — mismo motivo que
        // tiposFavoritos: se togglea desde otra pantalla y tiene que
        // reflejarse en vivo sin recargar.
        const newOcultosMapa = d.clientesOcultosMapa as UserProfile['clientesOcultosMapa']
        // Planta del operario de producción — reasignar a alguien de Don
        // Torcuato a Merlo tiene que reflejarse en la tablet sin relogin.
        const newPlanta = d.planta as UserProfile['planta']
        // Roles adicionales (caja/muelle/seguridad) y permiso de autorizar
        // anulaciones: los da el super_admin desde Usuarios y antes exigían
        // volver a loguearse para verse (2026-09-10).
        const newRolesExtra = d.rolesExtra as UserProfile['rolesExtra']
        const newAutorizaAnulaciones = d.autorizaAnulaciones as UserProfile['autorizaAnulaciones']
        const cur        = userRef.current
        if (!cur) return
        const changed =
          newRol     !== cur.rol    ||
          newEst     !== cur.estado ||
          newPlanta  !== cur.planta ||
          newAutorizaAnulaciones !== cur.autorizaAnulaciones ||
          JSON.stringify(newRolesExtra) !== JSON.stringify(cur.rolesExtra) ||
          JSON.stringify(newPreciosTango) !== JSON.stringify(cur.preciosTango) ||
          JSON.stringify(newListaTango)   !== JSON.stringify(cur.listaTango) ||
          JSON.stringify(newListaTangoNombre) !== JSON.stringify(cur.listaTangoNombre) ||
          JSON.stringify(newAddrs)     !== JSON.stringify(cur.addresses) ||
          JSON.stringify(newSistemas)  !== JSON.stringify(cur.sistemasPermitidos) ||
          JSON.stringify(newPestanas)  !== JSON.stringify(cur.pestanasPermitidas) ||
          JSON.stringify(newFavoritos) !== JSON.stringify(cur.tiposFavoritos) ||
          JSON.stringify(newOcultosMapa) !== JSON.stringify(cur.clientesOcultosMapa)
        if (!changed) return
        dispatch({ type: 'RESOLVED', user: {
          ...cur,
          rol:            newRol,
          estado:         newEst,
          preciosTango:   newPreciosTango,
          listaTango:     newListaTango,
          listaTangoNombre: newListaTangoNombre,
          planta:         newPlanta,
          rolesExtra:     newRolesExtra,
          autorizaAnulaciones: newAutorizaAnulaciones,
          ...(newAddrs !== undefined ? { addresses: newAddrs } : {}),
          sistemasPermitidos: newSistemas,
          pestanasPermitidas: newPestanas,
          tiposFavoritos: newFavoritos,
          clientesOcultosMapa: newOcultosMapa,
        }})
      },
      (err) => console.error('AuthContext profile snapshot error:', err),
    )
  }, [state.user?.uid])

  const setUser = useCallback((user: UserProfile | null) => {
    dispatch({ type: 'RESOLVED', user })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ isInitializing: state.isInitializing, user: state.user, verComo: state.verComo, setUser }),
    [state.isInitializing, state.user, state.verComo, setUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
