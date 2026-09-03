import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import { onSnapshotError, reportError } from './observability'
import { EmpresaTango, SaldoTango, TangoConsulta } from '../types'

// Cache de composición de saldos de Tango (colección saldosTango/{uid}, uid del
// cliente). Solo lectura desde la app: lo escribe el Admin SDK (sync periódico
// del bridge o respuesta de la cola tango-consultas).

export function subscribeSaldoCliente(
  uid: string,
  cb: (saldo: SaldoTango | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'saldosTango', uid),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as SaldoTango) : null),
    // Un error acá se vería como "sin deuda": se reporta y se entrega null.
    (err) => { reportError(err, { subscription: 'saldosTango', uid }); cb(null) },
  )
}

export function subscribeClientesConDeuda(
  cb: (saldos: SaldoTango[]) => void,
): () => void {
  const q = query(
    collection(db, 'saldosTango'),
    where('saldoTotal', '>', 0),
    orderBy('saldoTotal', 'desc'),
  )
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SaldoTango)),
    onSnapshotError(cb, 'saldosTango'),
  )
}

// Pide al bridge un refresh on-demand del saldo de un cliente (cola inversa
// tango-consultas). Devuelve el id del doc de consulta para seguirle el estado.
export async function crearConsultaSaldo(
  args: { clienteUid: string; idGva14: number; empresa?: EmpresaTango },
  actor: { uid: string; nombre: string },
): Promise<string> {
  const ref = await addDoc(collection(db, 'tango-consultas'), {
    tipo:          'saldoCliente',
    clienteUid:    args.clienteUid,
    idGva14:       args.idGva14,
    empresa:       args.empresa ?? 'redonhielo',
    solicitadoPor: actor,
    estado:        'pendiente',
    creadoEn:      serverTimestamp(),
  })
  return ref.id
}

export function subscribeConsulta(
  id: string,
  cb: (consulta: TangoConsulta | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'tango-consultas', id),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as TangoConsulta) : null),
    (err) => { reportError(err, { subscription: 'tango-consultas', id }); cb(null) },
  )
}
