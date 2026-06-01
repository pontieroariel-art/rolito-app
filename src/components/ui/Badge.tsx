import { OrderStatus } from '../../types'

const STATUS_STYLES_DARK: Record<OrderStatus, string> = {
  pendiente:  'bg-[#3D2800] text-[#FCD34D] border-[#5A3D00]',
  confirmado: 'bg-[#0C447C] text-[#B5D4F4] border-[#1A5A9E]',
  en_camino:  'bg-[#0F3D30] text-[#6EE7C3] border-[#1A5540]',
  entregado:  'bg-[#085041] text-[#9FE1CB] border-[#0F7060]',
  cancelado:  'bg-[#4A1010] text-[#FCA5A5] border-[#6B1515]',
}

const STATUS_STYLES_LIGHT: Record<OrderStatus, string> = {
  pendiente:  'bg-amber-100 text-amber-700 border-amber-200',
  confirmado: 'bg-blue-100 text-blue-700 border-blue-200',
  en_camino:  'bg-[#E8F5F0] text-[#0F6E56] border-[#B3DDD3]',
  entregado:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelado:  'bg-red-100 text-red-700 border-red-200',
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}

interface BadgeProps {
  status: OrderStatus
  variant?: 'dark' | 'light'
}

export default function Badge({ status, variant = 'dark' }: BadgeProps) {
  const styles = variant === 'dark' ? STATUS_STYLES_DARK : STATUS_STYLES_LIGHT
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap
        ${styles[status] ?? (variant === 'dark' ? 'bg-surface text-muted border-border' : 'bg-gray-100 text-gray-600 border-gray-200')}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
