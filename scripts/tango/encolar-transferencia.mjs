// Encola a mano una transferencia de stock en la cola de Tango (tango-outbox),
// para los movimientos que la app no tiene forma de registrar (2026-09-22):
//
//   carga     planta → camión   (ej. el chofer cargó en Merlo a mitad del reparto)
//   descarga  camión → planta
//   merma     camión → 99       (rotas que no pasaron por el conteo del muelle)
//
// Chofer, camión y depósito salen del remito de carga del viaje; el bridge de
// la VM la escribe por SQL como cualquier CAR/DES/merma de la app. La
// referencia (idempotencia en Tango) lleva un sufijo propio para no chocar
// con la transferencia que ya tiene ese remito o esa descarga.
//
//   node scripts/tango/encolar-transferencia.mjs --sentido carga --planta merlo \
//     --remito aulanePJtCmVPO3WaUxF --items escamas_10kg=350,bolsa_3kg=315 \
//     --fecha 2026-09-21T10:30:00-03:00 --motivo "cargó en Merlo" [--aplicar]
//
//   node scripts/tango/encolar-transferencia.mjs --sentido merma \
//     --remito aulanePJtCmVPO3WaUxF --items bolsa_3kg=4 --fecha ... [--aplicar]
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, '..', 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const sentido = opt('sentido'), plantaId = opt('planta'), remitoId = opt('remito'), itemsArg = opt('items')
const fechaArg = opt('fecha'), motivo = opt('motivo') ?? '', sufijo = opt('sufijo')
const aplicar = argv.includes('--aplicar')
if (!['carga', 'descarga', 'merma'].includes(sentido) || !remitoId || !itemsArg || ((sentido !== 'merma') && !plantaId)) {
  console.error('uso: --sentido carga|descarga|merma [--planta torcuato|merlo] --remito <id> --items prod=cant,... [--fecha ISO] [--motivo "..."] [--sufijo x] [--aplicar]')
  process.exit(1)
}

const rSnap = await db.doc(`remitosCarga/${remitoId}`).get()
if (!rSnap.exists) throw new Error(`no existe remitosCarga/${remitoId}`)
const r = rSnap.data()
const tcfg = (await db.doc('config/tango').get()).data()
if (plantaId && !tcfg.depositosPlanta?.[plantaId]) throw new Error(`config/tango.depositosPlanta no tiene la planta ${plantaId}`)
const cfgTipo = tcfg.sql?.stock?.tipos?.[sentido]
if (!cfgTipo) throw new Error(`config/tango.sql.stock.tipos.${sentido} no existe`)
if (cfgTipo.habilitado === false) console.warn(`OJO: config/tango.sql.stock.tipos.${sentido}.habilitado = false, el bridge la va a dejar esperando`)

const catalogo = (await db.doc('config/catalogo').get()).data()
const productos = catalogo?.productos ?? catalogo?.items ?? Object.values(catalogo ?? {})
const items = itemsArg.split(',').map((par) => {
  const [productoId, cant] = par.split('=')
  const cantidad = Number(cant)
  const p = productos.find((x) => x?.id === productoId)
  if (!p) throw new Error(`producto ${productoId} no está en config/catalogo`)
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error(`cantidad inválida para ${productoId}: ${cant}`)
  if (!tcfg.articulos?.[productoId]) throw new Error(`config/tango.articulos no mapea ${productoId}`)
  return { productoId, nombre: p.nombre, cantidad }
})

const fecha = fechaArg ? admin.firestore.Timestamp.fromDate(new Date(fechaArg)) : admin.firestore.Timestamp.now()
if (Number.isNaN(fecha.toMillis())) throw new Error(`fecha inválida: ${fechaArg}`)

const tag = sufijo ?? (sentido === 'merma' ? 'manual' : plantaId)
const origenColeccion = 'remitosCarga'
const origenId = `${remitoId}_${tag}`            // referencia en Tango: ROLITO:RC:<origenId> (DM para merma)
const outboxId = `remitosCarga_${remitoId}_${sentido}_${tag}`
const comun = {
  codigo:        `${r.codigo} (${motivo || sentido + ' manual'})`,
  plantaId:      plantaId ?? r.plantaId,
  depositoTango: r.depositoTango ?? null,
  camionId:      r.camionId,
  camionLabel:   r.camionLabel,
  choferId:      r.choferId,
  choferNombre:  r.choferNombre,
  items,
  fecha,
}
const payload = sentido === 'merma'
  ? { sentido, ...comun, registradoPor: { uid: 'script', nombre: 'OFICINA' } }
  : { sentido, ...comun, creadoPor: { uid: 'script', nombre: 'OFICINA' } }
const item = { entidad: 'transferenciaDeposito', empresa: 'redonhielo', origenColeccion, origenId, payload }

const depCamion = r.depositoTango, depPlanta = plantaId ? tcfg.depositosPlanta[plantaId] : null
const flecha = sentido === 'carga' ? `${depPlanta} → ${depCamion}` : sentido === 'descarga' ? `${depCamion} → ${depPlanta}` : `${depCamion} → ${cfgTipo.depositoDestino}`
console.log(`Remito ${r.codigo}, ${r.choferNombre}, ${r.camionLabel}, depósito ${depCamion}`)
console.log(`Transferencia ${sentido} ${flecha} (tipo ${cfgTipo.tComp}), fecha ${fecha.toDate().toISOString()}`)
for (const i of items) console.log(`  ${i.nombre}: ${i.cantidad}`)
console.log(`tango-outbox/${outboxId}  referencia ROLITO:${sentido === 'merma' ? 'DM' : 'RC'}:${origenId}`)
if ((await db.doc(`tango-outbox/${outboxId}`).get()).exists) throw new Error(`ya existe tango-outbox/${outboxId}: usá --sufijo para distinguirla`)
if (!aplicar) { console.log('\n(sin --aplicar: no se encoló nada)'); process.exit(0) }
await db.doc(`tango-outbox/${outboxId}`).create({
  ...item, estado: 'pendiente', intentos: 0, ultimoError: null,
  creadoEn: admin.firestore.FieldValue.serverTimestamp(), actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
})
console.log('\nENCOLADA. El bridge de la VM la escribe en Tango en su próxima pasada; ver con scripts/tango/ver-nc-outbox.mjs o el panel.')
