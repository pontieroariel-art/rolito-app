import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getAppCheck } from 'firebase-admin/app-check'
import { createHash, timingSafeEqual } from 'crypto'
import { assertRateLimit } from '../rateLimit'

// Token de App Check para el televisor del muelle (2026-09-22, al pasar App
// Check a enforcement). En la Samsung el reCAPTCHA no resuelve nunca, así que
// la tele no puede conseguir un token por el camino normal y con enforcement
// Firestore la dejaría afuera. La app en modo tele (ES_TELE) usa un
// CustomProvider de App Check que llama acá con la CLAVE de la tele (secret
// CLAVE_TELE, va en la URL de la tele una sola vez: ?claveTele=...) y el
// servidor le acuña un token de App Check con el Admin SDK, válido 24 h.
//
// Este callable NO exige App Check (si lo exigiera, la tele no podría pedir
// su primer token) ni sesión (la tele resuelve el login leyendo staffDniIndex,
// que ya es una lectura de Firestore). La defensa es la clave, comparada en
// tiempo constante, más un tope por IP.
export const claveTele = defineSecret('CLAVE_TELE')

const APP_ID_RE = /^1:\d{6,}:web:[a-f0-9]{8,}$/
const TTL_MS    = 24 * 60 * 60 * 1000

const hash = (s: string) => createHash('sha256').update(s).digest()

export const tokenAppCheckTele = onCall(
  { secrets: [claveTele], timeoutSeconds: 30 },
  async (request) => {
    const ip = String(request.rawRequest.ip ?? request.rawRequest.headers['x-forwarded-for'] ?? 'sin-ip').split(',')[0]!.trim()
    await assertRateLimit(ip.replace(/[^0-9a-zA-Z.:]/g, '_'), 'tokenTele', 20, 3600)

    const clave = String(request.data?.clave ?? '')
    const appId = String(request.data?.appId ?? '')
    const esperada = claveTele.value()
    if (!esperada || clave.length < 8 || !timingSafeEqual(hash(clave), hash(esperada))) {
      throw new HttpsError('permission-denied', 'Clave de la tele incorrecta')
    }
    if (!APP_ID_RE.test(appId)) throw new HttpsError('invalid-argument', 'appId inválido')

    const { token, ttlMillis } = await getAppCheck().createToken(appId, { ttlMillis: TTL_MS })
    return { token, expireTimeMillis: Date.now() + ttlMillis }
  },
)
