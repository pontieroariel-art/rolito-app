import { UserRole } from '../types'

// Tipos compartidos por los config de navegación agrupada de cada sistema
// (heladerasNav.ts, logisticaNav.ts) — consumidos por HeladerasLayout.tsx y
// LogisticaLayout.tsx.
export interface NavGroupItem {
  to:    string
  label: string
  icon:  React.ComponentType<{ size?: number; className?: string }>
  roles: UserRole[]
}

export interface NavGroup {
  id:    string
  label: string
  items: NavGroupItem[]
}
