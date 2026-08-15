import { Timestamp } from 'firebase/firestore'
import { CatalogProducto, OrderProduct, UserProfile } from '../types'

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

// Kg por unidad a partir del nombre del producto (ej. "Hielo bolsa 10kg" → 10).
// Los productos que no son hielo (agua, anticorrosivo, bidones) no tienen
// "kg" en el nombre y quedan afuera del total automáticamente.
export function kgPorUnidad(nombre: string): number {
  const match = nombre.match(/(\d+)\s*kg/i)
  return match ? Number(match[1]) : 0
}

export function kgHielo(products: OrderProduct[]): number {
  return products.reduce((s, p) => s + kgPorUnidad(p.name) * (p.quantity ?? 0), 0)
}

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

// Fecha local en formato YYYY-MM-DD. A diferencia de `d.toISOString().split('T')[0]`,
// no pasa por UTC — evita que entre las 21:00 y las 23:59 (Argentina, UTC-3) la fecha
// calculada salte al día siguiente.
export const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayString = (): string => toDateStr(new Date())

export const addDaysStr = (dateStr: string, days: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  date.setDate(date.getDate() + days)
  return toDateStr(date)
}

// addresses[].id es un id random (crypto.randomUUID()) cuando el domicilio
// se creó desde la UI, o el código real de sucursal (ej. "FC.562") cuando
// viene del import de Excel — solo el segundo caso sirve como "código".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLACEHOLDER_ADDR_ID_RE = /^addr-?\d+$/i
export function isSucursalCode(id: string | undefined): id is string {
  return !!id && !UUID_RE.test(id) && !PLACEHOLDER_ADDR_ID_RE.test(id)
}

// Normaliza una dirección para comparar (detectar duplicados, matchear contra
// addresses[]): ignora mayúsculas, tildes y espacios repetidos, para que
// "Av. Córdoba  123" y "av cordoba 123" cuenten como la misma dirección.
export function normalizeAddress(address: string): string {
  return address
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Arma el mapa uid[|dirección] → código de sucursal, usado por getCodigoCliente.
// Extraído para no duplicar esta lógica entre las vistas de Pedidos y Despacho.
export function buildCodigoByClientId(allClients: UserProfile[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>()
  for (const c of allClients) {
    map.set(c.uid, c.codigoCliente)
    for (const a of c.addresses ?? []) {
      if (a.address && isSucursalCode(a.id)) map.set(`${c.uid}|${normalizeAddress(a.address)}`, a.id)
    }
  }
  return map
}

// Resuelve el código de cliente exacto de la sucursal del pedido (grupos
// empresarios tienen un código distinto por dirección en addresses[].id);
// si no hay match por dirección, cae al código general del cliente.
export function getCodigoCliente(codigoByClientId: Map<string, string | undefined>, clientId: string, clientAddress?: string) {
  if (clientAddress) {
    const porDireccion = codigoByClientId.get(`${clientId}|${normalizeAddress(clientAddress)}`)
    if (porDireccion) return porDireccion
  }
  return codigoByClientId.get(clientId)
}

// Iniciales para un avatar circular (ej. "Gastón Pereyra" → "GP"). Usado por
// el tablero de Despacho y por el historial de despacho.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Precio especial de un cliente para un producto, respetando su vigencia. El
// modal de precios especiales (PreciosCustomModal) solo usaba `vigenciaHasta`
// para el texto informativo, pero nada revisaba esa fecha al calcular el
// precio a cobrar — un precio "válido hasta el 30/06" se seguía aplicando
// indefinidamente después de esa fecha. `preciosCustom` no se borra solo al
// vencer, así que hay que chequear la vigencia en cada lectura.
export function precioEfectivo(user: UserProfile, productoId: string, precioLista: number): number {
  const custom = user.preciosCustom?.[productoId]
  if (custom === undefined) return precioLista
  const vigenciaHasta = user.vigenciaCustom?.[productoId]
  if (vigenciaHasta && vigenciaHasta < todayString()) return precioLista
  return custom
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
