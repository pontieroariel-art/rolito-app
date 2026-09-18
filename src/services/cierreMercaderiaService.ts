// Lectura del cierre de MERCADERÍA de un viaje (2026-09-18).
//
// Solo lectura, a propósito: el doc lo escribe el servidor cuando muelle cuenta
// la descarga. La tablet del muelle no puede escribirlo NI leerlo, porque el
// conteo es ciego — mostrarle al operario lo que "tendría que" volver destruye el
// único control que tenemos sobre la mercadería.
//
// Quien sí lo lee es caja, al liquidar: ahí ve el cuadre por producto, los
// envases y el faltante, igual que cuando todo eso vivía adentro de la
// liquidación.

import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError } from './observability'
import { CierreMercaderia, PlantaId } from '../types'

const CIERRES = 'cierresMercaderia'

export const getCierreMercaderia = async (remitoId: string): Promise<CierreMercaderia | null> => {
  const snap = await getDoc(doc(db, CIERRES, remitoId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as CierreMercaderia) : null
}

/**
 * El cierre de un viaje, en vivo. La pantalla de liquidación lo escucha para que
 * el bloque de mercadería se complete solo cuando muelle termina de contar, sin
 * que el cajero tenga que recargar.
 */
export const subscribeCierreMercaderia = (
  remitoId: string,
  callback: (cierre: CierreMercaderia | null) => void,
): () => void =>
  onSnapshot(
    doc(db, CIERRES, remitoId),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as CierreMercaderia) : null),
    onSnapshotError(() => callback(null), CIERRES),
  )

/** Los cierres de varios viajes de una vez (liquidaciones abiertas, buzón, historial). */
export const getCierresDeViajes = async (remitoIds: string[]): Promise<Map<string, CierreMercaderia>> => {
  const out = new Map<string, CierreMercaderia>()
  // `in` admite 30 por consulta; los ids son pocos por pantalla.
  for (let i = 0; i < remitoIds.length; i += 30) {
    const lote = remitoIds.slice(i, i + 30)
    if (!lote.length) continue
    const snap = await getDocs(query(collection(db, CIERRES), where('remitoId', 'in', lote)))
    snap.docs.forEach((d) => out.set(d.id, { id: d.id, ...d.data() } as CierreMercaderia))
  }
  return out
}

/** Los cierres de un día de reparto en una planta, para los tableros en vivo. */
export const subscribeCierresDeReparto = (
  plantaId: PlantaId,
  diaReparto: string,
  callback: (cierres: CierreMercaderia[]) => void,
): () => void =>
  onSnapshot(
    query(collection(db, CIERRES), where('plantaId', '==', plantaId), where('diaReparto', '==', diaReparto)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CierreMercaderia))),
    onSnapshotError(callback, CIERRES),
  )
