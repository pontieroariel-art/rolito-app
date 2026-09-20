import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { assertNoImpersonado } from '../authz'
import { assertRateLimit } from '../rateLimit'

/**
 * Restablecer la contraseña de un usuario del personal (2026-09-20).
 *
 * El mail del staff es INVENTADO (`36809554@staff.rolito.internal`), así que
 * el "olvidé mi contraseña" por mail no existe: si alguien se la olvida, la
 * única salida era correr un script con el Admin SDK contra producción. Esta
 * callable es la contracara de la pantalla "Mi perfil": el super_admin la
 * vuelve a poner en el DNI y la persona la cambia de nuevo desde ahí.
 *
 * Cambiar la contraseña de OTRO usuario requiere el Admin SDK (el SDK del
 * navegador solo puede cambiar la del usuario logueado), por eso es callable.
 *
 * Es tomar la cuenta de alguien, así que: solo super_admin activo, nunca sobre
 * otro super_admin (eso sería apropiarse de un par), nunca sobre un cliente
 * (tiene mail de verdad y su propio "olvidé mi contraseña") ni sobre un
 * operario de producción (tiene `resetPinProduccion`), con rate limit y
 * registro en `historialAdmin` con riesgo alto → mail instantáneo.
 */

// Molde de scripts/crear-muelleros.mjs: la contraseña de estreno es el propio
// DNI. Es débil a propósito —el DNI es también el usuario— y por eso "Mi
// perfil" empuja a cambiarla y no deja volver a poner el DNI.
const FALLBACK = 'rolito'
function passwordInicial(dni: string | undefined): string {
  const limpio = (dni ?? '').replace(/\D/g, '')
  // Firebase Auth exige 6 caracteres: un DNI de 7 dígitos (los viejos) o un
  // usuario sin DNI cargado no pueden quedar sin contraseña.
  return limpio.length >= 6 ? limpio : `${FALLBACK}${limpio}`
}

export const resetearPasswordStaff = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')
  assertNoImpersonado(request)

  const db = getFirestore()
  const adminUid = request.auth.uid
  const admin = (await db.collection('users').doc(adminUid).get()).data()
  if (!admin || admin.rol !== 'super_admin' || admin.estado !== 'activo') {
    throw new HttpsError('permission-denied', 'Solo el super_admin restablece contraseñas')
  }
  await assertRateLimit(adminUid, 'resetearPasswordStaff', 30, 3600)

  const { uid } = (request.data ?? {}) as { uid?: unknown }
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    throw new HttpsError('invalid-argument', 'Falta el usuario')
  }

  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) throw new HttpsError('not-found', 'No existe ese usuario')
  const perfil = snap.data() ?? {}
  const rol = String(perfil.rol ?? '')

  if (rol === 'super_admin') {
    throw new HttpsError('permission-denied', 'No se restablece la contraseña de otro super_admin')
  }
  if (rol === 'cliente') {
    throw new HttpsError('failed-precondition', 'Los clientes recuperan su contraseña por mail')
  }
  if (rol === 'produccion_hielo') {
    throw new HttpsError('failed-precondition', 'Los operarios de producción se resetean desde Producción')
  }
  // El chofer y el técnico entran con PIN de 4 dígitos, no con contraseña: si
  // se resetea con esta cuenta quedan con una clave que su pantalla de login
  // no sabe armar.
  if (rol === 'chofer' || rol === 'tecnico') {
    throw new HttpsError('failed-precondition', 'Ese usuario entra con PIN, no con contraseña')
  }

  const dni = typeof perfil.dni === 'string' ? perfil.dni : undefined
  const password = passwordInicial(dni)

  try {
    await getAuth().updateUser(uid, { password })
  } catch (err) {
    console.error('[resetearPasswordStaff] error actualizando la contraseña:', err)
    throw new HttpsError('internal', 'No se pudo restablecer la contraseña. Intentá de nuevo.')
  }

  const nombre = String(perfil.nombre ?? perfil.email ?? uid)
  await db.collection('historialAdmin').add({
    coleccion: 'users',
    docId:     uid,
    accion:    'reset-password',
    detalle:   `${nombre} (${rol})`,
    riesgo:    'alto',
    actor:     { uid: adminUid, nombre: String(admin.nombre ?? admin.email ?? adminUid), rol: 'super_admin' },
    fecha:     FieldValue.serverTimestamp(),
  })

  return { password, nombre }
})
