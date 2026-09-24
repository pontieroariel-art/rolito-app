import { collection, getDocs, limit, orderBy, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { MailSaliente } from '../types'

// Mails que mandó la app (`mailsSalientes`, 2026-09-24): los escribe SOLO el
// server al mandar y el webhook de Resend los completa con `entrega`. Consulta
// puntual por rango (no un stream): es una pantalla de consulta de facturación.

const TOPE = 2000

export async function getMailsSalientes(desde: Date, hasta: Date): Promise<MailSaliente[]> {
  const q = query(
    collection(db, 'mailsSalientes'),
    where('fecha', '>=', Timestamp.fromDate(desde)),
    where('fecha', '<', Timestamp.fromDate(hasta)),
    orderBy('fecha', 'desc'),
    limit(TOPE),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MailSaliente, 'id'>) }))
}
