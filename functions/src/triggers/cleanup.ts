import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export const deleteAuthUsers = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado')

  const callerDoc  = await getFirestore().collection('users').doc(request.auth.uid).get()
  const callerData = callerDoc.data()
  if (!callerData || callerData.rol !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Solo super_admin puede ejecutar esta acción')
  }

  const { uids } = request.data as { uids: string[] }
  if (!Array.isArray(uids) || uids.length === 0) return { deleted: 0 }

  const auth = getAuth()
  let deleted = 0
  for (let i = 0; i < uids.length; i += 1000) {
    const result = await auth.deleteUsers(uids.slice(i, i + 1000))
    deleted += result.successCount
  }
  return { deleted }
})
