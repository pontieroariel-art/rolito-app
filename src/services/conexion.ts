import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

/**
 * ¿La pantalla está recibiendo datos del servidor, o mostrando la caché?
 *
 * Nace para el TV del muelle (2026-09-19): cuando una suscripción se corta,
 * los servicios devuelven una lista vacía y el tablero queda igual que en un
 * rato tranquilo —todas las bocas LIBRE, nada pendiente—, así que una caída de
 * red y una planta parada se ven idénticas desde ocho metros.
 *
 * Se escucha un documento chico y estable con `includeMetadataChanges`:
 * `fromCache` dice si el SDK está sirviendo desde el caché local, que es
 * exactamente "esto que ves puede estar viejo". No agrega lecturas de peso: es
 * el mismo doc de configuración que la pantalla ya lee.
 */
export function subscribeEnVivo(callback: (enVivo: boolean) => void): () => void {
  return onSnapshot(
    doc(db, 'config', 'cot'),
    { includeMetadataChanges: true },
    (snap) => callback(!snap.metadata.fromCache),
    () => callback(false),
  )
}
