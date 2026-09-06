// Alta automática de cuentas de cliente desde Tango (padrón maestro, 2026-09-06).
//
// La sync de clientes (tangoConnectSync.ts) deja en `tango-altas/{cuit}` un
// doc por CUIT válido y habilitado que no tiene cuenta en la app. Acá se
// procesan: Auth (<cuit>@rolito.app / contraseña = CUIT) + users/{uid} +
// cuitIndex/{cuit}. Corre por barrido cada 10 min y a pedido desde el panel.
//
// Interruptores en config/tango.altas:
//   enabled: true  → la sync ENCOLA candidatos (el panel muestra cuántos).
//   crear:   true  → este módulo CREA las cuentas. Sin esto es un dry-run:
//                    se ve qué se crearía sin tocar nada (primera corrida).
//
// Nunca crea en estado 'pendiente' ni con `creadoPor`: eso dispararía los
// emails de onUserRegistered / onClienteCreadoPorStaff (triggers/users.ts).

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { docCuentaDesdeTango, emailAuthDe, type CandidatoAlta } from '../services/tango/clientes'
import { assertRateLimit } from '../rateLimit'

const TZ = 'America/Argentina/Buenos_Aires'
const ROLES_ALTAS = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'facturacion'])
const MAX_POR_CORRIDA = 400
const DELAY_MS = 30   // rate limit de Auth (igual que scripts/import-clientes.mjs)

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ResumenAltas {
  procesadas: number
  creadas: number
  existian: number
  errores: number
  pendientesRestantes: number
  detalleErrores: Array<{ cuit: string; motivo: string }>
  crear: boolean
}

export async function procesarAltasTango(db: Firestore, opts: { crear: boolean; max?: number }): Promise<ResumenAltas> {
  const auth = getAuth()
  const max = opts.max ?? MAX_POR_CORRIDA
  const snap = await db.collection('tango-altas').where('estado', '==', 'pendiente').limit(max).get()
  const resumen: ResumenAltas = { procesadas: 0, creadas: 0, existian: 0, errores: 0, pendientesRestantes: 0, detalleErrores: [], crear: opts.crear }

  for (const d of snap.docs) {
    const candidato = d.data() as CandidatoAlta & { estado: string }
    resumen.procesadas++
    if (!opts.crear) continue
    const cuit = candidato.cuit
    const emailAuth = emailAuthDe(cuit)
    try {
      // ¿Apareció una cuenta con ese CUIT mientras tanto (alta a mano, autorregistro)?
      const idx = await db.doc(`cuitIndex/${cuit}`).get()
      if (idx.exists) {
        await d.ref.update({ estado: 'existia', motivo: `cuitIndex ya apunta a ${idx.data()?.email}`, actualizadoEn: FieldValue.serverTimestamp() })
        resumen.existian++
        continue
      }
      let uid: string
      try {
        uid = (await auth.createUser({ email: emailAuth, password: cuit, displayName: docCuentaDesdeTango(candidato, null).razonSocial as string })).uid
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/email-already-exists') throw e
        // El mismo dominio lo usan los choferes (<cuit>@rolito.app): si el uid
        // existente no es un cliente, no se pisa.
        uid = (await auth.getUserByEmail(emailAuth)).uid
        const existente = (await db.doc(`users/${uid}`).get()).data()
        if (existente && existente.rol !== 'cliente') {
          await d.ref.update({ estado: 'error', motivo: `el email ${emailAuth} ya es de un usuario con rol ${existente.rol}`, actualizadoEn: FieldValue.serverTimestamp() })
          resumen.errores++
          resumen.detalleErrores.push({ cuit, motivo: `colisión con usuario ${existente.rol}` })
          continue
        }
        if (existente) {
          await d.ref.update({ estado: 'existia', uid, motivo: 'ya tenía ficha en users', actualizadoEn: FieldValue.serverTimestamp() })
          resumen.existian++
          continue
        }
      }
      const batch = db.batch()
      batch.set(db.doc(`users/${uid}`), docCuentaDesdeTango(candidato, FieldValue.serverTimestamp()))
      batch.set(db.doc(`cuitIndex/${cuit}`), { email: emailAuth })
      batch.update(d.ref, { estado: 'creada', uid, actualizadoEn: FieldValue.serverTimestamp() })
      await batch.commit()
      resumen.creadas++
      await dormir(DELAY_MS)
    } catch (e) {
      resumen.errores++
      const motivo = (e as Error).message
      if (resumen.detalleErrores.length < 50) resumen.detalleErrores.push({ cuit, motivo })
      await d.ref.update({ estado: 'error', motivo, actualizadoEn: FieldValue.serverTimestamp() }).catch(() => undefined)
    }
  }

  const restantes = await db.collection('tango-altas').where('estado', '==', 'pendiente').count().get()
  resumen.pendientesRestantes = restantes.data().count
  return resumen
}

async function correrAltas(origen: string, uid?: string): Promise<ResumenAltas> {
  const db = getFirestore()
  const cfg = (await db.doc('config/tango').get()).data() ?? {}
  if (cfg.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.enabled está apagado')
  if (cfg.altas?.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.altas.enabled está apagado')
  const crear = cfg.altas?.crear === true
  const inicio = Date.now()
  const resumen = await procesarAltasTango(db, { crear })
  await db.doc('config/tango').set({
    altasSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] altas (${origen}, crear=${crear}) en ${Date.now() - inicio}ms: ${JSON.stringify({ ...resumen, detalleErrores: resumen.detalleErrores.length })}`)
  return resumen
}

export const altasClientesTango = onSchedule(
  { schedule: 'every 10 minutes', timeZone: TZ, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    try {
      const cfg = (await getFirestore().doc('config/tango').get()).data() ?? {}
      if (cfg.enabled !== true || cfg.altas?.enabled !== true || cfg.altas?.crear !== true) return
      await correrAltas('programada')
    } catch (e) { logger.error(`[tango] altas falló: ${(e as Error).message}`) }
  },
)

export const procesarAltasTangoAhora = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
    const rol = String((await getFirestore().collection('users').doc(request.auth.uid).get()).data()?.rol ?? '')
    if (!ROLES_ALTAS.has(rol)) throw new HttpsError('permission-denied', 'No tenés permiso para dar de alta clientes')
    await assertRateLimit(request.auth.uid, 'procesarAltasTango', 6, 300)
    return correrAltas('manual', request.auth.uid)
  },
)
