/**
 * bridge-listener.mjs
 *
 * Corre EN LA VM de Tango (misma red que bridge-sync-clientes.mjs), pero como
 * SERVICIO DE WINDOWS persistente (ver NSSM más abajo), no como tarea diaria:
 * escucha tango-outbox en tiempo real y manda cada novedad a Tango apenas se
 * carga en la app (producción, remitos, recibos de cobranza), y responde las
 * consultas on-demand de tango-consultas (composición de saldos de un cliente
 * puntual, para la pantalla de cobro del supervisor).
 * Ver docs/tango/INTEGRACION.md §7.
 *
 * A diferencia de bridge-sync-clientes.mjs (que solo usa fetch, sin
 * dependencias), este script necesita el SDK cliente de Firestore para poder
 * escuchar cambios en tiempo real (onSnapshot) — no hay forma liviana de
 * hacer eso con fetch suelto. Usa el SDK CLIENTE (firebase/*), nunca
 * firebase-admin: la cuenta con la que se loguea (ver setup-bridge-account.mjs)
 * está acotada por firestore.rules a leer/actualizar tango-outbox y
 * tango-consultas y nada más — este script nunca tiene la clave maestra de
 * Firestore.
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
// Una consulta de saldo que quedó 'pendiente' más de esto ya no le sirve a
// nadie (la UI cae al cache a los ~12s) — el barrido la marca como error.
const CONSULTA_TIMEOUT_MS = 10 * 60 * 1000

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

async function flagTango(db, campo) {
  try {
    const snap = await getDoc(doc(db, 'config/tango'))
    return snap.data()?.[campo] === true
  } catch {
    return false
  }
}

/**
 * El header `Company` de la API, resuelto en el momento de mandar.
 *
 * El item del outbox dice a qué empresa del NEGOCIO pertenece
 * (`redonhielo` / `rolito`); el número sale de `config/tango.companies`:
 *
 *   { "redonhielo": 4, "rolito": 4 }   ← todo a TestingRH mientras se prueba
 *   { "redonhielo": 1, "rolito": 3 }   ← producción
 *
 * Así el pase de pruebas a producción es cambiar un doc de Firestore, sin
 * tocar código ni redeployar. Y si no está configurado NO se adivina: mandar
 * un comprobante a la empresa equivocada se limpia a mano del otro lado.
 */
async function resolverCompany(db, empresa) {
  if (!empresa) return { ok: false, error: 'El item no dice a qué empresa va (falta `empresa`)' }
  let companies
  try {
    const snap = await getDoc(doc(db, 'config/tango'))
    companies = snap.data()?.companies
  } catch (e) {
    return { ok: false, error: `No se pudo leer config/tango: ${e.message}` }
  }
  const company = companies?.[empresa]
  if (!Number.isInteger(company)) {
    return {
      ok: false,
      error: `config/tango.companies no tiene un número para "${empresa}". ` +
             'Cargalo antes de mandar nada (ej. {"redonhielo":4,"rolito":4} para TestingRH).',
    }
  }
  return { ok: true, company }
}

// ── Writers hacia Tango — STUBS pendientes de confirmar ─────────────────────
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

async function enviarRemitoATango(payload, item) {
  log(`  [STUB] enviarRemitoATango — Company ${item?.company ?? '?'} (${item?.empresa ?? '?'}), payload: ${JSON.stringify(payload)}`)
  return {
    ok: false,
    error: 'API de transacciones de ventas no habilitada todavía — ver docs/tango/INTEGRACION.md §6.2',
  }
}

// Factura de venta del camión.
//
// ⚠️ LO MÁS IMPORTANTE DE TODA LA INTEGRACIÓN: cuando `item.conCaePropio` es
// true, la factura **YA FUE AUTORIZADA POR ARCA** — la emitió esta app, con su
// punto de venta 1104, y el CAE viaja en `payload.factura`. Tango tiene que
// registrarla como comprobante ya emitido, respetando ese punto de venta,
// número y CAE.
//
// Si el writer usara un proceso que le pide a ARCA un CAE propio, la MISMA
// operación quedaría autorizada dos veces: dos comprobantes fiscales por una
// sola venta, que después hay que anular con notas de crédito. Antes de
// completar esta función hay que confirmar con Axoft que la API admite
// registrar un comprobante con CAE externo. Si no lo admite, hay que replantear
// quién factura — no completar esto igual.
//
// Datos que ya vienen en el payload: `factura.puntoVenta`, `factura.numero`,
// `factura.cbteTipo` (1 = A, 6 = B), `factura.cae`, `factura.caeFchVto` y
// `factura.importes` (neto, iva, tributos, total) TAL COMO se le informaron a
// ARCA — no se recalculan de este lado.
async function enviarFacturaATango(payload, item) {
  log(
    `  [STUB] enviarFacturaATango — Company ${item?.company ?? '?'} (${item?.empresa ?? '?'}), ` +
    `conCaePropio=${item?.conCaePropio === true}, payload: ${JSON.stringify(payload)}`,
  )
  return {
    ok: false,
    error: 'API de transacciones de ventas no habilitada todavía — y falta confirmar con Axoft que admite registrar un comprobante con CAE externo (ver docs/tango/INTEGRACION.md §6.2)',
  }
}

// Recibo de cobranza del supervisor. Cuando la licencia habilite transacciones
// y se releve el process de recibos, acá va el writer real — OBLIGATORIO con
// mitigación de duplicados: (1) GetByFilter previo buscando la referencia
// idempotente `ROLITO:{cobranzaId}` que viaja en el payload (cubre "Create OK
// → el bridge murió antes de confirmar → el barrido reintenta"); (2) persistir
// resultado.savedId en el outbox inmediatamente después del Create.
async function enviarReciboATango(payload) {
  log(`  [STUB] enviarReciboATango — payload que se mandaría: ${JSON.stringify(payload)}`)
  return {
    ok: false,
    error: 'API de recibos de cobranza no habilitada todavía (Transacciones Tango Ventas: No) — ver docs/tango/INTEGRACION.md',
  }
}

// ── Dispatcher por entidad ──────────────────────────────────────────────────
// Cada entidad del outbox tiene su writer y su interruptor propio en
// config/tango — así se puede habilitar producción sin habilitar recibos, etc.
const HANDLERS = {
  produccionPallet: { enviar: enviarProduccionATango, flag: 'produccionEnabled' },
  remito:           { enviar: enviarRemitoATango,     flag: 'remitosEnabled' },
  factura:          { enviar: enviarFacturaATango,    flag: 'facturasEnabled' },
  recibo:           { enviar: enviarReciboATango,     flag: 'recibosEnabled' },
}

const enProceso = new Set()

async function procesarItem(db, docId, data) {
  if (enProceso.has(docId)) return
  enProceso.add(docId)
  try {
    const handler = HANDLERS[data.entidad]
    if (!handler) {
      log(`  ${docId}: entidad desconocida "${data.entidad}", se deja pendiente`)
      return
    }
    if (!(await flagTango(db, handler.flag))) {
      log(`  ${docId}: config/tango.${handler.flag}=false, se deja pendiente (lo retoma el barrido)`)
      return
    }

    await updateDoc(doc(db, 'tango-outbox', docId), {
      estado: 'enviado',
      intentos: (data.intentos ?? 0) + 1,
      actualizadoEn: serverTimestamp(),
    })

    // Las ventas dicen a qué empresa van; producción y recibos todavía no
    // (siguen yendo a la empresa que tenga configurada el bridge).
    let company
    if (data.empresa) {
      const r = await resolverCompany(db, data.empresa)
      if (!r.ok) {
        log(`  ${docId}: ${r.error}`)
        await updateDoc(doc(db, 'tango-outbox', docId), {
          ultimoError: r.error, actualizadoEn: serverTimestamp(),
        })
        return
      }
      company = r.company
    }

    // Se le pasa el item entero más la empresa ya resuelta: el writer necesita
    // el header Company y saber si el comprobante ya trae CAE propio.
    const resultado = await handler.enviar(data.payload, { ...data, company })

    if (resultado.ok) {
      await updateDoc(doc(db, 'tango-outbox', docId), {
        estado: 'confirmado', ultimoError: null, actualizadoEn: serverTimestamp(),
        ...(resultado.resultado ? { resultado: resultado.resultado } : {}),
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

// ── Consultas on-demand (tango-consultas): composición de saldos ────────────
// La pantalla de cobro del supervisor crea un doc pidiendo el saldo fresco de
// UN cliente; acá se consultan las Live de "Deudas vencidas" + "Deudas a
// vencer" y se filtra por ID_GVA14, escribiendo el resultado en el MISMO doc.
// Una Cloud Function (onConsultaRespondida) copia después el resultado al
// cache saldosTango — este script nunca escribe el cache directo, coherente
// con el modelo de confianza del outbox.
//
// Formato de la API Live confirmado 2026-08-31 (ver docs/tango/INTEGRACION.md
// §6.1bis y bridge-sync-saldos.mjs, que usa el mismo): query string,
// customQuery=0 obligatorio, fechas dd/MM/yyyy.
function soloFecha(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : ''
}

function recortarComprobante(fila) {
  return {
    tipo:               String(fila.TIPO_COMPROBANTE ?? ''),
    numero:             String(fila.NRO_COMPROBANTE ?? ''),
    fechaEmision:       soloFecha(fila.FECHA_DE_EMISION),
    ...(fila.FECHA_DE_VENCIMIENTO ? { fechaVencimiento: soloFecha(fila.FECHA_DE_VENCIMIENTO) } : {}),
    importeOriginal:    Number(fila.IMPORTE_AL_VENCIMIENTO_CTE ?? 0),
    saldoPendiente:     Number(fila.IMPORTE_PENDIENTE_CTE ?? 0),
    ...(typeof fila.ID_GVA12 === 'number' ? { idComprobanteTango: fila.ID_GVA12 } : {}),
    ...(typeof fila.DIAS_DE_ATRASO === 'number' && fila.DIAS_DE_ATRASO > 0 ? { diasAtraso: fila.DIAS_DE_ATRASO } : {}),
  }
}

function ddMMyyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

async function traerDeudasLive(t, proceso, idGva14) {
  const hastaDate = new Date()
  hastaDate.setFullYear(hastaDate.getFullYear() + 5)
  const filas = []
  let pageIndex = 0
  let totalPages = 1
  do {
    const uri = t.baseUrl + '/Api/GetApiLiveQueryData'
      + '?process=' + proceso
      + '&customQuery=0'
      + '&fromDate=' + encodeURIComponent(t.fromDate ?? '01/01/2015')
      + '&toDate=' + encodeURIComponent(ddMMyyyy(hastaDate))
      + '&pageSize=' + (t.pageSize ?? 500)
      + '&pageIndex=' + pageIndex
    const resp = await fetch(uri, { headers: { ApiAuthorization: t.token, Company: t.company } })
    if (!resp.ok) throw new Error(`Tango respondió ${resp.status} (process ${proceso}, página ${pageIndex})`)
    const data = await resp.json()
    if (!data.succeeded) throw new Error(`Tango succeeded=false (process ${proceso}): ${data.exceptionInfo?.messages?.join('; ') ?? data.message ?? ''}`)
    // El filtro por cliente es client-side (customQuery es un flag, no un
    // filtro): se pagina todo y se queda con las filas del ID_GVA14 pedido.
    filas.push(...data.resultData.list.filter((f) => f.ID_GVA14 === idGva14))
    totalPages = data.resultData.totalPages
    pageIndex++
  } while (pageIndex < totalPages)
  return filas
}

async function consultarSaldoEnTango(idGva14) {
  const t = cfg.tangoSaldos
  if (!t || !t.procesoDeudasVencidas) {
    return { ok: false, error: 'tangoSaldos.procesoDeudasVencidas no configurado en bridge-listener.config.json' }
  }
  try {
    const id = Number(idGva14)
    const filas = await traerDeudasLive(t, t.procesoDeudasVencidas, id)
    if (t.procesoDeudasAVencer) {
      filas.push(...await traerDeudasLive(t, t.procesoDeudasAVencer, id))
    }
    const comprobantes = filas.map(recortarComprobante)
    const saldoTotal = Math.round(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100
    return { ok: true, resultado: { comprobantes, saldoTotal } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function procesarConsulta(db, docId, data) {
  const clave = `consulta:${docId}`
  if (enProceso.has(clave)) return
  enProceso.add(clave)
  try {
    if (data.tipo !== 'saldoCliente') {
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'error', ultimoError: `tipo de consulta desconocido: ${data.tipo}`, actualizadoEn: serverTimestamp(),
      })
      return
    }
    if (!(await flagTango(db, 'consultasEnabled'))) {
      // Se deja pendiente: la UI cae al cache sola; el barrido la vence a los 10 min.
      return
    }

    const resultado = await consultarSaldoEnTango(data.idGva14)

    if (resultado.ok) {
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'respondida', resultado: resultado.resultado, ultimoError: null, actualizadoEn: serverTimestamp(),
      })
      log(`  consulta ${docId}: saldo de idGva14=${data.idGva14} respondido (${resultado.resultado.comprobantes.length} comprobantes)`)
    } else {
      // Una consulta fallida se marca error de una (sin reintentos): el
      // supervisor ya está mirando el cache; reintentar tarde no aporta.
      await updateDoc(doc(db, 'tango-consultas', docId), {
        estado: 'error', ultimoError: resultado.error, actualizadoEn: serverTimestamp(),
      })
      log(`  consulta ${docId}: falló — ${resultado.error}`)
    }
  } catch (err) {
    log(`  consulta ${docId}: ERROR inesperado — ${err.message}`)
  } finally {
    enProceso.delete(clave)
  }
}

// Reintenta 'pendiente' (red de seguridad por si el listener se perdió un
// evento, ej. el flag estaba en false cuando se creó el item) y 'enviado'
// (items que fallaron un intento — ver nota en procesarItem: este barrido
// cada 5 min ES el backoff de esos reintentos). También vence consultas
// viejas que quedaron pendientes.
async function barridoPendientes(db) {
  const q = query(collection(db, 'tango-outbox'), where('estado', 'in', ['pendiente', 'enviado']))
  const res = await getDocs(q)
  if (!res.empty) {
    log(`Barrido: ${res.size} item(s) pendientes/a reintentar en tango-outbox`)
    for (const d of res.docs) await procesarItem(db, d.id, d.data())
  }

  const qc = query(collection(db, 'tango-consultas'), where('estado', '==', 'pendiente'))
  const resC = await getDocs(qc)
  for (const d of resC.docs) {
    const creado = d.data().creadoEn?.toDate?.()
    if (creado && Date.now() - creado.getTime() > CONSULTA_TIMEOUT_MS) {
      await updateDoc(doc(db, 'tango-consultas', d.id), {
        estado: 'error', ultimoError: 'consulta vencida sin responder', actualizadoEn: serverTimestamp(),
      }).catch(() => {})
    } else {
      await procesarConsulta(db, d.id, d.data())
    }
  }
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
  log('Sesión OK. Escuchando tango-outbox y tango-consultas en tiempo real...')

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

  const qc = query(collection(db, 'tango-consultas'), where('estado', '==', 'pendiente'))
  onSnapshot(qc, (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added' || change.type === 'modified') {
        procesarConsulta(db, change.doc.id, change.doc.data())
      }
    }
  }, (err) => {
    log(`ERROR en el listener de tango-consultas (el SDK va a reintentar solo): ${err.message}`)
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
