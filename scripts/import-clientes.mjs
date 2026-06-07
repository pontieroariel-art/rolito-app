/**
 * Importación masiva de clientes desde Excel usando Firebase Admin SDK.
 * Sin límite de rate — crea las 4,168 cuentas en ~5-10 minutos.
 *
 * Uso:
 *   node scripts/import-clientes.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import admin from 'firebase-admin'

const require = createRequire(import.meta.url)
const XLSX    = require('xlsx')

// ── Configuración ─────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = 'C:/Users/Ariel/Desktop/rolito-app-firebase-adminsdk-fbsvc-e15e1d16f8.json'
const EXCEL_PATH           = 'C:/Users/Ariel/Desktop/04.06.2026 (1).xlsx'
const LOG_PATH             = 'scripts/import-errores.txt'
const BATCH_SIZE           = 50   // escrituras Firestore por batch
const DELAY_MS             = 50   // ms entre cuentas (evita saturar)

// ── Init Firebase Admin ───────────────────────────────────────────────────────

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const auth = admin.auth()
const db   = admin.firestore()

// ── Helpers ───────────────────────────────────────────────────────────────────

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || serial <= 0) return null
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
}

function cleanPhoneDigits(raw) {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(0, 20)
}

function buildNotasContacto(t1, t2) {
  return [t1, t2]
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean)
    .join(' / ')
}

const SECTOR_NORMALIZE = { MDQ: 'MDP' }

function extractSector(codCte) {
  const cod = String(codCte || '').trim()
  const match = cod.match(/^([A-Za-z]+)/)
  if (!match) return ''
  const s = match[1].toUpperCase()
  return SECTOR_NORMALIZE[s] ?? s
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Parsear Excel ─────────────────────────────────────────────────────────────

function parseExcel() {
  console.log('Leyendo Excel...')
  const wb    = XLSX.readFile(EXCEL_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  console.log(`  ${rows.length} filas encontradas`)

  const map = new Map()
  for (const row of rows) {
    const cuit = String(row['CUIT'] ?? '').trim()
    if (!cuit) continue
    if (!map.has(cuit)) map.set(cuit, [])
    map.get(cuit).push(row)
  }

  const clientes = []
  for (const [cuit, grupo] of map.entries()) {
    const first        = grupo[0]
    const cuitDigits   = cuit.replace(/\D/g, '')
    if (cuitDigits.length < 6) continue   // CUIT inválido (contraseña mínimo 6 chars)

    const emailAuth    = `${cuitDigits}@rolito.app`
    const emailContacto = String(first['E_MAIL'] ?? '').trim().toLowerCase()

    const addresses = grupo.map((row, idx) => {
      const domicilio  = String(row['DOMICILIO'] ?? '').trim()
      const localidad  = String(row['LOCALIDAD'] ?? '').trim()
      const cod        = String(row['COD_CTE '] ?? row['COD_CTE'] ?? '').trim()
      return {
        id:               cod || `addr-${idx}`,
        nombre:           cod || localidad || `Sucursal ${idx + 1}`,
        address:          [domicilio, localidad].filter(Boolean).join(', '),
        lat:              null,
        lng:              null,
        horarioApertura:  '',
        horarioCierre:    '',
        contactoNombre:   '',
        contactoTelefono: cleanPhoneDigits(row['TELEFONO_1']),
        esPrincipal:      idx === 0,
      }
    })

    const codigoCliente = String(first['COD_CTE '] ?? first['COD_CTE'] ?? '').trim()
    clientes.push({
      cuit,
      cuitDigits,
      emailAuth,
      emailContacto,
      password:      cuitDigits,
      razonSocial:   String(first['RAZON_SOCI'] ?? '').trim(),
      codigoCliente,
      sector:        extractSector(codigoCliente),
      telefono:      cleanPhoneDigits(first['TELEFONO_1']),
      notasContacto: buildNotasContacto(first['TELEFONO_1'], first['TELEFONO_2']),
      fechaAlta:     excelSerialToDate(first['FECHA_ALTA']),
      addresses,
    })
  }

  console.log(`  ${clientes.length} CUITs únicos`)
  return clientes
}

// ── Crear una cuenta ──────────────────────────────────────────────────────────

async function crearCuenta(cliente) {
  const { cuit, cuitDigits, emailAuth, emailContacto, password, razonSocial,
          codigoCliente, sector, telefono, notasContacto, fechaAlta, addresses } = cliente

  // 1. Crear usuario en Firebase Auth
  let uid
  try {
    const userRecord = await auth.createUser({
      email:         emailAuth,
      password,
      displayName:   razonSocial,
    })
    uid = userRecord.uid
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      // Ya existe → obtener el UID para asegurarnos de que el doc de Firestore existe
      const existing = await auth.getUserByEmail(emailAuth)
      uid = existing.uid

      // Verificar si el documento de Firestore ya existe
      const snap = await db.collection('users').doc(uid).get()
      if (snap.exists) return { status: 'skipped' }
      // Si el doc no existe, continuar para crearlo
    } else {
      throw err
    }
  }

  // 2. Documento en Firestore
  const firestoreData = {
    nombre:          razonSocial,
    email:           emailContacto || emailAuth,
    emailAuth,
    phone:           telefono,
    rol:             'cliente',
    estado:          'activo',
    address:         addresses[0]?.address ?? '',
    razonSocial,
    nombreContacto:  razonSocial,
    cuit,
    telefono,
    notasContacto,
    codigoCliente,
    sector:          sector ?? '',
    addresses,
    fechaCreacion:   admin.firestore.FieldValue.serverTimestamp(),
    fechaAprobacion: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor:     'importacion',
  }
  if (fechaAlta) firestoreData.fechaAlta = admin.firestore.Timestamp.fromDate(fechaAlta)

  await db.collection('users').doc(uid).set(firestoreData)

  // 3. Índice CUIT → email Auth
  await db.collection('cuitIndex').doc(cuitDigits).set({ email: emailAuth })

  return { status: 'created' }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const clientes = parseExcel()
  const total    = clientes.length

  let created = 0, skipped = 0, errors = 0
  const errorLines = []

  console.log(`\nImportando ${total} cuentas...\n`)

  for (let i = 0; i < total; i++) {
    const c = clientes[i]
    try {
      const result = await crearCuenta(c)
      if (result.status === 'created') created++
      else skipped++
    } catch (err) {
      errors++
      const line = `[${c.cuit}] ${c.razonSocial}: ${err.message}`
      errorLines.push(line)
      console.error('  ERROR:', line)
    }

    // Progreso cada 50 cuentas
    if ((i + 1) % 50 === 0 || i === total - 1) {
      const pct = Math.round(((i + 1) / total) * 100)
      process.stdout.write(`\r  ${i + 1}/${total} (${pct}%) · ${created} ok · ${skipped} existentes · ${errors} errores   `)
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS)
  }

  console.log('\n\n── Resultado ────────────────────────────────')
  console.log(`  Creadas:    ${created}`)
  console.log(`  Existentes: ${skipped}`)
  console.log(`  Errores:    ${errors}`)

  if (errorLines.length > 0) {
    writeFileSync(LOG_PATH, errorLines.join('\n'), 'utf8')
    console.log(`\n  Errores guardados en: ${LOG_PATH}`)
  }

  console.log('\n¡Listo!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
