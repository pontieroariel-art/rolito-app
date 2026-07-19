import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

const LOCATIONS = 'ubicaciones'

export interface DriverLocation {
  lat:            number
  lng:            number
  nombreChofer?:   string
  telefonoChofer?: string
  timestamp?:     number   // ms since epoch
}

export interface ActiveDriver extends DriverLocation {
  email: string
}

export const updateDriverLocation = (
  driverEmail:    string,
  lat:            number,
  lng:            number,
  nombreChofer:   string,
  telefonoChofer: string,
): Promise<void> =>
  setDoc(doc(db, LOCATIONS, driverEmail), {
    choferId:      driverEmail,
    lat,
    lng,
    nombreChofer,
    telefonoChofer,
    activo:    true,
    timestamp: serverTimestamp(),
  })

// Marca al chofer como inactivo (logout o sin entregas en camino)
export const deactivateDriverLocation = (driverEmail: string): Promise<void> =>
  updateDoc(doc(db, LOCATIONS, driverEmail), { activo: false }).catch(() => {
    // El documento puede no existir si el chofer nunca compartió su ubicación
  })

// Suscripción en tiempo real a todos los choferes con activo: true
export const subscribeAllActiveDrivers = (
  callback: (drivers: ActiveDriver[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, LOCATIONS), where('activo', '==', true)),
    (snap) =>
      callback(
        snap.docs.map((d) => ({
          email:          d.id,
          lat:            d.data().lat,
          lng:            d.data().lng,
          nombreChofer:   d.data().nombreChofer   ?? '',
          telefonoChofer: d.data().telefonoChofer ?? '',
          timestamp:      d.data().timestamp?.toMillis?.() ?? Date.now(),
        })),
      ),
    () => callback([]),
  )
