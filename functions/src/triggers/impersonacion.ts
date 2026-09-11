import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { assertRateLimit } from '../rateLimit'
import { esImpersonado } from '../authz'

// "Ver como usuario" (2026-09-10): el super_admin abre la app con la sesión
// real de otra persona, en otra pestaña y en solo lectura, para ver exactamente
// lo que ve un chofer, un cajero, un supervisor o un cliente sin desloguearse.
//
// Emite un custom token de Firebase Auth para el uid observado con el claim
// `impersonadoPor` (uid del admin). Con ese claim:
//   - las reglas de Firestore rechazan create/update/delete (esEscrituraImpersonada),
//   - las callables rechazan la llamada (assertNoImpersonado),
//   - el front muestra el banner "Estás viendo como…" y frena GPS/push.
// Cada emisión queda en historialAdmin con riesgo 'alto' → mail instantáneo
// (onHistorialAdminAltoRiesgo). Nunca se impersona a otro super_admin.

interface Payload { uid?: unknown }

export const crearTokenImpersonacion = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
  if (esImpersonado(request)) {
    throw new HttpsError('permission-denied', 'Una sesión "Ver como" no puede abrir otra')
  }

  const db = getFirestore()
  const adminUid = request.auth.uid
  const admin = (await db.collection('users').doc(adminUid).get()).data()
  if (!admin || admin.rol !== 'super_admin' || admin.estado !== 'activo') {
    throw new HttpsError('permission-denied', 'Solo super_admin puede ver la app como otro usuario')
  }
  await assertRateLimit(adminUid, 'impersonacion', 30, 3600)

  const uid = (request.data as Payload | undefined)?.uid
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    throw new HttpsError('invalid-argument', 'Falta el uid del usuario')
  }
  if (uid === adminUid) throw new HttpsError('invalid-argument', 'Ya sos vos')

  const perfil = (await db.collection('users').doc(uid).get()).data()
  if (!perfil) throw new HttpsError('not-found', 'El usuario no existe')
  if (perfil.rol === 'super_admin') {
    throw new HttpsError('permission-denied', 'No se puede ver la app como otro super_admin')
  }
  // createCustomToken crearía la cuenta si no existiera en Auth: verificarla antes.
  try {
    await getAuth().getUser(uid)
  } catch {
    throw new HttpsError('not-found', 'El usuario no tiene cuenta de acceso (Auth)')
  }

  const adminNombre = String(admin.nombre ?? admin.razonSocial ?? '')
  const token = await getAuth().createCustomToken(uid, {
    impersonadoPor:       adminUid,
    impersonadoPorNombre: adminNombre,
  })

  const nombre = String(perfil.nombre ?? perfil.razonSocial ?? perfil.email ?? uid)
  const rol    = String(perfil.rol ?? '')
  await db.collection('historialAdmin').add({
    coleccion: 'users',
    docId:     uid,
    accion:    'impersonacion',
    detalle:   `${nombre} (${rol})`,
    riesgo:    'alto',
    actor:     { uid: adminUid, nombre: adminNombre, rol: 'super_admin' },
    fecha:     FieldValue.serverTimestamp(),
  })

  return { token, nombre, rol }
})
