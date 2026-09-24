import { initializeApp } from 'firebase/app'
import { initializeAppCheck, CustomProvider, ReCaptchaV3Provider, getToken as getTokenAppCheck, type AppCheck } from 'firebase/app-check'
import { getAuth, initializeAuth, inMemoryPersistence, connectAuthEmulator } from 'firebase/auth'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  connectFirestoreEmulator,
} from 'firebase/firestore'
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

export const app = initializeApp(firebaseConfig)

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
// Televisor (2026-09-21): el navegador de las Samsung (TizenBrowser, agente
// "SMART-TV"/"Tizen") no sostiene el canal en vivo que usa Firestore y la app
// quedaba en "sin conexión" / `unavailable` sin pasar del login. En una tele se
// fuerza el canal por long polling y la caché en memoria (el almacenamiento
// local de esos navegadores es poco confiable). `?tele=1` en la URL fuerza el
// mismo modo desde cualquier aparato, para probarlo o para un stick raro.
export const ES_TELE: boolean = (() => {
  if (typeof navigator === 'undefined') return false
  if (/[?&]tele=1/.test(window.location.search)) return true
  return /SMART-TV|Tizen|Web0S|WebOS|BRAVIA|AFTT|AFTS|CrKey/i.test(navigator.userAgent)
})()

export const db = initializeFirestore(app, {
  localCache: SESION_VER_COMO || ES_TELE
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  // `useFetchStreams: false`: en la Samsung real (SamsungBrowser 4.0 sobre
  // Chrome 120) el long polling solo no alcanzó ("client is offline" mientras
  // la lectura por REST respondía en 0,6 s): el canal usa fetch con streams y
  // ese navegador lo deja colgado. Con XHR común, sin streams, conecta.
  ...(ES_TELE ? { experimentalForceLongPolling: true, useFetchStreams: false } : {}),
})
// Storage NO se inicializa acá: va por import() dinámico en services/storage.ts
// (obtenerStorage), que también conecta su emulador, así @firebase/storage no
// entra al chunk inicial de todos los logins (auditoría de bundle 2026-09-14).

// `npm run dev` (import.meta.env.DEV) apunta a los emuladores locales en vez
// de a producción — así las pruebas locales (arrastrar pedidos, confirmar
// despachos, loguearse) no tocan datos ni usuarios reales. Se elimina por
// completo del bundle de producción (`npm run build`), donde DEV es `false`.
// Requiere `npm run emulators` corriendo (ver CLAUDE.md).
if (import.meta.env.DEV) {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
}

// App Check queda listo pero inactivo hasta registrar la Web app en Firebase
// Console (App Check → reCAPTCHA v3) y cargar VITE_RECAPTCHA_SITE_KEY. Sin esa
// key no se inicializa nada — ningún cliente/build actual se ve afectado. No
// se activa en dev/emulador (los tokens de App Check no aplican ahí).
//
// En una TELE el reCAPTCHA no resuelve nunca (2026-09-21, Samsung real:
// Firestore se quedaba esperando el token de App Check y caía en "client is
// offline"). Con App Check en enforcement (2026-09-22) la tele necesita un
// token igual, así que en modo tele el proveedor es propio: le pide el token
// al servidor (callable tokenAppCheckTele) con la CLAVE de la tele, que llega
// una sola vez por la URL (?claveTele=...) y queda en localStorage. Sin clave
// no se inicializa App Check y la tele queda afuera hasta que se cargue.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY
/** Instancia de App Check (null en dev, o en una tele sin clave). */
export let appCheck: AppCheck | null = null
if (recaptchaSiteKey && !import.meta.env.DEV) {
  const claveTele = ES_TELE ? claveDeLaTele() : null
  if (!ES_TELE) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } else if (claveTele) {
    appCheck = initializeAppCheck(app, {
      provider: new CustomProvider({ getToken: () => pedirTokenTele(claveTele) }),
      isTokenAutoRefreshEnabled: true,
    })
    vigilarTokenTele(appCheck)
  }
}

/**
 * Estado del token de App Check de la tele, para /diagnostico-tele (la tele
 * no tiene consola). Lo mantiene `vigilarTokenTele`.
 */
export const estadoTokenTele: { vence: Date | null; ultimaRenovacion: Date | null; ultimoError: string; revisiones: number } =
  { vence: null, ultimaRenovacion: null, ultimoError: '', revisiones: 0 }

const REVISAR_CADA_MS  = 5 * 60_000
const RENOVAR_ANTES_MS = 12 * 3_600_000

/** `exp` del JWT de App Check, como Date; null si no se puede leer. */
function vencimientoDelToken(token: string): Date | null {
  try {
    const cuerpo = token.split('.')[1] ?? ''
    const json = JSON.parse(atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof json.exp === 'number' ? new Date(json.exp * 1000) : null
  } catch {
    return null
  }
}

/**
 * Vigilante del token en la tele (2026-09-24). La Samsung del muelle estuvo
 * más de un día con la misma página abierta y, cuando venció el token de 24 h,
 * el refresco automático del SDK no corrió nunca (ni un pedido al servidor en
 * todo el día): Firestore empezó a recibir sus consultas sin token, y con App
 * Check en enforcement la tele quedó "sin conexión". Acá se revisa el token
 * cada cinco minutos y se fuerza la renovación cuando le quedan menos de doce
 * horas (el servidor lo acuña por siete días), sin recargar la página: en modo
 * tele la sesión vive en memoria y una recarga la manda al login.
 */
function vigilarTokenTele(ac: AppCheck): void {
  const revisar = async (forzar: boolean): Promise<void> => {
    estadoTokenTele.revisiones++
    try {
      const { token } = await getTokenAppCheck(ac, forzar)
      const vence = vencimientoDelToken(token)
      estadoTokenTele.vence = vence
      estadoTokenTele.ultimoError = ''
      if (forzar) estadoTokenTele.ultimaRenovacion = new Date()
      else if (vence && vence.getTime() - Date.now() < RENOVAR_ANTES_MS) await revisar(true)
    } catch (e) {
      estadoTokenTele.ultimoError = `${new Date().toLocaleTimeString('es-AR')} · ${e instanceof Error ? e.message : String(e)}`
      console.warn('[tele] no se pudo renovar el token de App Check:', estadoTokenTele.ultimoError)
    }
  }
  void revisar(false)
  setInterval(() => { void revisar(false) }, REVISAR_CADA_MS)
}

function claveDeLaTele(): string | null {
  const deUrl = new URLSearchParams(window.location.search).get('claveTele')?.trim()
  try {
    if (deUrl) localStorage.setItem('claveTele', deUrl)
    return deUrl || localStorage.getItem('claveTele')
  } catch {
    return deUrl || null
  }
}

/** Por fetch y no por httpsCallable: corre antes de que exista cualquier otro servicio de Firebase. */
async function pedirTokenTele(clave: string): Promise<{ token: string; expireTimeMillis: number }> {
  const r = await fetch(`https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/tokenAppCheckTele`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ data: { clave, appId: firebaseConfig.appId } }),
  })
  const json = (await r.json()) as { result?: { token: string; expireTimeMillis: number }; error?: { message?: string } }
  if (!r.ok || !json.result) throw new Error(json.error?.message ?? `tokenAppCheckTele HTTP ${r.status}`)
  return json.result
}
