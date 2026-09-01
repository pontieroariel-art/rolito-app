/**
 * auditoria-clientes-fiscal.mjs
 *
 * Audita que cada cliente tenga los datos fiscales necesarios para poder
 * emitirle una factura electronica contra ARCA (WSFEv1). Ver
 * docs/arca/FACTURACION_ELECTRONICA.md.
 *
 * Que se necesita para facturar (y por lo tanto que se valida aca):
 *   1. Condicion frente al IVA -- define el tipo de comprobante (A/B/C) y viaja
 *      obligatoria en el campo <CondicionIVAReceptorId> desde la RG 5616.
 *      En la app llega como users/{uid}.categoriaIvaTango (sync desde Tango).
 *   2. CUIT valido -- para comprobantes A el comprador se identifica con
 *      DocTipo 80 + DocNro. ARCA valida contra su padron, asi que un CUIT con
 *      digito verificador malo es un rechazo garantizado (validacion 1417).
 *   3. Razon social -- para imprimir el comprobante.
 *
 * NO escribe nada: es solo diagnostico. Genera un reporte por consola, un JSON
 * con el detalle y un CSV para revisar comodo en Excel.
 *
 * Uso:
 *   node scripts/arca/auditoria-clientes-fiscal.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../../functions/node_modules/firebase-admin/lib/index.js')

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json')
const SALIDA_DIR           = path.join(__dirname, 'salida')

// ── Mapeo condicion IVA: codigo de Tango -> CondicionIVAReceptorId de ARCA ────
// Los codigos de ARCA salen del anexo "Condicion Frente al IVA del receptor"
// del manual RG 4291. Los de Tango, del campo COD_CATEGORIA_IVA.
const CONDICION_IVA = {
  RI:  { arca: 1,  desc: 'IVA Responsable Inscripto',   comprobante: 'A' },
  RS:  { arca: 6,  desc: 'Responsable Monotributo',     comprobante: 'A' },
  EX:  { arca: 4,  desc: 'IVA Sujeto Exento',           comprobante: 'A' },
  CF:  { arca: 5,  desc: 'Consumidor Final',            comprobante: 'B' },
  NC:  { arca: 7,  desc: 'Sujeto No Categorizado',      comprobante: 'B' },
  NA:  { arca: 15, desc: 'IVA No Alcanzado',            comprobante: 'B' },
}

// Categorias que existen en Tango pero NO corresponden a una venta de mostrador
// o de calle -- se marcan aparte para revision manual, no se asume nada.
const CONDICION_IVA_ESPECIAL = {
  EXE: 'IVA exento operacion de exportacion -- no aplica a venta en calle',
}

/**
 * Valida el digito verificador de un CUIT con el algoritmo oficial.
 * Un CUIT con formato correcto pero DV malo pasa cualquier chequeo de largo
 * y despues lo rechaza ARCA, asi que conviene detectarlo aca.
 */
function cuitValido(cuit) {
  const limpio = String(cuit ?? '').replace(/\D/g, '')
  if (limpio.length !== 11) return false
  if (/^(\d)\1{10}$/.test(limpio)) return false        // 00000000000, 11111111111...

  const prefijo = limpio.slice(0, 2)
  if (!['20', '23', '24', '25', '26', '27', '30', '33', '34'].includes(prefijo)) return false

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(limpio[i]), 0)
  const resto = suma % 11
  let dv = 11 - resto
  if (dv === 11) dv = 0
  if (dv === 10) dv = 9

  return dv === Number(limpio[10])
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

async function main() {
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  const snap = await db.collection('users').where('rol', '==', 'cliente').get()
  console.log(`Clientes analizados: ${snap.size}\n`)

  const filas = []

  snap.forEach((doc) => {
    const u = doc.data()
    const problemas = []

    // 1. Condicion frente al IVA
    const cat = (u.categoriaIvaTango ?? '').trim().toUpperCase()
    let condicion = null
    if (!cat) {
      problemas.push('SIN_CONDICION_IVA')
    } else if (CONDICION_IVA_ESPECIAL[cat]) {
      problemas.push('CONDICION_IVA_ESPECIAL')
    } else if (!CONDICION_IVA[cat]) {
      problemas.push('CONDICION_IVA_DESCONOCIDA')
    } else {
      condicion = CONDICION_IVA[cat]
    }

    // 2. CUIT. Para comprobante A es obligatorio e identifica al comprador.
    const cuit = String(u.cuit ?? '').replace(/\D/g, '')
    if (!cuit) {
      problemas.push('SIN_CUIT')
    } else if (!cuitValido(cuit)) {
      problemas.push('CUIT_INVALIDO')
    }

    // 3. Razon social, para imprimir el comprobante.
    if (!String(u.razonSocial ?? u.nombreEmpresa ?? '').trim()) {
      problemas.push('SIN_RAZON_SOCIAL')
    }

    filas.push({
      uid: doc.id,
      razonSocial: u.razonSocial ?? u.nombreEmpresa ?? '',
      cuit,
      categoriaIvaTango: cat,
      categoriaIvaDesc: u.categoriaIvaTangoDesc ?? '',
      condicionIvaArca: condicion?.arca ?? null,
      comprobante: condicion?.comprobante ?? null,
      codigoTango: u.codigoTango ?? '',
      estado: u.estado ?? '',
      facturable: problemas.length === 0,
      problemas,
    })
  })

  const ok       = filas.filter((f) => f.facturable)
  const conProbl = filas.filter((f) => !f.facturable)

  // ── Reporte por consola ────────────────────────────────────────────────────
  const porProblema = {}
  for (const f of conProbl) {
    for (const p of f.problemas) (porProblema[p] ??= []).push(f)
  }

  console.log('===== RESUMEN =====')
  console.log(`  Facturables:      ${ok.length}`)
  console.log(`  CON PROBLEMAS:    ${conProbl.length}`)
  console.log('')
  console.log('Desglose por problema (un cliente puede tener mas de uno):')
  for (const [p, lista] of Object.entries(porProblema).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(lista.length).padStart(4)}  ${p}`)
  }

  console.log('\n===== DETALLE POR PROBLEMA =====')
  for (const [p, lista] of Object.entries(porProblema).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n-- ${p}  (${lista.length})`)
    for (const f of lista.slice(0, 25)) {
      console.log(`   ${(f.codigoTango || '------').padEnd(8)} ${(f.cuit || 'sin cuit').padEnd(12)} ${(f.categoriaIvaTango || '--').padEnd(4)} ${f.razonSocial.slice(0, 45)}`)
    }
    if (lista.length > 25) console.log(`   ... y ${lista.length - 25} mas (ver el CSV)`)
  }

  // Reparto por tipo de comprobante de los que SI se pueden facturar
  const porComprobante = ok.reduce((acc, f) => {
    acc[f.comprobante] = (acc[f.comprobante] ?? 0) + 1
    return acc
  }, {})
  console.log('\n===== FACTURABLES POR TIPO DE COMPROBANTE =====')
  for (const [c, n] of Object.entries(porComprobante)) console.log(`  Factura ${c}: ${n}`)

  // ── Archivos de salida ─────────────────────────────────────────────────────
  mkdirSync(SALIDA_DIR, { recursive: true })

  const jsonPath = path.join(SALIDA_DIR, 'auditoria-fiscal.json')
  writeFileSync(jsonPath, JSON.stringify(filas, null, 2), 'utf8')

  const csvPath = path.join(SALIDA_DIR, 'auditoria-fiscal-problemas.csv')
  const cols = ['codigoTango', 'razonSocial', 'cuit', 'categoriaIvaTango', 'categoriaIvaDesc', 'estado', 'problemas', 'uid']
  const csv = [
    cols.join(';'),
    ...conProbl.map((f) => cols.map((c) => csvEscape(Array.isArray(f[c]) ? f[c].join(' + ') : f[c])).join(';')),
  ].join('\n')
  writeFileSync(csvPath, '﻿' + csv, 'utf8')   // BOM para que Excel respete acentos

  console.log(`\nDetalle completo: ${jsonPath}`)
  console.log(`Para revisar:     ${csvPath}`)

  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
