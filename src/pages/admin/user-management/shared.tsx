import { ReactNode } from 'react'
import { UserProfile, UserRole, UserStatus, DeliveryAddress } from '../../../types'

// Constantes, tipos y helpers de UI compartidos entre las piezas de la página
// de gestión de usuarios (extraído de UserManagement.tsx).

export interface SucursalFlat {
  user:    UserProfile
  address: DeliveryAddress | null
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       'Super Admin',
  gerente_general:   'Gte. General',
  gerente_comercial: 'Gte. Comercial',
  comercial:         'Comercial',
  logistica:         'Logística',
  facturacion:       'Facturación',
  chofer:            'Chofer',
  cliente:           'Cliente',
}

export const STATUS_STYLES: Record<UserStatus, string> = {
  activo:    'bg-green-100 text-green-700 border-green-200',
  inactivo:  'bg-red-100 text-red-700 border-red-200',
  pendiente: 'bg-yellow-100 text-amber-700 border-yellow-200',
}

export const STATUS_LABELS: Record<UserStatus, string> = {
  activo:    'Activo',
  inactivo:  'Inactivo',
  pendiente: 'Borrador',
}

export const ALL_ROLES: UserRole[]      = ['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion', 'chofer', 'cliente']
export const STAFF_ROLES: UserRole[]    = ['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion', 'chofer']
export const ALL_STATUSES: UserStatus[] = ['activo', 'inactivo', 'pendiente']

export function Row({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-600 text-right flex items-center gap-1">
        {icon}
        {value}
      </span>
    </div>
  )
}
