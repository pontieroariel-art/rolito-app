/**
 * import-clientes.mjs
 * Importación masiva de clientes desde Excel usando Firebase Admin SDK.
 *
 * Uso:
 *   node scripts/import-clientes.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require  = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin    = require('../functions/node_modules/firebase-admin/lib/index.js')
const XLSX     = require('../node_modules/xlsx/xlsx.js')

// ── Configuración ─────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccount.json')
const EXCEL_PATH           = 'C:/Users/Ariel/Desktop/NOMINA CLIENTE APP ROLITO.xlsx'
const LOG_PATH             = path.join(__dirname, 'import-errores.txt')
const BATCH_SIZE           = 400
const DELAY_MS             = 30

// ── Init Firebase Admin ───────────────────────────────────────────────────────

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const auth = admin.auth()
const db   = admin.firestore()

// ── Helpers ───────────────────────────────────────────────────────────────────

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || serial <= 0) return null
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
}

function cleanStr(v) {
  return v != null ? String(v).trim() : ''
}

function cleanPhone(v) {
  return cleanStr(v).slice(0, 30)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Parsear Excel ─────────────────────────────────────────────────────────────

function parseExcel() {
  console.log('Leyendo Excel...')
  const wb         = XLSX.readFile(EXCEL_PATH)
  const sheetName  = wb.SheetNames.find((n) => n.trim() === 'Clientes') ?? wb.SheetNames[0]
  console.log(`  Usando hoja: "${sheetName}"`)
  const sheet = wb.Sheets[sheetName]
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  console.log(`  ${rows.length} filas encontradas`)

  // Agrupar por IDENTIFTRI (CUIT)
  const map = new Map()
  for (const row of rows) {
    const cuit = cleanStr(row['IDENTIFTRI'])
    if (!cuit) continue
    if (!map.has(cuit)) map.set(cuit, [])
    map.get(cuit).push(row)
  }

  const clientes = []

  for (const [cuit, grupo] of map.entries()) {
    const cuitDigits = cuit.replace(/\D/g, '')
    if (cuitDigits.length < 6) continue

    const first      = grupo[0]
    const emailReal  = cleanStr(first['E_MAIL']).toLowerCase()
    const emailAuth  = `${cuitDigits}@rolito.app`

    // Una sucursal (address) por fila
    const addresses = grupo.map((row, idx) => {
      const dirEntrega = cleanStr(row['DIR_COMERC']) || cleanStr(row['DOMICILIO'])
      const localidad  = cleanStr(row['LOCALIDAD'])
      const nomSucursal = cleanStr(row['NOM_COMERC']) || cleanStr(row['RAZON_SOCI'])
      return {
        id:               cleanStr(row['COD_CLIENT']) || `addr-${idx}`,
        nombre:           nomSucursal || localidad || `Sucursal ${idx + 1}`,
        address:          [dirEntrega, localidad].filter(Boolean).join(', '),
        domicilioFiscal:  cleanStr(row['DOMICILIO']),
        localidad,
        codigoPostal:     cleanStr(row['C_POSTAL']),
        nroSucursal:      cleanStr(row['NRO_SUCURS']),
        codZona:          cleanStr(row['COD_ZONA']),
        codigoCliente:    cleanStr(row['COD_CLIENT']),
        contactoNombre:   cleanStr(row['NOM_CONTAC']),
        contactoTelefono: cleanPhone(row['TEL_CONTAC']),
        contactoEmail:    cleanStr(row['EMAIL_CONT']).toLowerCase(),
        contactoCargo:    cleanStr(row['CARGO_CONT']),
        horarioApertura:  '',
        horarioCierre:    '',
        lat:              null,
        lng:              null,
        esPrincipal:      idx === 0,
      }
    })

    const fechaAltaDate = excelSerialToDate(first['FECHA_ALTA'])

    clientes.push({
      cuit,
      cuitDigits,
      emailAuth,
      emailReal,
      password:        cuitDigits,
      razonSocial:     cleanStr(first['RAZON_SOCI']),
      nombreComercial: cleanStr(first['NOM_COMERC']),
      tipoIva:         cleanStr(first['TIPO_IVA']),
      codVendedor:     cleanStr(first['COD_VENDED']),
      condicionVenta:  cleanStr(first['COND_VTA']),
      nroLista:        Number(first['NRO_LISTA']) || 0,
      telefono1:       cleanPhone(first['TELEFONO_1']),
      telefono2:       cleanPhone(first['TELEFONO_2']),
      observaciones:   cleanStr(first['OBSERVACIO']),
      fechaAltaDate,
      addresses,
    })
  }

  console.log(`  ${clientes.length} CUITs únicos\n`)
  return clientes
}

// ── Crear una cuenta ──────────────────────────────────────────────────────────

async function crearCuenta(cliente) {
  const {
    cuit, cuitDigits, emailAuth, emailReal, password,
    razonSocial, nombreComercial, tipoIva, codVendedor,
    condicionVenta, nroLista, telefono1, telefono2,
    observaciones, fechaAltaDate, addresses,
  } = cliente

  // 1. Crear cuenta en Firebase Auth
  let uid
  try {
    const record = await auth.createUser({ email: emailAuth, password, displayName: razonSocial })
    uid = record.uid
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const existing = await auth.getUserByEmail(emailAuth)
      uid = existing.uid
      const snap = await db.collection('users').doc(uid).get()
      if (snap.exists) return 'skipped'
    } else {
      throw err
    }
  }

  // 2. Documento en Firestore
  const doc = {
    nombre:          razonSocial,
    nombreContacto:  razonSocial,
    razonSocial,
    nombreComercial,
    cuit,
    email:           emailReal || emailAuth,
    emailAuth,
    phone:           telefono1,
    telefono2,
    tipoIva,
    codVendedor,
    condicionVenta,
    nroLista,
    observaciones,
    rol:             'cliente',
    estado:          'activo',
    address:         addresses[0]?.address ?? '',
    codigoCliente:   addresses[0]?.codigoCliente ?? '',
    addresses,
    fechaCreacion:   admin.firestore.FieldValue.serverTimestamp(),
    fechaAprobacion: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor:     'importacion',
  }
  if (fechaAltaDate) doc.fechaAlta = admin.firestore.Timestamp.fromDate(fechaAltaDate)

  await db.collection('users').doc(uid).set(doc)

  // 3. Índice CUIT
  await db.collection('cuitIndex').doc(cuitDigits).set({ email: emailAuth })

  return 'created'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const clientes = parseExcel()
  const total    = clientes.length
  let created = 0, skipped = 0, errors = 0
  const errorLines = []

  console.log(`Importando ${total} cuentas...\n`)

  for (let i = 0; i < total; i++) {
    const c = clientes[i]
    try {
      const result = await crearCuenta(c)
      if (result === 'created') created++
      else skipped++
    } catch (err) {
      errors++
      const line = `[${c.cuit}] ${c.razonSocial}: ${err.message}`
      errorLines.push(line)
      console.error('\n  ERROR:', line)
    }

    if ((i + 1) % 50 === 0 || i === total - 1) {
      const pct = Math.round(((i + 1) / total) * 100)
      process.stdout.write(`\r  ${i + 1}/${total} (${pct}%) · ${created} creadas · ${skipped} existentes · ${errors} errores   `)
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
