import { collection, doc, onSnapshot, query, setDoc, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { Cobranza, PlantaId } from '../types'

const COBRANZAS = 'cobranzas'

// Cobranza en el mostrador (origen 'caja'): un cliente de cta. cte. viene a
// pagar una deuda. Espera al servidor — caja imprime el recibo contra un doc
// ya persistido. El origen 'cobrador' (calle) llega en la Fase 5 con su
// propia pantalla; misma colección.
export async function crearCobranzaCaja(
  args: {
    clienteId:     string
    clienteNombre: string
    importe:       number
    formaPago:     Cobranza['formaPago']
    referencia?:   string
  },
  actor: { uid: string; nombre: string; plantaId: PlantaId },
): Promise<Cobranza> {
  const ref = doc(collection(db, COBRANZAS))
  const cobranza: Omit<Cobranza, 'id'> = {
    origen:        'caja',
    plantaId:      actor.plantaId,
    registradoPor: { uid: actor.uid, nombre: actor.nombre },
    clienteId:     args.clienteId,
    clienteNombre: args.clienteNombre,
    importe:       args.importe,
    formaPago:     args.formaPago,
    fecha:         Timestamp.now(),
    ...(args.referencia?.trim() ? { referencia: args.referencia.trim() } : {}),
  }
  await setDoc(ref, cobranza)
  return { id: ref.id, ...cobranza }
}

// Cobranza en la calle (origen 'cobrador'): los cobradores son choferes en la
// app — mismo patrón offline-first que la venta del camión (setDoc
// fire-and-forget, persistentLocalCache encola sin señal). Sin plantaId: la
// cobranza es de la persona, no de una planta.
export function crearCobranzaCalle(
  args: {
    clienteId:     string
    clienteNombre: string
    importe:       number
    formaPago:     Cobranza['formaPago']
    referencia?:   string
  },
  actor: { uid: string; nombre: string },
): Cobranza {
  const ref = doc(collection(db, COBRANZAS))
  const cobranza: Omit<Cobranza, 'id'> = {
    origen:        'cobrador',
    registradoPor: { uid: actor.uid, nombre: actor.nombre },
    clienteId:     args.clienteId,
    clienteNombre: args.clienteNombre,
    importe:       args.importe,
    formaPago:     args.formaPago,
    fecha:         Timestamp.now(),
    ...(args.referencia?.trim() ? { referencia: args.referencia.trim() } : {}),
  }
  setDoc(ref, cobranza)   // fire-and-forget, sincroniza al reconectar
  return { id: ref.id, ...cobranza }
}

// Cobranzas de una persona en un rango (liquidación del día y su propio
// resumen). Un chofer/cobrador solo registra en la calle, así que no hace
// falta filtrar por origen.
export const subscribeCobranzasChoferEnRango = (
  choferId: string,
  desde: Date, hasta: Date,
  callback: (cobranzas: Cobranza[]) => void,
): () => void =>
  onSnapshot(
    query(
      collection(db, COBRANZAS),
      where('registradoPor.uid', '==', choferId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cobranza))),
    () => callback([]),
  )

// Cobranzas de mostrador del día de una planta (pantalla de caja).
export const subscribeCobranzasCajaDelDia = (
  plantaId: PlantaId,
  dia: Date,
  callback: (cobranzas: Cobranza[]) => void,
): () => void => {
  const desde = new Date(dia); desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  return onSnapshot(
    query(
      collection(db, COBRANZAS),
      where('plantaId', '==', plantaId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
    ),
    (snap) => callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Cobranza))
        .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    ),
    () => callback([]),
  )
}
