import { collection, getDocs, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from './firebase'

// Deletes all docs in a collection, optionally keeping docs by predicate.
// Works in batches of 499 (Firestore commit limit is 500 ops).
async function batchDeleteCollection(
  name: string,
  keepId?: (id: string) => boolean,
): Promise<number> {
  const snap     = await getDocs(collection(db, name))
  const toDelete = keepId ? snap.docs.filter((d) => !keepId(d.id)) : snap.docs

  for (let i = 0; i < toDelete.length; i += 499) {
    const batch = writeBatch(db)
    toDelete.slice(i, i + 499).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  return toDelete.length
}

export interface CleanupResult {
  users:       number
  orders:      number
  ubicaciones: number
  clientes:    number
}

// myUid: the UID of the currently-logged-in admin — their doc is never deleted.
export async function cleanupTestData(myUid: string): Promise<CleanupResult> {
  // Recolectar UIDs (y los datos de índice de login: cuit/dni/rol/email) antes
  // de borrar los documentos — la Cloud Function los necesita para limpiar
  // cuitIndex/dniIndex/staffDniIndex de las cuentas borradas; si no, quedan
  // huérfanos apuntando a un uid que ya no existe.
  const usersSnap = await getDocs(collection(db, 'users'))
  const docsToDelete = usersSnap.docs.filter((d) => d.id !== myUid)
  const uidsToDelete = docsToDelete.map((d) => d.id)
  const indices = docsToDelete.map((d) => {
    const data = d.data()
    return {
      email: data.email as string | undefined,
      rol:   data.rol as string | undefined,
      cuit:  data.cuit as string | undefined,
      dni:   data.dni as string | undefined,
    }
  })

  const [users, orders, ubicaciones] = await Promise.all([
    batchDeleteCollection('users',     (id) => id === myUid),
    batchDeleteCollection('orders'),
    batchDeleteCollection('ubicaciones'),
  ])

  let clientes = 0
  try { clientes = await batchDeleteCollection('clientes') } catch { /* no existe */ }

  // Borrar cuentas de Firebase Auth (+ índices de login huérfanos) via Cloud Function
  if (uidsToDelete.length > 0) {
    try {
      const fn = httpsCallable(getFunctions(), 'deleteAuthUsers')
      await fn({ uids: uidsToDelete, indices })
    } catch (err) {
      console.warn('No se pudieron borrar cuentas de Auth:', err)
    }
  }

  return { users, orders, ubicaciones, clientes }
}
