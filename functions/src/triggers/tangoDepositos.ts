// Depósitos de Tango → app. Corrida diaria a la madrugada (después de precios)
// + callable para el botón "Sincronizar ahora" del panel de depósitos.
// Lógica en services/tango/depositos.ts; docs/tango/INTEGRACION.md §27.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { TangoClient } from '../services/tango/client'
import { sincronizarDepositosTango } from '../services/tango/depositos'
import type { ConfigTango } from '../services/tango/writers'
import { assertRateLimit } from '../rateLimit'

const tangoApiToken = defineSecret('TANGO_API_TOKEN')
const CONNECT_BASE_URL_DEFAULT = 'https://001174-003.connect.axoft.com'
const TZ = 'America/Argentina/Buenos_Aires'
const ROLES_QUE_SINCRONIZAN = new Set(['super_admin', 'gerente_general', 'gerente_comercial', 'logistica', 'caja'])

async function correr(origen: string, uid?: string) {
  const db = getFirestore()
  const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigTango
  if (cfg.enabled !== true) throw new HttpsError('failed-precondition', 'config/tango.enabled está apagado')
  const tango = new TangoClient({ baseUrl: (cfg.connectBaseUrl as string | undefined) ?? CONNECT_BASE_URL_DEFAULT, token: tangoApiToken.value(), timeoutMs: 60_000 })
  const inicio = Date.now()
  const resumen = await sincronizarDepositosTango(db, tango, cfg)
  await db.doc('config/tango').set({
    depositosSync: { ultimaCorrida: FieldValue.serverTimestamp(), origen, uid: uid ?? null, duracionMs: Date.now() - inicio, resumen },
  }, { merge: true })
  logger.info(`[tango] depósitos sincronizados (${origen}) en ${Date.now() - inicio}ms: ${JSON.stringify(resumen)}`)
  return resumen
}

export const syncDepositosTango = onSchedule(
  { schedule: '40 5 * * *', timeZone: TZ, secrets: [tangoApiToken], timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    try { await correr('programada') } catch (e) { logger.error(`[tango] sync de depósitos falló: ${(e as Error).message}`) }
  },
)

export const sincronizarDepositosTangoAhora = onCall(
  { secrets: [tangoApiToken], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
    const caller = (await getFirestore().collection('users').doc(request.auth.uid).get()).data()
    if (!caller || !ROLES_QUE_SINCRONIZAN.has(String(caller.rol))) throw new HttpsError('permission-denied', 'No tenés permiso para sincronizar depósitos')
    await assertRateLimit(request.auth.uid, 'sincronizarDepositosTango', 3, 300)
    return correr('manual', request.auth.uid)
  },
)
