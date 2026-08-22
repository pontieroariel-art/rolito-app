import { Product, OrderStatus, PlantaId } from '../types'
import { splitSucursalLabel } from './helpers'

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

// Opciones fijas para UserProfile.condicionVenta — ver Ficha del cliente.
export const CONDICIONES_VENTA = ['Contado', 'Cuenta corriente'] as const

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

// Datos por planta para el ticket de producción de hielo — no confundir con
// ROLITO_INFO (esa es la razón social genérica de la etiqueta de heladeras,
// siempre Don Torcuato). `prefijoCodigo` arma el correlativo (DT-000123).
export const PLANTA_INFO: Record<PlantaId, {
  razonSocial:   string
  direccion:     string
  localidad:     string
  telefono:      string
  prefijoCodigo: string
}> = {
  torcuato: {
    razonSocial:   'Redonhielo S.A.',
    direccion:     'Ruta Panamericana Km. 25.700',
    localidad:     'Don Torcuato',
    telefono:      '(011) 4741-8000',
    prefijoCodigo: 'DT',
  },
  merlo: {
    razonSocial:   'Redonhielo S.A.',
    direccion:     'Av. Pres. Juan Domingo Perón 26875, B1722 Merlo, Provincia de Buenos Aires',
    localidad:     'Merlo',
    telefono:      '(011) 4741-8000',
    prefijoCodigo: 'ML',
  },
}

export const CLIENT_LOGOS: Record<string, { src: string; alt: string }> = {
  [DELIVERY_HERO_CLIENT_ID]: { src: '/logo-pedidosya.png', alt: 'PedidosYa (Delivery Hero)' },
  [RAPPI_CLIENT_ID]:         { src: '/logo-rappi.webp',    alt: 'Rappi (Gastronomía Emprendimientos)' },
}

interface ClientBrandOverride {
  label: string                        // texto abreviado que reemplaza la razón social completa
  logo:  { src: string; alt: string }
}

// Uppercase + solo alfanuméricos: tolera que la razón social real difiera un
// poco en puntuación/espacios/guión final del texto con el que se cargó acá
// (ej. "COTO C.I.C.S.A." vs "COTO C.I.C.S.A. -") sin perder precisión.
function normalizeRazonSocial(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

// Mismo objetivo que CLIENT_LOGOS (abreviar clientes de alto volumen con su
// logo en las tarjetas de pedidos), pero para clientes que llegan por
// PDF/importación sin un clientId de cuenta propia estable — se identifican
// por razón social en vez de por id.
const CLIENT_NAME_OVERRIDES: Record<string, ClientBrandOverride> = {
  [normalizeRazonSocial('COTO C.I.C.S.A.')]:
    { label: 'COTO', logo: { src: '/logo-coto.svg', alt: 'Coto' } },
  [normalizeRazonSocial('OPERADORA DE ESTACIONES DE SERVICIOS S.A.')]:
    { label: 'YPF', logo: { src: '/logo-ypf.svg', alt: 'YPF' } },
  // La razón social es Pan American Energy, pero de cara al público (y a
  // quien arma el reparto) la marca reconocible es Axion — sus estaciones.
  [normalizeRazonSocial('PAN AMERICAN ENERGY S.L. SUCURSAL ARGENTINA')]:
    { label: 'PAN AMERICAN', logo: { src: '/logo-axion.png', alt: 'Axion Energy (Pan American Energy)' } },
  [normalizeRazonSocial('SUPERMERCADOS TOLEDO S.A')]:
    { label: 'TOLEDO', logo: { src: '/logo-toledo.png', alt: 'Toledo' } },
  [normalizeRazonSocial('L Y L EMPRENDALS S.A')]:
    { label: 'DON ANGEL', logo: { src: '/logo-donangel.png', alt: 'Don Angel' } },
}

export interface ClientDisplay {
  logo?:     { src: string; alt: string }
  empresa?:  string   // prefijo "Empresa · " para nombres sin logo (heurística genérica de splitSucursalLabel)
  sucursal:  string   // texto principal a mostrar en la tarjeta
}

// Resuelve qué mostrar en vez del nombre completo del cliente en las
// tarjetas de pedidos: el logo/abreviatura fijo de CLIENT_LOGOS o
// CLIENT_NAME_OVERRIDES si es un cliente de alto volumen conocido: si el
// nombre trae sucursal entre paréntesis ("RAZÓN (SUCURSAL)") se muestra esa
// sucursal (mismo criterio que PedidosYa/Rappi); si no, la abreviatura fija
// (ej. "COTO").
export function resolveClientDisplay(clientId: string, clientName: string): ClientDisplay {
  const { empresa, sucursal } = splitSucursalLabel(clientName)
  const hadSucursal  = sucursal !== clientName
  const parensMatch  = clientName.match(/^(.+?)\s*\([^)]+\)\s*$/)
  const razonSocial  = parensMatch ? parensMatch[1] : clientName
  const override     = CLIENT_NAME_OVERRIDES[normalizeRazonSocial(razonSocial)]
  const logo          = CLIENT_LOGOS[clientId] ?? override?.logo
  return {
    logo,
    empresa:  logo ? undefined : empresa,
    sucursal: hadSucursal ? sucursal : (override?.label ?? sucursal),
  }
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente:  'Pendiente',
  confirmado: 'Confirmado',
  en_camino:  'En camino',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}
