import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'

export interface ZonaProhibida {
  id:      string
  nombre:  string
  activa:  boolean
  polygon: { lat: number; lng: number }[]
}

export function subscribeZonas(cb: (z: ZonaProhibida[]) => void) {
  return onSnapshot(
    doc(db, 'config', 'zonasProhibidas'),
    (snap) => cb((snap.data()?.zonas ?? []) as ZonaProhibida[]),
    onSnapshotError(cb, 'config/zonasProhibidas'),
  )
}

export function saveZonas(zonas: ZonaProhibida[]): Promise<void> {
  return setDoc(doc(db, 'config', 'zonasProhibidas'), { zonas })
}
