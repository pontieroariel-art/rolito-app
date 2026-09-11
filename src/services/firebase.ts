import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, initializeAuth, inMemoryPersistence, connectAuthEmulator } from 'firebase/auth'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { marcarSesionVerComo } from './observability'

const apiKey            = import.meta.env.VITE_FIREBASE_API_KEY
const authDomain        = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
const projectId         = import.meta.env.VITE_FIREBASE_PROJECT_ID
const storageBucket     = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
const appId             = import.meta.env.VITE_FIREBASE_APP_ID

if (!apiKey || !authDomain || !projectId) {
  throw new Error(
    'Firebase: faltan variables de entorno. ' +
    'Verificá que .env.local tenga VITE_FIREBASE_API_KEY, ' +
    'VITE_FIREBASE_AUTH_DOMAIN y VITE_FIREBASE_PROJECT_ID.'
  )
}

export const firebaseConfig = { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }

const app = initializeApp(firebaseConfig)

// ── "Ver como usuario" (2026-09-10) ───────────────────────────────────────────
// El super_admin abre, desde Usuarios, una pestaña nueva con
// `/#ver-como=<custom token>` (lo emite la callable crearTokenImpersonacion).
// Esa pestaña tiene que decidirlo ANTES de inicializar Auth, porque la sesión
// va con persistencia en memoria: así no pisa la sesión del admin que vive en
// IndexedDB y comparten las demás pestañas, y se termina al cerrar la pestaña.
// El token queda en sessionStorage (sobrevive un F5 mientras no venza — 1 h) y
// se saca de la URL para que no quede en el historial. La caché de Firestore
// también va en memoria: la persistente es por origen, no por usuario, y
// mezclaría lo que ve el admin con lo que ve la persona observada.
const VER_COMO_KEY = 'rolito.verComo'

function leerTokenVerComo(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const m = /(?:^#|&)ver-como=([^&]+)/.exec(window.location.hash)
    if (m) {
      const token = decodeURIComponent(m[1])
      window.sessionStorage.setItem(VER_COMO_KEY, token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      return token
    }
    return window.sessionStorage.getItem(VER_COMO_KEY)
  } catch {
    return null
  }
}

const tokenVerComo = leerTokenVerComo()

/** Sesión "Ver como" activa en esta pestaña (solo lectura). `null` en una sesión normal. */
export const SESION_VER_COMO: { readonly token: string } | null = tokenVerComo ? { token: tokenVerComo } : null

if (SESION_VER_COMO) {
  marcarSesionVerComo()
  // Clase raíz para que los headers sticky bajen la altura del banner (ver index.css).
  document.documentElement.classList.add('ver-como')
}

export const auth = SESION_VER_COMO
  ? initializeAuth(app, { persistence: inMemoryPersistence })
  : getAuth(app)
export const db = initializeFirestore(app, {
  localCache: SESION_VER_COMO
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
// Storage: hoy solo se usa para las fotos del catálogo de productos (botonera de
// venta). El bucket ya está en firebaseConfig.
export const storage = getStorage(app)

// `npm run dev` (import.meta.env.DEV) apunta a los emuladores locales en vez
// de a producción — así las pruebas locales (arrastrar pedidos, confirmar
// despachos, loguearse) no tocan datos ni usuarios reales. Se elimina por
// completo del bundle de producción (`npm run build`), donde DEV es `false`.
// Requiere `npm run emulators` corriendo (ver CLAUDE.md).
if (import.meta.env.DEV) {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectStorageEmulator(storage, 'localhost', 9199)
}

// App Check queda listo pero inactivo hasta registrar la Web app en Firebase
// Console (App Check → reCAPTCHA v3) y cargar VITE_RECAPTCHA_SITE_KEY. Sin esa
// key no se inicializa nada — ningún cliente/build actual se ve afectado. No
// se activa en dev/emulador (los tokens de App Check no aplican ahí).
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY
if (recaptchaSiteKey && !import.meta.env.DEV) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}
