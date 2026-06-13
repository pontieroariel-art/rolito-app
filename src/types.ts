import { Timestamp } from 'firebase/firestore'

export type UserRole = 'super_admin' | 'gerente_comercial' | 'comercial' | 'logistica' | 'chofer' | 'cliente' | 'facturacion'
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
  id:                string
  nombre:            string
  unidad:            string
  unidadesPorPallet?: number
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
  username?: string
  // Asignación de vehículo
  camionId?:              string | null
  camionPatente?:         string | null
  camionModelo?:          string | null
  camionFechaAsignacion?: Timestamp | null
  // Seguimiento de visita comercial
  esVisita?:          boolean
  frecuenciaVisita?:  'semanal' | 'quincenal' | 'mensual'
  // Precios
  vigenciaCustom?:    Record<string, string>    // productoId → ISO date
  ultimoCambioPrecio?: Timestamp | null
  codigoCliente?:     string
  codVendedor?:       string   // código de vendedor asignado (e.g. MV, AD)
  dni?:               string   // DNI sin puntos (8 dígitos) — staff y choferes
  notasContacto?:     string   // internal-only notes from Excel import (admin view)
  fechaAlta?:         Timestamp | null
  sector?:            string   // internal-only prefix from COD_CTE (e.g. FC, MDP, YPF)
  subrol?:            'chofer' | 'ayudante'
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

export const CANALES_CAMION = [
  'General',
  'Estaciones de servicio',
  'Entrega de equipos',
  'Aplicaciones',
  'Uso interno',
] as const

export type CanalCamion = typeof CANALES_CAMION[number]

export interface Camion {
  id:                string
  patente:           string
  modelo:            string
  marca?:            string
  activo:            boolean
  capacidadPallets?: number
  canales?:          CanalCamion[]
  createdAt:         Timestamp
}

export function getPrimaryAddress(user: UserProfile): DeliveryAddress | null {
  if (!user.addresses || user.addresses.length === 0) return null
  return user.addresses.find((a) => a.esPrincipal) ?? user.addresses[0]
}

// ── Despacho ──────────────────────────────────────────────────────────────────

export const PLANTAS = {
  torcuato: { label: 'Planta Don Torcuato', lat: -34.484942373454,  lng: -58.608981028836155 },
  merlo:    { label: 'Planta Merlo',        lat: -34.661216003246,  lng: -58.7437552243348   },
} as const

export type PlantaId = keyof typeof PLANTAS

export interface Despacho {
  id:           string     // `${fecha}_${emailSanitizado}`
  fecha:        string     // 'yyyy-MM-dd'
  driverId:     string     // email del chofer
  driverName:   string
  camionId:     string | null
  camionLabel:  string | null
  status:       'borrador' | 'confirmado'
  orderIds:     string[]   // IDs en orden optimizado ORS
  plantaId?:    PlantaId   // planta de salida
  horaSalida?:  string     // 'HH:MM'
  ayudanteEmail?: string | null
  ayudanteName?:  string | null
  confirmedAt?: Timestamp | null
  confirmedBy?: string | null
  modifiedAfterConfirm?: boolean
}

export interface AccionHistorial {
  accion:        string
  usuarioId:     string
  usuarioNombre: string
  timestamp:     Timestamp
  detalle?:      string | null
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
  origenPdf?:  boolean
  numeroOC?:   string
  horaEntrega?: string
  entregaParcial?:      boolean
  productosEntregados?: OrderProduct[]
  notaEntrega?:         string
  motivoCancelacion?:   string
  origenRecurrente?:    boolean
  // Reprogramación / reasignación
  reprogramado?:         boolean
  fechaOriginal?:        Timestamp
  motivoReprogramacion?: string
  choferOriginal?:       string
  reasignado?:           boolean
  motivoReasignacion?:   string
  // Auditoría
  historialAcciones?: AccionHistorial[]
}

export const MOTIVOS_INCIDENCIA = [
  'Tiempo insuficiente',
  'Problema mecánico',
  'Cliente ausente',
  'Dirección incorrecta',
  'Condiciones climáticas',
  'Zona de riesgo',
  'Otro',
] as const
export type MotivoIncidencia = typeof MOTIVOS_INCIDENCIA[number]

// ── Historial de precios ──────────────────────────────────────────────────────

export interface HistorialPrecioEvento {
  id:                  string
  clientId:            string
  clientName:          string
  tipo:                'lista' | 'custom'
  // Cambio de lista
  listaAnteriorId?:    string | null
  listaAnteriorNombre?: string | null
  listaNuevaId?:       string | null
  listaNuevaNombre?:   string | null
  // Cambio de precio custom
  productoId?:         string
  productoNombre?:     string
  precioAnterior?:     number | null
  precioNuevo?:        number | null
  accion?:             'agregado' | 'modificado' | 'eliminado'
  vigenciaHasta?:      Timestamp | null
  // Metadata
  fecha:               Timestamp
  modificadoPor:       string
  modificadoPorNombre: string
  motivo?:             string | null
}

// ── Pedidos recurrentes ───────────────────────────────────────────────────────

export interface PedidoRecurrente {
  id:                string
  clientId:          string
  clientEmail:       string
  clientName:        string
  clientAddress:     string
  clientPhone:       string
  diasSemana:        number[]      // 0=Dom … 6=Sáb
  products:          OrderProduct[]
  activo:            boolean
  notas?:            string
  createdAt:         Timestamp
  ultimaGeneracion?: Timestamp | null
}
