import { collection, getDocs, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

const SUPERADMIN_EMAIL = 'pontieroariel@gmail.com'

// Deletes all documents in a collection, optionally skipping some by predicate.
// Works in batches of 499 (Firestore commit limit is 500 ops).
async function batchDeleteCollection(
  name: string,
  keep?: (data: Record<string, unknown>) => boolean,
): Promise<number> {
  const snap = await getDocs(collection(db, name))
  const toDelete = keep ? snap.docs.filter((d) => !keep(d.data() as Record<string, unknown>)) : snap.docs

  for (let i = 0; i < toDelete.length; i += 499) {
    const batch = writeBatch(db)
    toDelete.slice(i, i + 499).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  return toDelete.length
}

export interface CleanupResult {
  users:      number
  orders:     number
  ubicaciones: number
  clientes:   number
}

export async function cleanupTestData(): Promise<CleanupResult> {
  const [users, orders, ubicaciones] = await Promise.all([
    batchDeleteCollection('users', (d) => d['email'] === SUPERADMIN_EMAIL),
    batchDeleteCollection('orders'),
    batchDeleteCollection('ubicaciones'),
  ])

  let clientes = 0
  try {
    clientes = await batchDeleteCollection('clientes')
  } catch {
    // Collection doesn't exist — ignore
  }

  return { users, orders, ubicaciones, clientes }
}
