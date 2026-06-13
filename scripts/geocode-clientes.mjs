/**
 * geocode-clientes.mjs
 * Geocodifica las direcciones de clientes que tienen lat: null en Firestore.
 *
 * Uso (PowerShell):
 *   $env:GMAPS_KEY="TU_KEY"; node scripts/geocode-clientes.mjs
 *
 * La key es la misma VITE_GOOGLE_MAPS_KEY del .env.local.
 * El script es idempotente: si ya tiene lat/lng, la saltea.
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const GMAPS_KEY = process.env.GMAPS_KEY
if (!GMAPS_KEY) {
  console.error('ERROR: falta la variable GMAPS_KEY')
  console.error('Usá: $env:GMAPS_KEY="tu_key"; node scripts/geocode-clientes.mjs')
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

// ── Parámetros ────────────────────────────────────────────────────────────────

const DELAY_MS       = 120   // ~8 req/seg (límite Google: 50 req/seg, pero siendo conservadores)
const COUNTRY_HINT   = ', Argentina'

// ── Geocodificar una dirección ─────────────────────────────────────────────────

async function geocode(address) {
  const query = encodeURIComponent(address + COUNTRY_HINT)
  const url   = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&region=ar&language=es&key=${GMAPS_KEY}`
  const res   = await fetch(url)
  const data  = await res.json()

  if (data.status !== 'OK' || !data.results?.length) return null

  const loc = data.results[0].geometry.location
  return { lat: loc.lat, lng: loc.lng }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Cargando clientes de Firestore...')

  // Leer todos los clientes
  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  console.log(`  ${snap.size} clientes encontrados`)

  let totalAddresses = 0
  let geocoded       = 0
  let skipped        = 0
  let errors         = 0

  for (const docSnap of snap.docs) {
    const data      = docSnap.data()
    const addresses = data.addresses ?? []

    // Filtrar las que no tienen coordenadas y tienen dirección
    const pending = addresses
      .map((a, i) => ({ ...a, _idx: i }))
      .filter((a) => (a.lat === null || a.lat === undefined) && a.address?.trim())

    if (pending.length === 0) continue

    totalAddresses += pending.length

    // Clonar el array de addresses para modificar in-place
    const updatedAddresses = [...addresses]

    for (const addr of pending) {
      const addrStr = addr.address.trim()
      process.stdout.write(`  [${docSnap.id.slice(0, 6)}] "${addrStr.slice(0, 50)}"... `)

      await sleep(DELAY_MS)

      try {
        const coords = await geocode(addrStr)
        if (coords) {
          updatedAddresses[addr._idx] = { ...updatedAddresses[addr._idx], lat: coords.lat, lng: coords.lng }
          console.log(`✓ ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`)
          geocoded++
        } else {
          console.log('✗ sin resultado')
          errors++
        }
      } catch (err) {
        console.log(`✗ error: ${err.message}`)
        errors++
      }
    }

    // Actualizar Firestore solo si hubo cambios
    const changed = pending.some((a) => updatedAddresses[a._idx].lat !== null)
    if (changed) {
      await db.collection('users').doc(docSnap.id).update({ addresses: updatedAddresses })
    }
  }

  console.log('\n── Resultado ────────────────────────────────')
  console.log(`  Direcciones pendientes:   ${totalAddresses}`)
  console.log(`  Geocodificadas con éxito: ${geocoded}`)
  console.log(`  Sin resultado:            ${errors}`)
  console.log(`  Ya tenían coordenadas:    ${skipped}`)
  console.log('\n¡Listo!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
