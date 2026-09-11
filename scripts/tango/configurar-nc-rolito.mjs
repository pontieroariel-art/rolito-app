/**
 * configurar-nc-rolito.mjs — carga en config/tango.facturador.rolito lo que necesita la nota de
 * crédito X de una promo anulada (2026-09-11) para entrar a Tango Rolito por el Facturador:
 * los talonarios de NC (uno por letra, A y B) y el tipo de comprobante de NC de esa empresa.
 *
 *   node scripts/tango/configurar-nc-rolito.mjs --talonarioA 1107 --talonarioB 1108
 *   node scripts/tango/configurar-nc-rolito.mjs --talonarioA 1107 --talonarioB 1108 --tipo N/C
 *
 * --tipo: código del tipo de comprobante de NC en Tango Rolito (default 'NC'). Sin --talonarioX
 * no se toca esa letra. Muestra antes/después y no borra nada.
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

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? String(process.argv[i + 1] ?? '').trim() : '' }
const A = arg('talonarioA'), B = arg('talonarioB'), tipo = arg('tipo') || 'NC'
if (!A && !B) { console.error('Uso: --talonarioA <nº> --talonarioB <nº> [--tipo NC]'); process.exit(1) }
for (const [letra, v] of [['A', A], ['B', B]]) if (v && !/^\d+$/.test(v)) { console.error(`El talonario ${letra} tiene que ser un número (es el ID del talonario en Tango): "${v}"`); process.exit(1) }

const ref = db.doc('config/tango')
const antes = (await ref.get()).data()?.facturador?.rolito ?? {}
console.log('Antes :', JSON.stringify({ talonariosNC: antes.talonariosNC ?? null, codigoTipoNC: antes.codigoTipoNC ?? null }))

await ref.set({
  facturador: {
    rolito: {
      codigoTipoNC: tipo,
      ncCanceladoCompletamente: false,
      ncSinReferencia: false,
      talonariosNC: { ...(A ? { A: Number(A) } : {}), ...(B ? { B: Number(B) } : {}) },
    },
  },
}, { merge: true })

const despues = (await ref.get()).data()?.facturador?.rolito ?? {}
console.log('Ahora :', JSON.stringify({ talonariosNC: despues.talonariosNC ?? null, codigoTipoNC: despues.codigoTipoNC ?? null }))
if (!despues.talonariosNC?.A || !despues.talonariosNC?.B) console.log('OJO: falta el talonario de la letra', !despues.talonariosNC?.A ? 'A' : 'B', '— la NC de un cliente con esa letra va a quedar en error hasta cargarlo.')
process.exit(0)
