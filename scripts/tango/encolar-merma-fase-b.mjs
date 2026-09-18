/**
 * encolar-merma-fase-b.mjs — Encola a mano el item de MERMA (camión → 99) de descargas
 * que se contaron ANTES del deploy de `onDescargaCamionCreada` con fase B (2026-09-17).
 * Arma el item con la misma forma que el trigger (docs/tango/INTEGRACION.md §36) y
 * usa `create`, así nunca pisa uno que ya exista. Corre contra PRODUCCIÓN.
 *
 *   node scripts/tango/encolar-merma-fase-b.mjs <descargaId> [<descargaId> ...]
 *
 * Después, en la VM:  node bridge-sql.mjs --dry-run --once --solo=descargasCamion_<id>_merma
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
const FV = admin.firestore.FieldValue

const ids = process.argv.slice(2)
if (!ids.length) { console.error('Uso: node scripts/tango/encolar-merma-fase-b.mjs <descargaId> ...'); process.exit(1) }

const total = (items) => (Array.isArray(items) ? items : []).reduce((a, i) => a + (Number(i?.cantidad) || 0), 0)

for (const id of ids) {
  const snap = await db.doc(`descargasCamion/${id}`).get()
  if (!snap.exists) { console.log(id, 'NO existe'); continue }
  const descarga = snap.data()
  if (descarga.teorica) { console.log(id, 'es una descarga teórica (cierre de arranque): no lleva merma'); continue }
  if (total(descarga.bolsasRotas) <= 0) { console.log(id, 'sin rotas: nada que encolar'); continue }
  const outboxId = `descargasCamion_${id}_merma`
  try {
    await db.collection('tango-outbox').doc(outboxId).create({
      entidad: 'transferenciaDeposito',
      empresa: 'redonhielo',
      origenColeccion: 'descargasCamion',
      origenId: id,
      payload: {
        sentido:       'merma',
        codigo:        descarga.codigo ?? descarga.remitoCodigo ?? null,
        plantaId:      descarga.plantaId,
        depositoTango: descarga.depositoTango ?? null,
        camionId:      descarga.camionId,
        camionLabel:   descarga.camionLabel,
        choferId:      descarga.choferId,
        choferNombre:  descarga.choferNombre,
        items:         descarga.bolsasRotas,
        fecha:         descarga.fecha,
        registradoPor: descarga.registradoPor,
      },
      estado: 'pendiente', intentos: 0, ultimoError: null,
      creadoEn: FV.serverTimestamp(), actualizadoEn: FV.serverTimestamp(),
      notaManual: 'Encolado a mano (fase B): descarga contada antes del deploy de onDescargaCamionCreada con merma',
    })
    console.log('creado', outboxId, '→', descarga.choferNombre, 'rotas:', descarga.bolsasRotas.map((i) => `${i.cantidad} × ${i.nombre}`).join(', '))
  } catch (e) {
    console.log(outboxId, e.code === 6 ? 'ya existía' : `ERROR ${e.message}`)
  }
}
process.exit(0)
