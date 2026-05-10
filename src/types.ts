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
  name: string
  quantity: number
}

export interface UserProfile {
  uid: string
  email: string
  nombre: string
  phone: string
  rol: UserRole
  estado: UserStatus
  address: string
  fechaCreacion: Timestamp | null
  fechaAprobacion: Timestamp | null
  aprobadoPor: string | null
}

export interface Order {
  id: string
  clientId: string
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
