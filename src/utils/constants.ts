import { Product, OrderStatus } from '../types'

export const PRODUCTS: Product[] = [
  { id: 'bolsa_2kg',     name: 'Hielo bolsa 2kg',         unit: 'bolsa'  },
  { id: 'bolsa_3kg',     name: 'Hielo bolsa 3kg',         unit: 'bolsa'  },
  { id: 'bolsa_10kg',    name: 'Hielo bolsa 10kg',        unit: 'bolsa'  },
  { id: 'picado_10kg',   name: 'Hielo picado bolsa 10kg', unit: 'bolsa'  },
  { id: 'escamas_10kg',  name: 'Hielo en escamas 10kg',   unit: 'bolsa'  },
  { id: 'barra',         name: 'Barra de hielo',           unit: 'barra'  },
  { id: 'anticorrosivo', name: 'Anticorrosivo',            unit: 'unidad' },
  { id: 'agua_6l',       name: 'Agua de mesa x 6 litros', unit: 'bidón'  },
]

export const STATUS_FLOW: OrderStatus[] = [
  'pendiente',
  'confirmado',
  'en_camino',
  'entregado',
]

export const ALL_STATUSES: OrderStatus[] = [...STATUS_FLOW, 'cancelado']

// Cliente de altísimo volumen (66+ sucursales, la mayoría de la Bandeja en
// Planificación) — razón social "DELIVERY HERO E-COMMERCE SA" (PedidosYa).
// Ahí se abrevia con el logo de PedidosYa en vez de repetir la razón social
// completa en cada tarjeta.
export const DELIVERY_HERO_CLIENT_ID = 'W5ipfqI6gEfRqFk5X13HdTi57l93'

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}
