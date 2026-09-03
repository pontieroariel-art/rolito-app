// Precios y listas: Tango → app. Corrida diaria a la madrugada (igual que
// clientes) + callable para el botón "Sincronizar ahora" de la pantalla de
// precios. Lógica en services/tango/precios.ts; docs/tango/INTEGRACION.md §17.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { TangoClient } from '../services/tango/client'
import { sincronizarPreciosTango } from '../services/tango/precios'
import type { ConfigTango } from '../services/tango/writers'
import { assertRateLimit } from '../rateLimit'

const tangoApiToken = defineSecret('TANGO_API_TOKEN')
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com'
const TZ = 'America/Argentina/Buenos_Aires'
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'facturacion'])

async function correr(origen: string, uid?: string) {
  const db = getFirestore()
  const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigTango
  if (cfg.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.enabled está apagado')
  const tango = new TangoClient({ baseUrl: (cfg.connectBaseUrl as string | undefined) ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60_000 })
  const inicio = Date.now()
  const resumen = await sincronizarPreciosTango(db, tango, cfg)
  await db.doc('config/tango').set({
    preciosSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] precios sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`)
  return resumen
}

export const syncPreciosTango = onSchedule(
  { schedule: '30 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    try { await correr('programada') } catch (e) { logger.error(`[tango] sync de precios falló: ${(e as Error).message}`) }
  },
)

export const sincronizarPreciosTangoAhora = onCall(
  { secrets: [tangoApiToken], timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
    const caller = (await getFirestore().collection('users').doc(request.auth.uid).get()).data()
    if (!caller || !ROLES_QUE_SINCRONIZAN.has(String(caller.rol))) throw new HttpsError('permission-denied', 'No tenés permiso para sincronizar precios')
    await assertRateLimit(request.auth.uid, 'sincronizarPreciosTango', 3, 300)
    return correr('manual', request.auth.uid)
  },
)
