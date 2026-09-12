/**
 * backfill-claims.mjs — carga rol/estado/planta/permisos en el token (custom claims)
 * de TODOS los usuarios existentes (auditoría de performance 2026-09-12). Después
 * de esto, las reglas de Firestore no leen users/{uid} en cada consulta.
 *
 *   node scripts/backfill-claims.mjs            → muestra cuántos cambiarían
 *   node scripts/backfill-claims.mjs --commit   → los escribe
 *
 * No toca los documentos: el usuario logueado toma los claims nuevos en su próximo
 * refresco de token (dentro de la hora) o al volver a entrar. Los cambios
 * posteriores los mantiene el trigger onUserClaims.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const auth = admin.auth()
const COMMIT = process.argv.includes('--commit')

// Misma lógica que functions/src/triggers/claims.ts (claimsDeUsuario / mismosClaims).
function claimsDeUsuario(d) {
  const rol = String(d.rol ?? d.role ?? '')
  if (!rol) return null
  const c = { rol, estado: String(d.estado ?? 'activo') }
  if (typeof d.planta === 'string' && d.planta) c.planta = d.planta
  if (typeof d.area === 'string' && d.area) c.area = d.area
  if (Array.isArray(d.rolesExtra) && d.rolesExtra.length) c.rolesExtra = d.rolesExtra.map(String)
  if (d.autorizaAnulaciones === true) c.autorizaAnulaciones = true
  return c
}
const CLAVES = ['rol', 'estado', 'planta', 'area', 'rolesExtra', 'autorizaAnulaciones']
const mismos = (a = {}, d) => d ? CLAVES.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(d[k] ?? null)) : CLAVES.every((k) => a[k] === undefined)

const users = await db.collection('users').get()
console.log(`users: ${users.size}`)
let cambian = 0, iguales = 0, sinAuth = 0, errores = 0
const porRol = {}
const cola = users.docs.slice()
const CONCURRENCIA = 5
async function trabajador() {
  while (cola.length) {
    const d = cola.shift()
    const deseados = claimsDeUsuario(d.data())
    if (!deseados) continue
    let u
    try { u = await auth.getUser(d.id) } catch { sinAuth++; continue }
    if (mismos(u.customClaims, deseados)) { iguales++; continue }
    cambian++
    porRol[deseados.rol] = (porRol[deseados.rol] ?? 0) + 1
    if (COMMIT) {
      try { await auth.setCustomUserClaims(d.id, { ...(u.customClaims ?? {}), ...deseados }) }
      catch (e) { errores++; console.error('  error', d.id, e.message) }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador))
console.log(`${COMMIT ? 'Escritos' : 'Cambiarían'}: ${cambian} · ya iguales: ${iguales} · sin usuario de Auth: ${sinAuth} · errores: ${errores}`)
console.log('por rol:', JSON.stringify(porRol))
if (!COMMIT) console.log('Sin --commit no se escribió nada.')
process.exit(0)
