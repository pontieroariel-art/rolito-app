import { Timestamp } from 'firebase/firestore'

export type UserRole = 'admin' | 'chofer' | 'cliente'

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
  name: string
  phone: string
  role: UserRole
  address: string
  createdAt: Timestamp | null
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
