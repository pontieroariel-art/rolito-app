/**
 * firestore-admin.mjs — Firestore para los scripts del bridge de la VM con el
 * Admin SDK (cuenta de servicio), en vez del SDK de navegador con el usuario
 * tango-bridge (2026-09-23).
 *
 * Por qué: App Check en enforcement rechaza toda lectura/escritura que no traiga
 * token de una app registrada, y el SDK de navegador corriendo en Node no lo
 * puede conseguir (no hay reCAPTCHA). El Admin SDK entra con la identidad de la
 * cuenta de servicio, que no pasa por App Check ni por las reglas: la cuenta
 * `rolito-bridge` tiene SOLO el rol "Usuario de Cloud Datastore" (leer y
 * escribir Firestore), nada de Auth, Storage ni administración del proyecto.
 *
 * Expone la misma forma de llamada que usaban los scripts (doc/collection/
 * query/where/getDoc/getDocs/updateDoc/onSnapshot/writeBatch/serverTimestamp/
 * deleteField), así bridge-sql.mjs y comprobantes-sync.mjs cambian solo el
 * import. OJO con una diferencia del Admin SDK si alguien agrega código:
 * `snap.exists` es una PROPIEDAD (en el de navegador era el método `exists()`).
 *
 * Config (bridge-sql.config.json): `"serviceAccount": "rolito-bridge.json"`,
 * ruta relativa a la carpeta del config (o absoluta). `tangoBridgeEmail` /
 * `tangoBridgePassword` ya no se usan.
 */
import path from 'path'
import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')

/**
 * Abre Firestore con la cuenta de servicio que dice la config. `baseDir` es la
 * carpeta donde vive el config (las rutas relativas se resuelven desde ahí).
 */
export function abrirFirestore(cfg, baseDir) {
  const ruta = cfg.serviceAccount
  if (!ruta) {
    throw new Error('Falta "serviceAccount" en la config: la ruta al JSON de la cuenta de servicio rolito-bridge (ver LEEME).')
  }
  const archivo = path.isAbsolute(ruta) ? ruta : path.join(baseDir, ruta)
  if (!existsSync(archivo)) throw new Error(`No encuentro la cuenta de servicio en ${archivo}.`)
  const sa = JSON.parse(readFileSync(archivo, 'utf8'))
  const projectId = cfg.firebaseConfig?.projectId ?? sa.project_id
  if (sa.project_id && projectId && sa.project_id !== projectId) {
    throw new Error(`La cuenta de servicio es del proyecto ${sa.project_id} y la config apunta a ${projectId}.`)
  }
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId })
  return { db: getFirestore(app), cuenta: sa.client_email }
}

// ── Misma forma de llamada que el SDK modular de navegador ──────────────────
const ruta = (segmentos) => segmentos.join('/')
export const doc        = (db, ...segmentos) => db.doc(ruta(segmentos))
export const collection = (db, ...segmentos) => db.collection(ruta(segmentos))
export const where      = (campo, op, valor) => (q) => q.where(campo, op, valor)
export const orderBy    = (campo, dir) => (q) => q.orderBy(campo, dir)
export const limit      = (n) => (q) => q.limit(n)
export const query      = (base, ...restricciones) => restricciones.reduce((q, r) => r(q), base)
export const getDoc     = (r) => r.get()
export const getDocs    = (q) => q.get()
export const setDoc     = (r, datos, opts) => (opts ? r.set(datos, opts) : r.set(datos))
export const updateDoc  = (r, datos) => r.update(datos)
export const deleteDoc  = (r) => r.delete()
export const onSnapshot = (q, siguiente, error) => q.onSnapshot(siguiente, error)
export const writeBatch = (db) => db.batch()
export const serverTimestamp = () => FieldValue.serverTimestamp()
export const deleteField     = () => FieldValue.delete()
export { FieldValue, Timestamp }
