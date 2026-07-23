import { Timestamp } from 'firebase/firestore'
import { CatalogProducto, OrderProduct } from '../types'

export function tsToDate(ts: Timestamp | { seconds: number } | null | undefined): Date {
  if (!ts) return new Date()
  if ('toDate' in ts && typeof (ts as Timestamp).toDate === 'function') return (ts as Timestamp).toDate()
  if ('seconds' in ts) return new Date((ts as { seconds: number }).seconds * 1000)
  return new Date()
}

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

// Los pedidos de clientes con varias sucursales (ej. cadenas importadas por
// PDF) guardan el nombre completo como "RAZÓN SOCIAL (SUCURSAL)" — en vistas
// compactas (Bandeja/calendario) alcanza con la sucursal + la primera
// palabra de la razón social, en vez de repetir el nombre completo entero
// en cada tarjeta (el nombre completo solo importa para Tango al facturar).
export function splitSucursalLabel(clientName: string): { empresa?: string; sucursal: string } {
  const match = clientName.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (!match) return { sucursal: clientName }
  const [, razonSocial, sucursal] = match
  const primeraPalabra = razonSocial.trim().split(/\s+/)[0] ?? ''
  const empresa = primeraPalabra.charAt(0).toUpperCase() + primeraPalabra.slice(1).toLowerCase()
  return { empresa, sucursal: sucursal.trim() }
}

export const todayString = (): string => new Date().toISOString().split('T')[0]

// addresses[].id es un id random (crypto.randomUUID()) cuando el domicilio
// se creó desde la UI, o el código real de sucursal (ej. "FC.562") cuando
// viene del import de Excel — solo el segundo caso sirve como "código".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLACEHOLDER_ADDR_ID_RE = /^addr-?\d+$/i
export function isSucursalCode(id: string | undefined): id is string {
  return !!id && !UUID_RE.test(id) && !PLACEHOLDER_ADDR_ID_RE.test(id)
}

// Resuelve el código de cliente exacto de la sucursal del pedido (grupos
// empresarios tienen un código distinto por dirección en addresses[].id);
// si no hay match por dirección, cae al código general del cliente.
export function getCodigoCliente(codigoByClientId: Map<string, string | undefined>, clientId: string, clientAddress?: string) {
  if (clientAddress) {
    const porDireccion = codigoByClientId.get(`${clientId}|${clientAddress.trim().toLowerCase()}`)
    if (porDireccion) return porDireccion
  }
  return codigoByClientId.get(clientId)
}

export const calcPallets = (
  products: OrderProduct[],
  catalogo: CatalogProducto[],
): number =>
  products.reduce((total, p) => {
    const cat = catalogo.find((c) => c.id === p.productoId || c.nombre === p.name)
    if (!cat?.unidadesPorPallet) return total
    return total + p.quantity / cat.unidadesPorPallet
  }, 0)
