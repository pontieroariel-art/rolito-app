/**
 * marcar-nc-registrada-a-mano.mjs — una nota de crédito de la app que la oficina ya cargó A MANO
 * en Tango (y que la cola ya no puede registrar, p. ej. "(65015) fechaComprobante inferior a la
 * última registrada") queda marcada como confirmada en Tango con ese número, y el ítem de la
 * cola se descarta para que no se reintente.
 *
 *   node scripts/tango/marcar-nc-registrada-a-mano.mjs <ventaId> <numeroTango> [nota]
 *   node scripts/tango/marcar-nc-registrada-a-mano.mjs gSCRJ6AaUWuNuR8Bfa4x A0010100009898 "C/E manual del 10/09"
 *
 * No toca ARCA ni la venta: la NC de la app sigue siendo válida fiscalmente.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'))
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const { FieldValue } = admin.firestore

const [ventaId, numeroTango, nota = ''] = process.argv.slice(2)
if (!ventaId || !numeroTango) { console.error('Uso: <ventaId> <numeroTango> [nota]'); process.exit(1) }

const ref = db.doc(`anulacionesVentanilla/${ventaId}`)
const a = (await ref.get()).data()
if (!a) { console.error(`No existe anulacionesVentanilla/${ventaId}`); process.exit(1) }
if (a.estado !== 'emitida') { console.error(`La solicitud está '${a.estado}', no 'emitida': no corresponde marcarla.`); process.exit(1) }
console.log(`Solicitud: ${a.clienteNombre} · NC ${a.notaCredito?.puntoVenta}-${a.notaCredito?.numero} · tango antes: ${JSON.stringify(a.tango ?? null)}`)

await ref.set({
  tango: {
    estado: 'confirmado', numero: numeroTango, manual: true, ultimoError: null,
    nota: nota || 'Registrada a mano en Tango por la oficina', en: FieldValue.serverTimestamp(),
  },
}, { merge: true })

const outboxRef = db.doc(`tango-outbox/anulacionesVentanilla_${ventaId}`)
const o = (await outboxRef.get()).data()
if (o && o.estado !== 'confirmado') {
  await outboxRef.set({ estado: 'descartado', motivoDescarte: `Registrada a mano en Tango como ${numeroTango}. ${nota}`.trim(), actualizadoEn: FieldValue.serverTimestamp() }, { merge: true })
  console.log(`Cola: ${o.estado} → descartado`)
}
console.log(`Listo: tango = confirmado (${numeroTango}, a mano).`)
process.exit(0)
