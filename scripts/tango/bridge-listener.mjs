/**
 * bridge-listener.mjs
 *
 * Corre EN LA VM de Tango (misma red que bridge-sync-clientes.mjs), pero como
 * SERVICIO DE WINDOWS persistente (ver NSSM más abajo), no como tarea diaria:
 * escucha tango-outbox en tiempo real y manda cada novedad a Tango apenas se
 * carga en la app (hoy: pallets de producción). Ver docs/tango/INTEGRACION.md §7.
 *
 * A diferencia de bridge-sync-clientes.mjs (que solo usa fetch, sin
 * dependencias), este script necesita el SDK cliente de Firestore para poder
 * escuchar cambios en tiempo real (onSnapshot) — no hay forma liviana de
 * hacer eso con fetch suelto. Usa el SDK CLIENTE (firebase/*), nunca
 * firebase-admin: la cuenta con la que se loguea (ver setup-bridge-account.mjs)
 * está acotada por firestore.rules a leer/actualizar tango-outbox y nada más
 * — este script nunca tiene la clave maestra de Firestore.
 *
 * Uso:
 *   1. En esta carpeta: npm install firebase (una vez, deja node_modules acá).
 *   2. Copiar este archivo + bridge-listener.config.json (basado en
 *      bridge-listener.config.example.json, con los valores reales) a la VM.
 *   3. Correr la cuenta de servicio una vez (ver setup-bridge-account.mjs).
 *   4. Probar a mano: node bridge-listener.mjs
 *   5. Instalar como servicio de Windows con NSSM (https://nssm.cc/), para
 *      que quede corriendo siempre y se reinicie solo si se cae:
 *        nssm install RolitoTangoListener "C:\ruta\a\node.exe" "C:\RolitoSync\bridge-listener.mjs"
 *        nssm set RolitoTangoListener AppDirectory C:\RolitoSync
 *        nssm start RolitoTangoListener
 *
 * Contra el emulador local (para probar el flujo end-to-end sin tocar
 * producción — ver CLAUDE.md):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     node scripts/tango/bridge-listener.mjs
 */

import { readFileSync, appendFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc,
  collection, query, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'bridge-listener.config.json')
const MAX_INTENTOS = 5
const SWEEP_INTERVAL_MS = 5 * 60 * 1000   // barrido de seguridad cada 5 min
const HEARTBEAT_INTERVAL_MS = 60 * 1000

function cargarConfig() {
  let cfg
  try {
    const texto = readFileSync(CONFIG_PATH, 'utf8')
    cfg = JSON.parse(texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto)
  } catch {
    console.error(`No se pudo leer ${CONFIG_PATH}. Copiá bridge-listener.config.example.json a bridge-listener.config.json y completá los valores reales.`)
    process.exit(1)
  }
  const chequear = (obj, prefijo = '') => {
    for (const [clave, valor] of Object.entries(obj)) {
      if (typeof valor === 'string' && valor.includes('_AQUI')) {
        console.error(`Falta completar "${prefijo}${clave}" en ${CONFIG_PATH}.`)
        process.exit(1)
      }
      if (valor && typeof valor === 'object') chequear(valor, `${prefijo}${clave}.`)
    }
  }
  chequear(cfg)
  return cfg
}

const cfg = cargarConfig()

function log(linea) {
  const conFecha = `[${new Date().toISOString()}] ${linea}`
  console.log(conFecha)
  try { appendFileSync(cfg.logFile, conFecha + '\n', 'utf8') } catch { /* logging es best-effort */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Envío a Tango — STUB pendiente de confirmar ────────────────────────────
// No sabemos todavía qué pantalla/proceso usa el administrativo en Tango para
// cargar producción (¿ingreso de stock? ¿ajuste de stock? ¿orden de
// producción?), ni si está expuesto por la misma API ABM que ya usamos para
// Clientes (process=2117) o si requiere otro módulo. Hasta confirmar eso con
// Ariel/Axoft/TC Servicios (ver docs/tango/INTEGRACION.md §7), esta función
// solo loguea lo que MANDARÍA y devuelve un error controlado — no inventa un
// endpoint que todavía no confirmamos que existe.
async function enviarProduccionATango(payload) {
  log(`  [STUB] enviarProduccionATango — payload que se mandaría: ${JSON.stringify(payload)}`)
  return {
    ok: false,
    error: 'Proceso Tango para producción todavía no confirmado — ver docs/tango/INTEGRACION.md §7',
  }
}

async function produccionSyncHabilitado(db) {
  try {
    const snap = await getDoc(doc(db, 'config/tango'))
    return snap.data()?.produccionEnabled === true
  } catch {
    return false
  }
}

const enProceso = new Set()

async function procesarItem(db, docId, data) {
  if (enProceso.has(docId)) return
  enProceso.add(docId)
  try {
    if (!(await produccionSyncHabilitado(db))) {
      log(`  ${docId}: config/tango.produccionEnabled=false, se deja pendiente (lo retoma el barrido)`)
      return
    }

    await updateDoc(doc(db, 'tango-outbox', docId), {
      estado: 'enviado',
      intentos: (data.intentos ?? 0) + 1,
      actualizadoEn: serverTimestamp(),
    })

    const resultado = await enviarProduccionATango(data.payload)

    if (resultado.ok) {
      await updateDoc(doc(db, 'tango-outbox', docId), {
        estado: 'confirmado', ultimoError: null, actualizadoEn: serverTimestamp(),
      })
      log(`  ${docId}: confirmado en Tango`)
    } else {
      const intentos = (data.intentos ?? 0) + 1
      // OJO: NO se vuelve a 'pendiente' acá — el listener en tiempo real
      // escucha justo estado=='pendiente', así que reponerlo dispararía un
      // reintento instantáneo (sin backoff) y quemaría MAX_INTENTOS en
      // milisegundos. 'enviado' queda fuera de ese query; el único que
      // reintenta un item en 'enviado' es el barrido cada 5 min — eso ES el
      // backoff.
      const estadoFinal = intentos >= MAX_INTENTOS ? 'error' : 'enviado'
      await updateDoc(doc(db, 'tango-outbox', docId), {
        estado: estadoFinal, ultimoError: resultado.error, actualizadoEn: serverTimestamp(),
      })
      log(`  ${docId}: falló (intento ${intentos}/${MAX_INTENTOS}) — ${resultado.error}`)
    }
  } catch (err) {
    log(`  ${docId}: ERROR inesperado procesando — ${err.message}`)
  } finally {
    enProceso.delete(docId)
  }
}

// Reintenta 'pendiente' (red de seguridad por si el listener se perdió un
// evento, ej. produccionEnabled estaba en false cuando se creó el item) y
// 'enviado' (items que fallaron un intento — ver nota en procesarItem: este
// barrido cada 5 min ES el backoff de esos reintentos).
async function barridoPendientes(db) {
  const snap = await getDoc(doc(db, 'config/tango')).catch(() => null)
  if (snap?.data()?.produccionEnabled !== true) return
  const q = query(collection(db, 'tango-outbox'), where('estado', 'in', ['pendiente', 'enviado']))
  const res = await getDocs(q)
  if (res.empty) return
  log(`Barrido: ${res.size} item(s) pendientes/a reintentar`)
  for (const d of res.docs) await procesarItem(db, d.id, d.data())
}

async function main() {
  const app = initializeApp(cfg.firebaseConfig)
  const auth = getAuth(app)
  const db = getFirestore(app)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    connectFirestoreEmulator(db, host, Number(port))
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  }

  log('Iniciando sesión como bridge...')
  await signInWithEmailAndPassword(auth, cfg.tangoBridgeEmail, cfg.tangoBridgePassword)
  log('Sesión OK. Escuchando tango-outbox en tiempo real...')

  const q = query(collection(db, 'tango-outbox'), where('estado', '==', 'pendiente'))
  onSnapshot(q, (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added' || change.type === 'modified') {
        procesarItem(db, change.doc.id, change.doc.data())
      }
    }
  }, (err) => {
    log(`ERROR en el listener de tango-outbox (el SDK va a reintentar solo): ${err.message}`)
  })

  setInterval(() => { barridoPendientes(db).catch((err) => log(`ERROR en barrido: ${err.message}`)) }, SWEEP_INTERVAL_MS)

  setInterval(() => {
    updateDoc(doc(db, 'config/tango'), { bridgeListenerLastSeen: serverTimestamp() })
      .catch((err) => log(`ERROR escribiendo heartbeat: ${err.message}`))
  }, HEARTBEAT_INTERVAL_MS)
}

main().catch(async (err) => {
  log(`ERROR FATAL al arrancar: ${err.stack ?? err.message}`)
  await sleep(5000)
  process.exit(1)   // NSSM lo reinicia solo
})
