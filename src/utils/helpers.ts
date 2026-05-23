import { Timestamp } from 'firebase/firestore'
import { CatalogProducto, OrderProduct } from '../types'

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

export const calcPallets = (
  products: OrderProduct[],
  catalogo: CatalogProducto[],
): number =>
  products.reduce((total, p) => {
    const cat = catalogo.find((c) => c.id === p.productoId || c.nombre === p.name)
    if (!cat?.unidadesPorPallet) return total
    return total + p.quantity / cat.unidadesPorPallet
  }, 0)
