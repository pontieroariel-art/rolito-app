export const PRODUCTS = [
  { id: 'bolsa_2kg',     name: 'Hielo bolsa 2kg',          unit: 'bolsa'  },
  { id: 'bolsa_3kg',     name: 'Hielo bolsa 3kg',          unit: 'bolsa'  },
  { id: 'bolsa_10kg',    name: 'Hielo bolsa 10kg',         unit: 'bolsa'  },
  { id: 'picado_10kg',   name: 'Hielo picado bolsa 10kg',  unit: 'bolsa'  },
  { id: 'escamas_10kg',  name: 'Hielo en escamas 10kg',    unit: 'bolsa'  },
  { id: 'barra',         name: 'Barra de hielo',            unit: 'barra'  },
  { id: 'anticorrosivo', name: 'Anticorrosivo',             unit: 'unidad' },
  { id: 'agua_6l',       name: 'Agua de mesa x 6 litros',  unit: 'bidón'  },
]

// Flujo normal de estados
export const STATUS_FLOW = ['pendiente', 'confirmado', 'en_camino', 'entregado']

// Todos los estados posibles (incluye cancelado)
export const ALL_STATUSES = [...STATUS_FLOW, 'cancelado']

export const STATUS_LABELS = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}
