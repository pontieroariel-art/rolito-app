/**
 * configurar-retenciones-tango.mjs — carga en config/tango las cuentas de tesorería de
 * retenciones que usa el writer del recibo (Track R, relevamiento 2026-09-08:
 * docs/tango/sql/retenciones-recientes-2026-09-08.txt).
 *
 * En Tango cada retención del recibo es un renglón de tesorería sobre la cuenta de
 * retenciones de su tipo; el asiento necesita la cuenta CONTABLE (CUENTA.ID_CUENTA) de cada
 * una. Los ids coinciden en Redonhielo y Rolito salvo la de IVA, que en Rolito no existe
 * (por eso Rolito no la mapea: un recibo de Rolito con retención de IVA queda en error con
 * mensaje claro hasta que administración cree la cuenta 1132018 en su plan de cuentas).
 *
 *   node scripts/tango/configurar-retenciones-tango.mjs            → muestra qué cambiaría
 *   node scripts/tango/configurar-retenciones-tango.mjs --aplicar  → escribe
 *   node scripts/tango/configurar-retenciones-tango.mjs --aplicar --rolito-iva=<ID_CUENTA>
 *        → además mapea la retención de IVA en Rolito cuando exista la cuenta contable.
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

const APLICAR = process.argv.includes('--aplicar')
const rolitoIvaArg = process.argv.find((a) => a.startsWith('--rolito-iva='))
const ROLITO_IVA = rolitoIvaArg ? Number(rolitoIvaArg.split('=')[1]) : null

// Cuenta de tesorería (SBA01.COD_CTA) por tipo de retención de la app — iguales en las dos bases.
const RETENCIONES = {
  ganancias: { cuenta: 1132004 },   // RETENC. IMP. A LAS GANANCIAS
  iva:       { cuenta: 1132018 },   // RETENCION IVA
  iibb_caba: { cuenta: 1132012 },   // RETENCION IIBB CABA
  iibb_pba:  { cuenta: 1132010 },   // RETENCION IIBB BS. AS.
  suss:      { cuenta: 1131003 },   // RETENCION S.U.S.S.
}
// Cuenta contable (CUENTA.ID_CUENTA) de cada una en Redonhielo (config global).
const CONTABLES_REDONHIELO = { '1131003': 630, '1132004': 634, '1132010': 640, '1132012': 1112, '1132018': 1193 }
// En Rolito coinciden 630/634/640/1112; 1132018 no tiene cuenta contable (2026-09-08).
const { iva: _iva, ...RETENCIONES_ROLITO } = RETENCIONES
if (ROLITO_IVA) RETENCIONES_ROLITO.iva = RETENCIONES.iva

const ref = db.collection('config').doc('tango')
const cfg = (await ref.get()).data() ?? {}
const actualGlobal = cfg.sql?.recibo ?? {}
const actualRolito = cfg.sql?.empresas?.rolito?.recibo ?? {}
console.log('config/tango.sql.recibo.retenciones (actual):', JSON.stringify(actualGlobal.retenciones ?? null))
console.log('config/tango.sql.recibo.cuentasContables (actual):', JSON.stringify(actualGlobal.cuentasContables ?? null))
console.log('config/tango.sql.empresas.rolito.recibo (actual):', JSON.stringify(actualRolito))

const update = {
  'sql.recibo.retenciones': RETENCIONES,
  'sql.empresas.rolito.recibo.retenciones': RETENCIONES_ROLITO,
}
for (const [cod, id] of Object.entries(CONTABLES_REDONHIELO)) update[`sql.recibo.cuentasContables.${cod}`] = id
// Si Rolito ya tuviera su propio mapa de cuentas contables, se le agregan las de retención (sin IVA salvo --rolito-iva).
if (actualRolito.cuentasContables) {
  for (const [cod, id] of Object.entries(CONTABLES_REDONHIELO)) if (cod !== '1132018') update[`sql.empresas.rolito.recibo.cuentasContables.${cod}`] = id
  if (ROLITO_IVA) update['sql.empresas.rolito.recibo.cuentasContables.1132018'] = ROLITO_IVA
} else if (ROLITO_IVA && ROLITO_IVA !== CONTABLES_REDONHIELO['1132018']) {
  // Rolito usa el mapa global: si su id de IVA difiere del de Redonhielo hace falta un mapa propio completo.
  update['sql.empresas.rolito.recibo.cuentasContables'] = { ...(actualGlobal.cuentasContables ?? {}), ...CONTABLES_REDONHIELO, '1132018': ROLITO_IVA }
}

console.log('\nCambios:')
for (const [k, v] of Object.entries(update)) console.log(`  ${k} = ${JSON.stringify(v)}`)
if (!APLICAR) { console.log('\n(dry-run) nada escrito; correr con --aplicar'); process.exit(0) }
await ref.update(update)
console.log('\nListo: configuración escrita.')
process.exit(0)
