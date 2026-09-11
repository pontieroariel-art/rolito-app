/**
 * configurar-motivo-nc.mjs — código del "Motivo de nota de crédito" de Tango que
 * la app manda al Facturador (config/tango.facturador.<empresa>.codigoMotivoNC).
 *
 * El 2026-09-11 la primera NC del camión (A 01104-00000002) salió en ARCA pero el
 * Facturador de Redonhielo la rechazó: "(78033) El código 4 del motivo no existe".
 * El 4 era el default supuesto ("Anulación de fact. electrónica"); el código
 * real está en Tango: Ventas → Archivos → Motivos de notas de crédito.
 *
 * Uso:  node scripts/tango/configurar-motivo-nc.mjs                       → muestra lo configurado
 *       node scripts/tango/configurar-motivo-nc.mjs --codigo 1 --commit   → Redonhielo
 *       node scripts/tango/configurar-motivo-nc.mjs --codigo 1 --empresa rolito --commit
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const args = process.argv.slice(2)
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const COMMIT = args.includes('--commit')
const EMPRESA = arg('--empresa') ?? 'redonhielo'
const CODIGO = arg('--codigo')

const ref = db.doc('config/tango')
const t = (await ref.get()).data() ?? {}
for (const e of ['redonhielo', 'rolito']) console.log(`${e}: codigoMotivoNC = ${t.facturador?.[e]?.codigoMotivoNC ?? '(sin configurar → 4)'}`)
if (!CODIGO) { console.log('\nPasá --codigo N --commit para fijarlo.'); process.exit(0) }
if (!COMMIT) { console.log(`\nDRY-RUN: pondría ${EMPRESA}.codigoMotivoNC = ${CODIGO}. Correr con --commit.`); process.exit(0) }
await ref.set({ facturador: { [EMPRESA]: { codigoMotivoNC: String(CODIGO) } } }, { merge: true })
console.log(`\nAPLICADO: ${EMPRESA}.codigoMotivoNC = ${CODIGO}. Ahora reencolá la NC: node scripts/tango/reintentar-outbox.mjs <id del item>`)
process.exit(0)
