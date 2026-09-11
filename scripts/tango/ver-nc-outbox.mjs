// Solo lectura: estado de las notas de crédito en la cola de Tango y de su
// solicitud (2026-09-11). Uso: node scripts/tango/ver-nc-outbox.mjs
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'))
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const snap = await db.collection('tango-outbox').where('entidad', '==', 'notaCredito').get()
for (const d of snap.docs) {
  const x = d.data()
  const a = (await db.doc(`anulacionesVentanilla/${x.refId ?? d.id.replace(/^anulacionesVentanilla_/, '')}`).get()).data()
  console.log(`${d.id}\n  cola: ${x.estado} (${x.intentos ?? 0} intentos)${x.ultimoError ? ` · ${String(x.ultimoError).slice(0, 140)}` : ''}${x.tangoNumero ? ` · Tango ${x.tangoNumero}` : ''}\n  solicitud: ${a?.clienteNombre ?? '?'} · ${a?.estado} · NC ${a?.notaCredito?.puntoVenta ?? a?.notaCreditoInterna?.puntoVenta ?? '?'}-${a?.notaCredito?.numero ?? a?.notaCreditoInterna?.numero ?? '?'} · tango: ${JSON.stringify(a?.tango ?? null)}`)
}
process.exit(0)
