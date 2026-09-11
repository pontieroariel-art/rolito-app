/**
 * configurar-nc-facturador.mjs — deja la nota de crédito del Facturador de Redonhielo con el
 * formato que usa la oficina (diagnóstico por SQL del 2026-09-10, ver docs/tango §33 y
 * scripts/tango/sql/16-17): tipo de comprobante **'C/E'** (el "CDE" del readme de Axoft
 * traducido a esta instalación; 'CDE' no existe y 'N/C' rebota "Items no puede ser vacío").
 * 2026-09-11: Ariel pidió que sea 'NC' ("NC POR DEVOLUCION"); es el default ahora, --tipo X lo cambia,
 * con ítems y referencia a la factura (comprobanteCanceladoCompletamente: false).
 *
 * Después, opcionalmente, reencola los items de tango-outbox de notaCredito que quedaron en error.
 *
 *   node scripts/tango/configurar-nc-facturador.mjs              → solo escribe la config
 *   node scripts/tango/configurar-nc-facturador.mjs --reintentar → config + reencola las NC en error
 *
 * OJO: antes de reencolar la NC A 01104-00000001 (LECHUGA), la oficina tiene que haber emitido
 * en Tango la nota de débito contra la C/E A 00101-00009898 cargada a mano el 2026-09-10, si no
 * Tango queda con dos NC por la misma factura.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')
if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'rolito-app' })
} else {
  const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(sa) })
}
const db = admin.firestore()
const { FieldValue } = admin.firestore

const REINTENTAR = process.argv.includes('--reintentar')
// Tipo de comprobante de la NC en el Facturador. 2026-09-11, Ariel: tiene que ser 'NC'
// ("NC POR DEVOLUCION"), no 'C/E' ("CRE P/ERROR FACT E/R"). --tipo X para cambiarlo.
const tipoArg = process.argv.indexOf('--tipo')
const TIPO_NC = tipoArg >= 0 ? String(process.argv[tipoArg + 1] ?? '').trim() : 'NC'
if (!TIPO_NC) { console.error('Falta el valor de --tipo'); process.exit(1) }

const ref = db.doc('config/tango')
const antes = (await ref.get()).data()?.facturador?.redonhielo ?? {}
console.log('Antes :', JSON.stringify({ codigoTipoNC: antes.codigoTipoNC, ncCanceladoCompletamente: antes.ncCanceladoCompletamente, ncSinReferencia: antes.ncSinReferencia }))

await ref.set({
  facturador: {
    redonhielo: {
      codigoTipoNC:             TIPO_NC,
      ncCanceladoCompletamente: false,
      ncSinReferencia:          false,
    },
  },
}, { merge: true })

const despues = (await ref.get()).data()?.facturador?.redonhielo ?? {}
console.log('Ahora :', JSON.stringify({ codigoTipoNC: despues.codigoTipoNC, ncCanceladoCompletamente: despues.ncCanceladoCompletamente, ncSinReferencia: despues.ncSinReferencia }))

if (REINTENTAR) {
  const snap = await db.collection('tango-outbox').where('entidad', '==', 'notaCredito').where('estado', '==', 'error').get()
  if (snap.empty) console.log('No hay notas de crédito en error para reencolar.')
  for (const d of snap.docs) {
    const x = d.data()
    console.log(`Reencolo ${d.id} (${x.intentos ?? 0} intentos) — último error: ${String(x.ultimoError ?? '').slice(0, 120)}`)
    await d.ref.update({ estado: 'pendiente', intentos: 0, ultimoError: null, actualizadoEn: FieldValue.serverTimestamp() })
  }
  console.log('Listo. El worker la toma en el próximo barrido (≤5 min); el resultado se ve en /anulaciones (tango.estado).')
}
process.exit(0)
