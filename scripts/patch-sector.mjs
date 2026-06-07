/**
 * Parche: agrega campo `sector` a los clientes importados que no lo tienen.
 * Deriva el sector del campo codigoCliente (prefijo de COD_CTE).
 *
 * Uso:
 *   node scripts/patch-sector.mjs
 */

import { readFileSync } from 'fs'
import admin from 'firebase-admin'

const SERVICE_ACCOUNT_PATH = 'C:/Users/Ariel/Desktop/rolito-app-firebase-adminsdk-fbsvc-e15e1d16f8.json'
const BATCH_SIZE = 400
const DELAY_MS   = 50

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
}

const db = admin.firestore()

const SECTOR_NORMALIZE = { MDQ: 'MDP' }

function extractSector(codCte) {
  const cod = String(codCte || '').trim()
  const match = cod.match(/^([A-Za-z]+)/)
  if (!match) return ''
  const s = match[1].toUpperCase()
  return SECTOR_NORMALIZE[s] ?? s
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  console.log('Buscando clientes sin sector...')

  const snap = await db.collection('users')
    .where('rol', '==', 'cliente')
    .where('aprobadoPor', '==', 'importacion')
    .get()

  const toUpdate = snap.docs.filter((d) => {
    const data = d.data()
    return !data.sector && data.codigoCliente
  })

  console.log(`  ${toUpdate.length} clientes para parchear\n`)

  let done = 0
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const chunk = toUpdate.slice(i, i + BATCH_SIZE)
    for (const doc of chunk) {
      const sector = extractSector(doc.data().codigoCliente)
      if (sector) batch.update(doc.ref, { sector })
    }
    await batch.commit()
    done += chunk.length
    console.log(`  ${done}/${toUpdate.length} (${Math.round(done/toUpdate.length*100)}%)`)
    if (DELAY_MS > 0) await sleep(DELAY_MS)
  }

  console.log('\n¡Listo!')
  process.exit(0)
}

main().catch((err) => { console.error('Error:', err); process.exit(1) })
