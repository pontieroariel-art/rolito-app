/**
 * migrar-pin-produccion.mjs
 * Migración del login de producción de "contraseña fija en el bundle" a
 * PIN individual (auditoría 2026-08-29, hallazgo H1). Ver
 * src/services/produccionAuthService.ts (padPinProduccion).
 *
 * Para CADA operario existente (rol 'produccion_hielo') le setea la contraseña
 * de Firebase Auth a un PIN aleatorio de 4 dígitos (no adivinable: NO usa el
 * legajo, que es semi-público por el índice de login), en el formato
 * "<pin>__pr". Imprime la lista nombre/legajo → PIN para que se la comunique a
 * cada uno. Guardá esa salida: el PIN no queda en ningún lado consultable.
 *
 * IMPORTANTE — orden del cambio (para no dejar a la planta afuera):
 *   1. Correr ESTE script con --aplicar (setea los PIN sobre las cuentas
 *      actuales; el login viejo por contraseña fija sigue funcionando hasta el
 *      deploy, así que este paso no interrumpe nada).
 *   2. Deploy del código nuevo (login pide PIN) — coordinar FUERA de turno.
 *   3. Comunicar a cada operario su PIN (de la salida de este script).
 *
 * Si un operario olvida el PIN: volver a correr este script (le regenera uno) o,
 * más adelante, un reset desde la pantalla del encargado (mejora pendiente).
 *
 * Uso:
 *   node scripts/migrar-pin-produccion.mjs           # dry-run (no escribe)
 *   node scripts/migrar-pin-produccion.mjs --aplicar # aplica y lista los PIN
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')

const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const auth = admin.auth()
const db   = admin.firestore()

// Mismo formato que src/services/produccionAuthService.ts (padPinProduccion).
const padPinProduccion = (pin) => `${String(pin).replace(/\D/g, '')}__pr`

// PIN aleatorio de 4 dígitos (1000–9999, sin ceros a la izquierda que se
// pierdan). No se deriva del legajo a propósito: el legajo es semi-público.
const nuevoPin = () => String(Math.floor(1000 + Math.random() * 9000))

const APLICAR = process.argv.includes('--aplicar')

async function main() {
  const snap = await db.collection('users').where('rol', '==', 'produccion_hielo').get()
  const operarios = snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((o) => o.legajo)

  console.log(`${operarios.length} operarios de producción encontrados.`)
  console.log(APLICAR ? '── APLICANDO cambios ──\n' : '── DRY-RUN (agregá --aplicar para escribir) ──\n')

  let ok = 0, errores = 0
  for (const op of operarios) {
    const nombre = op.nombre ?? op.nombreContacto ?? '(sin nombre)'

    if (!APLICAR) {
      console.log(`  ${nombre} · legajo ${op.legajo} → PIN (se genera al aplicar)`)
      ok++
      continue
    }

    const pin = nuevoPin()
    try {
      const email = op.email || `${op.legajo}@produccion.rolito.internal`
      const user  = await auth.getUserByEmail(email)
      await auth.updateUser(user.uid, { password: padPinProduccion(pin) })
      console.log(`  ${nombre} · legajo ${op.legajo} → PIN ${pin}  ✓`)
      ok++
    } catch (err) {
      console.log(`  ${nombre} · legajo ${op.legajo}  ✗ ${err.message}`)
      errores++
    }
  }

  console.log('\n── Resultado ────────────────────────────────')
  console.log(`  ${APLICAR ? 'Migrados' : 'A migrar'}: ${ok}`)
  if (APLICAR) {
    console.log(`  Errores:  ${errores}`)
    console.log('\n⚠  Guardá la lista de PIN de arriba: es la única copia. Comunicáselos a cada operario.')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Error fatal:', err)
  process.exit(1)
})
