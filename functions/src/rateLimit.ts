import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

// Límite de frecuencia simple por uid+función, para que un token de staff/cliente
// comprometido (o scripteado) no pueda machacar un callable sin límite — la
// autenticación y el chequeo de rol ya cierran el acceso, esto es defensa en
// profundidad. Ventana fija (no sliding window): si `windowStart` tiene más de
// `windowSeconds`, se reinicia el contador en 1 en vez de acumular indefinido.
export async function assertRateLimit(
  uid:           string,
  key:           string,
  limit:         number,
  windowSeconds: number,
): Promise<void> {
  const ref = getFirestore().doc(`_rateLimits/${uid}_${key}`)

  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.data() as { count?: number; windowStart?: Timestamp } | undefined

    const now         = Date.now()
    const windowStart = data?.windowStart?.toMillis() ?? 0
    const withinWindow = now - windowStart < windowSeconds * 1000

    if (withinWindow && (data?.count ?? 0) >= limit) {
      throw new HttpsError('resource-exhausted', 'Demasiadas solicitudes, esperá un momento e intentá de nuevo')
    }

    if (withinWindow) {
      tx.set(ref, { count: FieldValue.increment(1) }, { merge: true })
    } else {
      tx.set(ref, { count: 1, windowStart: Timestamp.fromMillis(now) })
    }
  })
}
