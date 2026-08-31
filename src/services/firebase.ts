import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

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

export const auth = getAuth(app)
export const db   = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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
