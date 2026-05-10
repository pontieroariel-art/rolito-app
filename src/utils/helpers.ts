import { Timestamp } from 'firebase/firestore'
import { OrderProduct } from '../types'

export const formatDate = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp?.toDate) return '—'
  return timestamp.toDate().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export const formatShortDate = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp?.toDate) return '—'
  return timestamp.toDate().toLocaleDateString('es-AR')
}

export const formatDateInput = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp?.toDate) return ''
  return timestamp.toDate().toISOString().split('T')[0]
}

export const summarizeProducts = (products: OrderProduct[] = []): string =>
  products.map((p) => `${p.quantity}x ${p.name}`).join(', ')

export const todayString = (): string => new Date().toISOString().split('T')[0]
