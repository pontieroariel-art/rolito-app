/**
 * apagar-modo-test-mails.mjs — saca el "modo test" de los mails.
 *
 * configuracion/notificaciones.modoTest = true desvía TODOS los mails de la app
 * (comprobantes, avisos) a testEmail con asunto "[TEST → destinatario]"; lo leen
 * functions/src/email.ts y triggers/enviarComprobante.ts. No hay pantalla para
 * apagarlo. El 2026-09-11 los clientes no recibían nada por esto.
 *
 * Uso:  node scripts/apagar-modo-test-mails.mjs           → muestra el estado
 *       node scripts/apagar-modo-test-mails.mjs --commit  → modoTest = false
 *       node scripts/apagar-modo-test-mails.mjs --commit --encender  → vuelve a true
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const COMMIT = process.argv.includes('--commit')
const ENCENDER = process.argv.includes('--encender')
const ref = db.doc('configuracion/notificaciones')
console.log('antes:', JSON.stringify((await ref.get()).data()))
if (COMMIT) {
  await ref.set({ modoTest: ENCENDER }, { merge: true })
  console.log('después:', JSON.stringify((await ref.get()).data()))
} else console.log('DRY-RUN — correr con --commit para apagar el modo test')
process.exit(0)
