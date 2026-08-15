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

// Clientes de altísimo volumen (grupos empresarios con decenas de sucursales,
// la mayoría de la Bandeja en Planificación) — en las tarjetas de pedidos se
// abrevian con su logo en vez de repetir la razón social completa.
export const DELIVERY_HERO_CLIENT_ID = 'W5ipfqI6gEfRqFk5X13HdTi57l93' // DELIVERY HERO E-COMMERCE SA (PedidosYa)
export const RAPPI_CLIENT_ID         = '8uZtrty0zFMSAcRgR9hQu3Hr72H3' // GASTRONOMIA EMPRENDIMIENTOS S.A.S (Rappi)

// Datos fijos de la empresa para la etiqueta Zebra de las heladeras.
export const ROLITO_INFO = {
  razonSocial: 'Redonhielo S.A.',
  direccion:   'Ruta Panamericana Km. 25.700',
  localidad:   'Don Torcuato',
  cp:          '1611',
  telefono:    '(011) 4741-8000',
}

export const CLIENT_LOGOS: Record<string, { src: string; alt: string }> = {
  [DELIVERY_HERO_CLIENT_ID]: { src: '/logo-pedidosya.png', alt: 'PedidosYa (Delivery Hero)' },
  [RAPPI_CLIENT_ID]:         { src: '/logo-rappi.webp',    alt: 'Rappi (Gastronomía Emprendimientos)' },
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}
