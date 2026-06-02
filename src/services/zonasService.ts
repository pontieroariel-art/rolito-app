import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

export interface ZonaProhibida {
  id:      string
  nombre:  string
  activa:  boolean
  polygon: { lat: number; lng: number }[]
}

export function subscribeZonas(cb: (z: ZonaProhibida[]) => void) {
  return onSnapshot(doc(db, 'config', 'zonasProhibidas'), (snap) => {
    cb((snap.data()?.zonas ?? []) as ZonaProhibida[])
  })
}

export function saveZonas(zonas: ZonaProhibida[]): Promise<void> {
  return setDoc(doc(db, 'config', 'zonasProhibidas'), { zonas })
}
