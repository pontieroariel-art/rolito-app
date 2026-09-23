// Registra la descarga en MERLO de un remito de carga de Torcuato que fue un
// TRASLADO entre plantas (2026-09-22, caso RC-DT-000082 de Cristian Primiterra).
//
// La app no tiene circuito de traslado: la descarga se cuenta en la tablet de
// la planta que emitió el remito y transfiere en Tango camión → ESA planta. Si
// Torcuato contara este viaje, el hielo volvería a Torcuato en los papeles.
// Este script escribe la descarga con plantaId = merlo y los mismos renglones
// que la carga; el trigger onDescargaCamionCreada hace el resto (numera,
// encola la transferencia 21 → 02 en Tango y cierra la mercadería del viaje).
//
// Quien recibe puede ser un usuario (uid) o, si todavía no tiene usuario en la
// app, un nombre con --nombre "APELLIDO NOMBRE" (queda con uid 'sin-usuario').
//
//   node scripts/descarga-traslado-merlo.mjs <remitoId> <uidRecibe>            (muestra)
//   node scripts/descarga-traslado-merlo.mjs <remitoId> --nombre "GABRIEL" --aplicar
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('./lib/firebase-admin-compat.cjs')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()

const argv = process.argv.slice(2)
const iNombre = argv.indexOf('--nombre')
const nombreSuelto = iNombre >= 0 ? argv[iNombre + 1] : undefined
const posicionales = argv.filter((a, i) => !a.startsWith('--') && i !== iNombre + 1)
const [remitoId, uidRecibe] = posicionales
const aplicar = argv.includes('--aplicar')
if (!remitoId || (!uidRecibe && !nombreSuelto)) { console.error('uso: <remitoId> (<uidRecibe> | --nombre "NOMBRE") [--aplicar]'); process.exit(1) }

const PLANTA_DESTINO = 'merlo'
const PUNTALES_POR_PALLET = 4, AROS_POR_TARIMA_MADERA = 1, SOMBREROS_POR_PALLET = 1

const rSnap = await db.doc(`remitosCarga/${remitoId}`).get()
if (!rSnap.exists) throw new Error(`no existe remitosCarga/${remitoId}`)
const r = rSnap.data()
if (r.cotSolicitud?.destino?.tipo !== 'planta' || r.cotSolicitud.destino.plantaId !== PLANTA_DESTINO) {
  throw new Error(`el remito ${r.codigo} no tiene destino de COT "planta ${PLANTA_DESTINO}": ${JSON.stringify(r.cotSolicitud?.destino)}`)
}
const ya = await db.collection('descargasCamion').where('remitoId', '==', remitoId).get()
if (!ya.empty) throw new Error(`el remito ${r.codigo} ya tiene descarga: ${ya.docs.map((d) => d.id).join(', ')}`)
let recibe
if (uidRecibe) {
  const uSnap = await db.doc(`users/${uidRecibe}`).get()
  if (!uSnap.exists) throw new Error(`no existe users/${uidRecibe}`)
  recibe = { uid: uidRecibe, nombre: uSnap.data().nombre, rol: uSnap.data().rol }
} else {
  recibe = { uid: 'sin-usuario', nombre: nombreSuelto.trim().toUpperCase(), rol: 'sin usuario en la app' }
}

const fechaRemito = r.fecha.toDate()
const diaReparto = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fechaRemito)

const e = r.envases ?? { tarimasMadera: 0, palletsMetal: r.palletsCarga ?? 0, racks: [] }
const madera = Math.max(0, e.tarimasMadera - (e.tarimasMaderaSimples ?? 0))
const metal  = Math.max(0, e.palletsMetal - (e.palletsMetalSimples ?? 0))
const implicitos = { puntales: (madera + metal) * PUNTALES_POR_PALLET, aros: madera * AROS_POR_TARIMA_MADERA, sombreros: (madera + metal) * SOMBREROS_POR_PALLET }
const conteo = { tarimasMadera: e.tarimasMadera, palletsMetal: e.palletsMetal, ...implicitos }
const racks = [...new Set(e.racks ?? [])].sort((a, b) => a - b)
const envases = {
  ...conteo,
  ...(e.tarimasMaderaSimples ? { tarimasMaderaSimples: e.tarimasMaderaSimples } : {}),
  ...(e.palletsMetalSimples ? { palletsMetalSimples: e.palletsMetalSimples } : {}),
  racks,
}
const envasesCuadre = {
  salieron:  { ...conteo, racks },
  volvieron: { ...conteo, racks },
  diferencia: { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0 },
  racksFaltantes: [], racksSobrantes: [],
}

const descarga = {
  plantaId:     PLANTA_DESTINO,
  camionId:     r.camionId,
  camionLabel:  r.camionLabel,
  choferId:     r.choferId,
  choferNombre: r.choferNombre,
  ...(r.depositoTango ? { depositoTango: r.depositoTango, depositoTangoNombre: r.depositoTangoNombre ?? '' } : {}),
  remitoId,
  remitoCodigo: r.codigo,
  diaReparto,
  items:        r.items.map((i) => ({ productoId: i.productoId, nombre: i.nombre, cantidad: i.cantidad })),
  bolsasRotas:  [],
  envases,
  envasesCuadre,
  registradoPor: { uid: recibe.uid, nombre: recibe.nombre },
  fecha:        admin.firestore.Timestamp.now(),
  tango:        { estado: 'pendiente' },
  // Rastro de que esto fue un traslado registrado por script, no un conteo de tablet.
  traslado:     { desdePlanta: r.plantaId, script: 'descarga-traslado-merlo.mjs', fecha: new Date().toISOString() },
}

console.log(`Remito ${r.codigo} (${fechaRemito.toISOString()}) de ${r.choferNombre}, ${r.camionLabel}, depósito ${r.depositoTango}`)
console.log(`Descarga en ${PLANTA_DESTINO}, día de viaje ${diaReparto}, recibe ${recibe.nombre} (${recibe.rol})`)
console.log(JSON.stringify(descarga, null, 1))
if (!aplicar) { console.log('\n(sin --aplicar: no se escribió nada)'); process.exit(0) }
const ref = db.collection('descargasCamion').doc()
await ref.set(descarga)
console.log(`\nESCRITA descargasCamion/${ref.id}. El trigger la numera, encola la transferencia ${r.depositoTango} → 02 y cierra la mercadería del viaje.`)
