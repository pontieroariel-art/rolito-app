import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

const LOCATIONS = 'ubicaciones'

export const updateDriverLocation = (
  driverEmail: string,
  lat: number,
  lng: number,
): Promise<void> =>
  setDoc(doc(db, LOCATIONS, driverEmail), {
    choferId: driverEmail,
    lat,
    lng,
    timestamp: serverTimestamp(),
  })

export const subscribeDriverLocation = (
  driverEmail: string,
  callback: (loc: { lat: number; lng: number } | null) => void,
): () => void =>
  onSnapshot(
    doc(db, LOCATIONS, driverEmail),
    (snap) =>
      callback(snap.exists() ? { lat: snap.data().lat, lng: snap.data().lng } : null),
    () => callback(null),
  )
