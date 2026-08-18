import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { assertRateLimit } from '../rateLimit'

interface IndiceUsuario {
  email?: string
  rol?:   string
  cuit?:  string
  dni?:   string
}

export const deleteAuthUsers = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')

  const db = getFirestore()
  const callerDoc  = await db.collection('users').doc(request.auth.uid).get()
  const callerData = callerDoc.data()
  if (!callerData || callerData.rol !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Solo super_admin puede ejecutar esta acción')
  }
  await assertRateLimit(request.auth.uid, 'deleteAuthUsers', 5, 60)

  const { uids, indices } = request.data as { uids: string[]; indices?: IndiceUsuario[] }
  if (!Array.isArray(uids) || uids.length === 0) return { deleted: 0 }

  const auth = getAuth()
  let deleted = 0
  for (let i = 0; i < uids.length; i += 1000) {
    const result = await auth.deleteUsers(uids.slice(i, i + 1000))
    deleted += result.successCount
  }

  // Limpiar los índices de login (cuitIndex/dniIndex/staffDniIndex) de las
  // cuentas borradas — antes quedaban huérfanos apuntando a un uid/email que
  // ya no existe, bloqueando el re-registro futuro con el mismo CUIT/DNI. Se
  // borra solo si el índice sigue apuntando al mismo email (por si ya fue
  // reasignado a una cuenta nueva en el instante entre leer y borrar).
  if (Array.isArray(indices) && indices.length > 0) {
    await Promise.all(indices.flatMap((idx) => {
      const ops: Promise<unknown>[] = []
      const cuitKey = idx.cuit?.replace(/\D/g, '')
      if (cuitKey && cuitKey.length === 11) {
        ops.push(deleteIfEmailMatches(db.collection('cuitIndex').doc(cuitKey), idx.email))
      }
      const dniKey = idx.dni?.replace(/\D/g, '')
      if (dniKey && dniKey.length === 8) {
        const col = idx.rol === 'chofer' ? 'dniIndex' : 'staffDniIndex'
        ops.push(deleteIfEmailMatches(db.collection(col).doc(dniKey), idx.email))
      }
      return ops
    }))
  }

  return { deleted }
})

async function deleteIfEmailMatches(
  ref: FirebaseFirestore.DocumentReference,
  email: string | undefined,
): Promise<void> {
  const snap = await ref.get()
  if (snap.exists && snap.data()?.email === email) await ref.delete()
}
