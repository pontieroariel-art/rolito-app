import { Timestamp } from 'firebase/firestore'

export type UserRole = 'super_admin' | 'comercial' | 'logistica' | 'chofer' | 'cliente'
export type UserStatus = 'activo' | 'inactivo' | 'pendiente'

export type OrderStatus =
  | 'pendiente'
  | 'confirmado'
  | 'en_camino'
  | 'entregado'
  | 'cancelado'

export interface Product {
  id: string
  name: string
  unit: string
}

export interface OrderProduct {
  name:       string
  quantity:   number
  productoId?: string
  price?:     number
}

// ── Catálogo y listas de precios ──────────────────────────────────────────────

export interface CatalogProducto {
  id:     string
  nombre: string
  unidad: string
}

export interface ItemListaPrecios {
  productoId: string
  nombre:     string
  unidad:     string
  precio:     number
  activo:     boolean
}

export interface ListaPrecios {
  id:     string
  nombre: string
  items:  ItemListaPrecios[]
}

export interface DeliveryAddress {
  id: string
  nombre: string
  address: string
  lat: number | null
  lng: number | null
  horarioApertura: string
  horarioCierre: string
  contactoNombre: string
  contactoTelefono: string
  esPrincipal: boolean
}

export interface UserProfile {
  uid: string
  email: string
  nombre: string           // backward compat (used by existing chofer/admin code)
  razonSocial: string
  nombreContacto: string
  telefono: string         // WhatsApp
  phone: string            // backward compat
  cuit: string
  addresses: DeliveryAddress[]
  address: string          // backward compat (old single address field)
  lat: number | null       // backward compat
  lng: number | null       // backward compat
  rol: UserRole
  estado: UserStatus
  fechaCreacion: Timestamp | null
  fechaAprobacion: Timestamp | null
  aprobadoPor: string | null
  listaPreciosId?: string
  preciosCustom?: Record<string, number>
  // Asignación de vehículo
  camionId?:              string | null
  camionPatente?:         string | null
  camionModelo?:          string | null
  camionFechaAsignacion?: Timestamp | null
}

// ── Visitas programadas ───────────────────────────────────────────────────────

export const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

export interface ProgramaVisita {
  id:            string
  clientId:      string
  clientName:    string
  clientAddress: string
  clientPhone:   string
  diasSemana:    number[]         // 0=Dom … 6=Sáb (Date.getDay())
  driverId:      string | null
  activo:        boolean
  notas?:        string
  createdAt:     Timestamp
}

export interface VisitaPuntual {
  id:            string
  clientId:      string
  clientName:    string
  clientAddress: string
  clientPhone:   string
  fecha:         Timestamp
  driverId:      string | null
  status:        'pendiente' | 'visitado' | 'sin_contacto'
  notas?:        string
  orderId?:      string
  createdAt:     Timestamp
}

export interface Camion {
  id:        string
  patente:   string
  modelo:    string
  marca?:    string
  activo:    boolean
  createdAt: Timestamp
}

export function getPrimaryAddress(user: UserProfile): DeliveryAddress | null {
  if (!user.addresses || user.addresses.length === 0) return null
  return user.addresses.find((a) => a.esPrincipal) ?? user.addresses[0]
}

export interface Order {
  id: string
  clientId: string
  clientEmail: string
  clientName: string
  clientAddress: string
  clientPhone: string
  products: OrderProduct[]
  status: OrderStatus
  date: Timestamp
  driverId: string | null
  notes: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
