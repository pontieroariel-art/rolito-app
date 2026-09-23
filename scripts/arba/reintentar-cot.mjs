// Vuelve a presentar a ARBA el COT de remitos de carga que quedaron en error
// (2026-09-22: 11 de 11 a clientes rebotaron con "(95) IMPORTE inválido"
// porque el borrador mandaba importe 0). Usa la MISMA función del servidor
// (functions/lib/triggers/cotArba.js → presentarCotDeRemito) con la clave CIT
// leída de Secret Manager, así lo que se presenta es exactamente lo que
// presentaría el trigger.
//
//   node scripts/arba/reintentar-cot.mjs                      (lista los que están en error, no presenta)
//   node scripts/arba/reintentar-cot.mjs --desde 2026-09-21   (idem, desde esa fecha; default: hoy)
//   node scripts/arba/reintentar-cot.mjs --aplicar            (presenta todos los listados)
//   node scripts/arba/reintentar-cot.mjs --aplicar RC-DT-000089 RC-DT-000093   (solo esos códigos)
//
// Requiere: functions compiladas (npm --prefix functions run build) y la clave
// CIT por variable de entorno (ver abajo) o permiso de Secret Manager.
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const raiz      = path.join(__dirname, '..', '..')
const admin     = require('../lib/firebase-admin-compat.cjs')
const { GoogleAuth } = require(path.join(raiz, 'functions/node_modules/google-auth-library'))
const sa = JSON.parse(readFileSync(path.join(raiz, 'scripts/serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const argv = process.argv.slice(2)
const aplicar = argv.includes('--aplicar')
const iDesde = argv.indexOf('--desde')
const desdeArg = iDesde >= 0 ? argv[iDesde + 1] : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const codigos = argv.filter((a, i) => !a.startsWith('--') && i !== iDesde + 1)

const desde = admin.firestore.Timestamp.fromDate(new Date(`${desdeArg}T00:00:00-03:00`))
const snap = await db.collection('remitosCarga').where('fecha', '>=', desde).orderBy('fecha').get()
const enError = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((r) => r.cotSolicitud && r.cot?.estado !== 'presentado' && !r.cot?.numero && (codigos.length === 0 || codigos.includes(r.codigo)))   // con `numero` ya tiene COT aunque un reintento haya quedado en error ("ya fue procesado")
const hora = (t) => t.toDate().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false }).slice(0, 17)
console.log(`Remitos desde ${desdeArg} con COT pedido y sin presentar: ${enError.length}`)
for (const r of enError) {
  const d = r.cotSolicitud.destino
  console.log(`  ${r.codigo} ${hora(r.fecha)} ${r.choferNombre} ${r.kg ?? '?'} kg → ${d.tipo === 'planta' ? 'planta ' + d.plantaId : d.razonSocial} | ${r.cot?.error ?? 'sin intento'}`)
}
if (!aplicar) { console.log('\n(sin --aplicar: no se presentó nada)'); process.exit(0) }
if (enError.length === 0) process.exit(0)

// La carga se valúa a precio de lista (config/cot.listaPrecios en preciosTango/redonhielo);
// si un producto no tiene precio ahí, la función lo dice por remito.

// Clave CIT de ARBA: el secret que usan las functions. La cuenta de servicio
// de scripts/ no tiene Secret Manager Accessor (403 el 22/09), así que se pasa
// por variable de entorno con la Firebase CLI, que sí lo lee:
//   ARBA_CIT=$(firebase functions:secrets:access ARBA_CIT) node scripts/arba/reintentar-cot.mjs --aplicar
let cit = (process.env.ARBA_CIT ?? '').trim()
if (!cit) {
  const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const client = await auth.getClient()
  const res = await client.request({ url: `https://secretmanager.googleapis.com/v1/projects/${sa.project_id}/secrets/ARBA_CIT/versions/latest:access` })
    .catch((e) => { throw new Error(`no se pudo leer el secret ARBA_CIT (${e.response?.status ?? e.message}); pasalo con ARBA_CIT=$(firebase functions:secrets:access ARBA_CIT)`) })
  cit = Buffer.from(res.data.payload.data, 'base64').toString('utf8').trim()
}
if (!cit) throw new Error('falta la clave CIT de ARBA')

const { presentarCotDeRemito } = require(path.join(raiz, 'functions/lib/triggers/cotArba.js'))
let ok = 0, fallo = 0
for (const r of enError) {
  try {
    const out = await presentarCotDeRemito(db, r.id, cit, 'manual')
    if (out.ok) { ok++; console.log(`  ✔ ${r.codigo}: COT ${out.cot}`) }
    else { fallo++; console.log(`  ✖ ${r.codigo}: ${out.error}`) }
  } catch (e) {
    fallo++; console.log(`  ✖ ${r.codigo}: ${e.message}`)
  }
}
console.log(`\nPresentados ${ok}, con error ${fallo}.`)
process.exit(0)
