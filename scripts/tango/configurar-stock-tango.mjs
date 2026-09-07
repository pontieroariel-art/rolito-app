/**
 * configurar-stock-tango.mjs — config del circuito de STOCK por SQL en `config/tango`
 * (docs/tango/INTEGRACION.md §24): la factura de Rolito sin descarga de stock y el
 * egreso VPR en Redonhielo por cada venta promo. Corre contra PRODUCCIÓN
 * (scripts/serviceAccount.json) salvo que se exporte FIRESTORE_EMULATOR_HOST.
 *
 *   node scripts/tango/configurar-stock-tango.mjs                       → muestra la config actual
 *   node scripts/tango/configurar-stock-tango.mjs --rolito-sin-stock on → facturador.rolito.descargaStock = false
 *   node scripts/tango/configurar-stock-tango.mjs --usuario ROLITO --terminal APP
 *   node scripts/tango/configurar-stock-tango.mjs --tipo ventaPromo tipo=egreso tComp=VPR tcompInS=EG talonario=900 incluyeCambios=true
 *        → sql.stock.tipos.ventaPromo (merge con lo que haya; talonario = CÓDIGO del talonario de stock, 900)
 *   node scripts/tango/configurar-stock-tango.mjs --stock on|off        → stockSqlEnabled (el interruptor del bridge)
 *   node scripts/tango/configurar-stock-tango.mjs --tipo carga tipo=transferencia tComp=CAR tcompInS=TI talonario=13
 *   node scripts/tango/configurar-stock-tango.mjs --tipo descarga tipo=transferencia tComp=DES tcompInS=TI talonario=13
 *   node scripts/tango/configurar-stock-tango.mjs --transferencias on|off → transferenciasSqlEnabled (carga CAR / descarga DES, fase B)
 *
 * Orden recomendado: --rolito-sin-stock on ANTES de deployar las functions nuevas (así la
 * primera promo que pase ya no descuenta en Rolito); --tipo cuando exista VPR en Tango;
 * --stock on recién después de la prueba con --solo en el bridge.
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
const ref = db.doc('config/tango')

const args = process.argv.slice(2)
const valorDe = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const num = (v) => (/^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v)
const onOff = (v, flag) => { if (v !== 'on' && v !== 'off') throw new Error(`${flag} espera on|off`); return v === 'on' }

const update = {}
const sinStock = valorDe('--rolito-sin-stock')
if (sinStock !== undefined) update['facturador.rolito.descargaStock'] = !onOff(sinStock, '--rolito-sin-stock')
const usuario = valorDe('--usuario'); if (usuario) update['sql.stock.usuario'] = usuario
const terminal = valorDe('--terminal'); if (terminal) update['sql.stock.terminal'] = terminal
const stock = valorDe('--stock'); if (stock !== undefined) update['stockSqlEnabled'] = onOff(stock, '--stock')
const transf = valorDe('--transferencias'); if (transf !== undefined) update['transferenciasSqlEnabled'] = onOff(transf, '--transferencias')

const iTipo = args.indexOf('--tipo')
if (iTipo >= 0) {
  const clave = args[iTipo + 1]
  if (!clave || clave.startsWith('--')) throw new Error('--tipo necesita la clave (ventaPromo, carga, descarga) seguida de clave=valor')
  for (let i = iTipo + 2; i < args.length && !args[i].startsWith('--'); i++) {
    const k = args[i].indexOf('=')
    if (k < 0) throw new Error(`Esperaba clave=valor, recibí "${args[i]}"`)
    update[`sql.stock.tipos.${clave}.${args[i].slice(0, k)}`] = num(args[i].slice(k + 1))
  }
}

if (Object.keys(update).length) {
  await ref.set({}, { merge: true })
  await ref.update(update)
  console.log('Actualizado:', update)
}

const t = (await ref.get()).data() ?? {}
console.log('\nconfig/tango hoy:')
console.log('  facturador.rolito.descargaStock =', t.facturador?.rolito?.descargaStock, '(false = Rolito no descarga stock)')
console.log('  stockSqlEnabled                 =', t.stockSqlEnabled ?? false)
console.log('  transferenciasSqlEnabled        =', t.transferenciasSqlEnabled ?? false)
console.log('  depositosPlanta                 =', JSON.stringify(t.depositosPlanta ?? null))
console.log('  sql.stock                       =', JSON.stringify(t.sql?.stock ?? null, null, 2))
const faltan = []
if (t.facturador?.rolito?.descargaStock !== false) faltan.push('--rolito-sin-stock on')
if (!t.sql?.stock?.tipos?.ventaPromo?.talonario) faltan.push('--tipo ventaPromo tipo=egreso tComp=VPR tcompInS=<traza> talonario=900')
if (t.sql?.stock?.tipos?.carga?.tipo !== 'transferencia') faltan.push('--tipo carga tipo=transferencia tComp=CAR tcompInS=TI talonario=13')
if (t.sql?.stock?.tipos?.descarga?.tipo !== 'transferencia') faltan.push('--tipo descarga tipo=transferencia tComp=DES tcompInS=TI talonario=13')
if (!t.depositosPlanta?.torcuato || !t.depositosPlanta?.merlo) faltan.push('depositosPlanta {torcuato, merlo} (a mano en config/tango)')
console.log(faltan.length ? `\nFalta: ${faltan.join(' | ')}` : '\nConfig de stock completa.')
process.exit(0)
