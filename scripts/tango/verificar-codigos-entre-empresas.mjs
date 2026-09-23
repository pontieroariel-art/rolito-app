/**
 * verificar-codigos-entre-empresas.mjs — ¿el mismo cliente tiene el mismo código
 * en Redonhielo y en Rolito? (2026-09-20)
 *
 * Hace falta saberlo antes de armar el resumen de cuenta: si los códigos (y las
 * sucursales) coinciden entre las dos empresas, el selector de sucursal vale
 * para las dos y la tira de saldos se arma sola. Si no coinciden, hay que
 * emparejarlas de otra forma o mostrar cada empresa con sus propias sucursales.
 *
 * Mira `users.tangoIds` (lo escribe la sync de clientes por CUIT).
 *
 * SOLO LEE.
 *
 *   node scripts/tango/verificar-codigos-entre-empresas.mjs
 */

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

const codigos = (perfil, empresa) => {
  const lista = (perfil?.tangoIds?.[empresa] ?? []).filter((x) => x?.codigo).map((x) => String(x.codigo).trim())
  // Compat: el principal viejo de Redonhielo vive en codigoTango.
  if (empresa === 'redonhielo' && perfil?.codigoTango && !lista.includes(String(perfil.codigoTango).trim())) {
    lista.unshift(String(perfil.codigoTango).trim())
  }
  return [...new Set(lista)]
}

const snap = await db.collection('users').where('rol', '==', 'cliente').get()

let soloRh = 0, soloRo = 0, ninguna = 0
const enLasDos = []
for (const d of snap.docs) {
  const p = d.data()
  const rh = codigos(p, 'redonhielo')
  const ro = codigos(p, 'rolito')
  if (!rh.length && !ro.length) { ninguna++; continue }
  if (!ro.length) { soloRh++; continue }
  if (!rh.length) { soloRo++; continue }
  enLasDos.push({ uid: d.id, nombre: p.razonSocial ?? p.nombre ?? '(sin nombre)', cuit: p.cuit ?? '', rh, ro })
}

console.log(`\nClientes: ${snap.size}`)
console.log(`  solo Redonhielo: ${soloRh}`)
console.log(`  solo Rolito:     ${soloRo}`)
console.log(`  en las DOS:      ${enLasDos.length}`)
console.log(`  sin vincular:    ${ninguna}\n`)

const iguales = [], distintos = [], parciales = []
for (const c of enLasDos) {
  const a = [...c.rh].sort().join(','), b = [...c.ro].sort().join(',')
  if (a === b) iguales.push(c)
  else if (c.rh.some((x) => c.ro.includes(x))) parciales.push(c)
  else distintos.push(c)
}

console.log(`De los ${enLasDos.length} que están en las dos empresas:`)
console.log(`  MISMOS códigos exactamente:        ${iguales.length}`)
console.log(`  se pisan en parte (falta alguna):  ${parciales.length}`)
console.log(`  códigos TOTALMENTE distintos:      ${distintos.length}\n`)

const mostrar = (titulo, lista, tope = 15) => {
  if (!lista.length) return
  console.log(`${titulo}:`)
  for (const c of lista.slice(0, tope)) {
    console.log(`  ${String(c.nombre).slice(0, 34).padEnd(36)} RH: ${c.rh.join(' ')}`)
    console.log(`  ${''.padEnd(36)} RO: ${c.ro.join(' ')}`)
  }
  if (lista.length > tope) console.log(`  … y ${lista.length - tope} más`)
  console.log('')
}

mostrar('Se pisan en parte (una empresa tiene sucursales que la otra no)', parciales)
mostrar('Totalmente distintos — acá el selector de sucursal NO sirve para las dos', distintos)

process.exit(0)
