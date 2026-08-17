import { Timestamp } from 'firebase/firestore'

export type UserRole = 'super_admin' | 'gerente_general' | 'gerente_comercial' | 'comercial' | 'logistica' | 'chofer' | 'cliente' | 'facturacion' | 'heladeras' | 'heladeras_encargado' | 'tecnico'
export type UserStatus = 'activo' | 'inactivo' | 'pendiente'

// Sistema (Logística/Heladeras) — ver src/utils/sistemas.ts para el mapeo
// rol→sistemas y la lógica de recorte por usuario.
export type Sistema = 'logistica' | 'heladeras'

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
  coordPendiente?: {
    lat:          number
    lng:          number
    choferId:     string
    choferNombre: string
    timestamp:    Timestamp
  }
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
  area?:              AreaHeladera   // sector de heladeras (rol 'heladeras')
  // Favoritos del técnico en el checklist de tipos de reparación (id de
  // config/tiposReparacion) — solo lo usa el técnico de calle (rol
  // 'tecnico'), para encontrar rápido desde el celular.
  tiposFavoritos?:    string[]
  // Alta rápida de cliente por staff (CrearClienteModal) — ausente en
  // clientes autorregistrados o importados por Excel.
  creadoPor?: { uid: string; nombre: string; rol: UserRole }
  // Recorte de acceso por usuario (solo lo edita super_admin, desde
  // Usuarios → Permisos) — subconjunto de lo que su rol ya permite, nunca
  // lo amplía. Sin setear = sin recorte, se comporta como hoy.
  sistemasPermitidos?: Sistema[]
  pestanasPermitidas?: string[]
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
  // Solo se completan en transiciones de pipeline (heladeras) — trazabilidad
  // estado_origen -> estado_destino pedida para el módulo de taller.
  estadoOrigen?:  EstadoHeladera | null
  estadoDestino?: EstadoHeladera | null
  // Paso de config/pasosTaller que se acaba de DEJAR en esta transición
  // (paso_completado/paso_aprobado/paso_rechazado) — permite reconstruir
  // cuánto tiempo pasó la heladera en cada paso. No retroactivo: entradas
  // viejas (previas a este campo) no lo tienen, se ignoran al calcular.
  pasoId?: string | null
  // Checklist de config/tiposReparacion tildados al soltar/aprobar este
  // paso — mismo propósito que TicketServicio.trabajosRealizados, para
  // estadística de arreglos también del lado del taller.
  tiposReparacion?: TrabajoRealizadoItem[] | null
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
  // Código de sucursal/cliente (ej. "FC.395") resuelto y guardado en el
  // momento de crear el pedido — así el chofer lo ve sin necesitar permiso
  // de lectura amplio sobre `users`. Mismo criterio que getCodigoCliente().
  codigoCliente?: string
  // Trazabilidad de OC (PDF o manual)
  fechaEmision?: Timestamp
  fechaTope?:    Timestamp
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
  esUrgente?: boolean
  // Idempotencia del aviso "camión cerca" (Cloud Function notifyCerca) — se
  // resetea al reprogramar (nuevo intento de entrega).
  avisoCercaEnviado?: boolean
  // Auditoría
  historialAcciones?: AccionHistorial[]
  // Modificación (cancelar + recrear)
  pedidoOriginalId?: string
  // Posición del chofer asignado, espejada server-side desde `ubicaciones` por
  // el trigger mirrorDriverLocation mientras el pedido está en_camino. Permite
  // al cliente seguir SU camión leyendo su propio pedido, sin acceso a la flota.
  driverLocation?: {
    lat:            number
    lng:            number
    nombreChofer:   string
    telefonoChofer: string
    updatedAt:      Timestamp | null
  }
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
  // Cambio de lista asignada / precio custom: por cliente puntual.
  // Edición de una lista completa (tipo 'lista_editada'): no hay un cliente
  // puntual, así que clientId/clientName quedan sin usar y se completan
  // listaId/listaNombre en su lugar.
  clientId?:           string
  clientName?:         string
  tipo:                'lista' | 'custom' | 'lista_editada'
  // Cambio de lista asignada a un cliente
  listaAnteriorId?:    string | null
  listaAnteriorNombre?: string | null
  listaNuevaId?:       string | null
  listaNuevaNombre?:   string | null
  // Edición de una lista completa (afecta a todos sus clientes asignados)
  listaId?:            string
  listaNombre?:        string
  // Cambio de precio custom / de un producto dentro de una lista editada
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

// ── Heladeras (taller) ─────────────────────────────────────────────────────

export const AREAS_HELADERA = [
  'produccion', 'lijado', 'pintura', 'refrigeracion', 'servicio_tecnico',
  'plastico', 'ensamble_inyectado', 'terminacion',
] as const
export type AreaHeladera = typeof AREAS_HELADERA[number]

export type TipoPipelineHeladera = 'fabricacion' | 'reacondicionamiento'

// Catálogo administrable por el encargado (config/pasosTaller, doc único con
// mapa {id: PasoTaller}) — reemplaza la secuencia fija que antes vivía
// hardcodeada en heladeraPipeline.ts. Dos pipelines conviven: fabricación
// (heladeras nuevas, hechas desde cero) y reacondicionamiento (heladeras
// usadas que vuelven de un cliente). `siguientePasoId` se recalcula cada vez
// que se guarda el catálogo (ver pasosTallerService.ts) para que las
// Firestore rules puedan validar la transición con un acceso directo, sin
// tener que ordenar/buscar en una lista.
export interface PasoTaller {
  id:                  string
  nombre:              string
  tipoPipeline:        TipoPipelineHeladera
  area:                AreaHeladera   // sector dueño de este paso
  orden:               number
  activo:              boolean
  requiereAprobacion?: boolean         // ej. "Control de calidad": soltar tiene 2 salidas (aprobar/rechazar)
  siguientePasoId:     string | null   // null = último paso activo de su tipoPipeline
}

// Estado grueso de una heladera. La cola/en-proceso dentro del taller ya no
// se codifica acá (antes era un estado por cada paso × fase) — vive en
// pasoActualId + enProceso (null = en cola, con datos = en proceso).
export type EstadoHeladera =
  | 'en_taller'    // dentro de algún pipeline (fabricación o reacondicionamiento), en cola o en proceso
  | 'disponible'   // depósito de heladeras fabricadas/reacondicionadas, lista para asignar
  | 'en_comodato'
  | 'baja'

export type TipoOperacionIngreso = 'RETIRO' | 'CAMBIO'

// Catálogo administrable por el encargado — por qué ingresa una heladera
// USADA al taller (solo aplica a tipoPipeline 'reacondicionamiento'; una
// heladera de fabricación nueva no tiene motivo de ingreso). El tipo de
// operación va tageado en el motivo (no es un campo independiente): "Retiro
// de heladera" es RETIRO, el resto son CAMBIO.
export interface MotivoIngreso {
  id:            string
  nombre:        string
  tipoOperacion: TipoOperacionIngreso
  activo:        boolean
}

export interface Heladera {
  id:          string
  numeroSerie: string
  modeloId:    string   // referencia a ModeloHeladera
  modelo:      string   // snapshot del nombre del modelo al momento del alta
  codigoInterno: string // código propio (no autogenerado), único, va impreso en la etiqueta
  estado:      EstadoHeladera
  tipoPipeline: TipoPipelineHeladera
  // Paso en cola o en proceso dentro de pasosTaller — null cuando estado es
  // disponible/en_comodato/baja.
  pasoActualId: string | null
  // Snapshot del primer paso activo del tipoPipeline al momento del alta —
  // destino fijo de un rechazo (control de calidad u otro paso con
  // requiereAprobacion), para no depender de una búsqueda dinámica.
  primerPasoId: string | null
  // Motivo de ingreso — solo aplica a tipoPipeline 'reacondicionamiento',
  // snapshot del catálogo al momento de cargarla.
  motivoIngresoId?:      string | null
  motivoIngresoNombre?:  string | null
  tipoOperacion?:        TipoOperacionIngreso | null
  observacionesIngreso?: string | null
  creadoPor:   { uid: string; nombre: string }
  fechaIngreso: Timestamp
  // Cuántas veces entró al pipeline — arranca en 1, sube si un paso con
  // requiereAprobacion la rechaza y vuelve al primer paso para un
  // reprocesamiento completo.
  cicloActual: number
  motivoBaja?: string | null
  enProceso?: {
    uid:    string
    nombre: string
    area:   AreaHeladera
    desde:  Timestamp
  } | null
  clienteAsignadoId?:     string | null
  clienteAsignadoNombre?: string | null
  fechaAsignacion?:       Timestamp | null
  historialAcciones: AccionHistorial[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Asignación de equipos (comodatos) ───────────────────────────────────────
// Colección aparte, append-only: es el historial de remitos/comodatos —
// heladeras.clienteAsignadoId solo refleja el estado ACTUAL.

export interface AsignacionHeladera {
  id:            string
  heladeraId:    string
  heladeraCodigo: string
  clientId:      string
  clientName:    string
  tipo:          'asignacion' | 'retiro'
  numero:        number   // número de remito/comodato, compartido entre ambos documentos
  firmaDataUrl:  string   // PNG en base64 — pesa unos KB, no justifica Storage
  motivo?:       string | null   // solo en retiro
  actor:         { uid: string; nombre: string }
  fecha:         Timestamp
}

// ── Modelos de heladera (ficha técnica) ─────────────────────────────────────

export interface ModeloHeladera {
  id:      string
  nombre:  string
  medidas: { ancho: number; alto: number; profundo: number }   // cm
  capacidadBolsas: number
  fotoUrl?: string
  activo:  boolean
  // Código automático para heladeras de fabricación (nunca para
  // reacondicionamiento, que sigue cargándose a mano): prefijoCodigo lo
  // edita el encargado (si no lo cargó, se arma un slug del nombre);
  // proximoNumero es interno, solo lo mueve la transacción de crearHeladera.
  prefijoCodigo?: string
  proximoNumero?: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Catálogos de service (motivos y tipos de reparación) ───────────────────

export interface MotivoReparacion {
  id:     string
  nombre: string
  activo: boolean
  requiereChofer?: boolean   // el ticket con este motivo se asigna a un chofer, no a un técnico
  urgente?:        boolean  // urgencia por defecto de los tickets abiertos con este motivo
}

export interface TipoReparacion {
  id:     string
  nombre: string
  activo: boolean
  // Sector que hace este trabajo — pintura/lijado/refrigeración. Filtra qué
  // tipos ve cada técnico (según su propio sector) y cada personal de taller
  // al soltar un paso o aprobar control de calidad.
  area:   AreaHeladera
}

// Snapshot de un TipoReparacion tildado en el checklist — nombre incluido
// para no depender de que el catálogo no haya cambiado después.
export interface TrabajoRealizadoItem {
  tipoId:     string
  tipoNombre: string
}

// ── Tickets de service ──────────────────────────────────────────────────────

export type EstadoTicketServicio = 'abierto' | 'asignado_tecnico' | 'asignado_chofer' | 'cerrado' | 'anulado'

export interface TicketServicio {
  id:              string
  numero:          number
  heladeraId:      string
  heladeraCodigo:  string
  clientId:        string
  clientName:      string
  motivoId:        string
  motivoNombre:    string
  requiereChofer:  boolean
  // Snapshot de MotivoReparacion.urgente al crear el ticket — un cambio
  // posterior al catálogo no reescribe tickets ya abiertos.
  urgente:         boolean
  // Quién lo abrió: 'cliente' (autogestionado desde "Mis heladeras") o
  // 'staff' (Toma de service). Determina si el trigger onTicketCreado avisa
  // por push a los encargados — un ticket de staff ya lo conoce quien lo
  // creó, uno de cliente no lo conoce nadie hasta que alguien se entera.
  origen:          'cliente' | 'staff'
  estado:          EstadoTicketServicio
  asignadoA?: {
    tipo:   'tecnico' | 'chofer'
    uid:    string
    nombre: string
  } | null
  // Snapshot legacy — código nuevo ya no los escribe, ver trabajosRealizados.
  tipoReparacionId?:     string | null
  tipoReparacionNombre?: string | null
  // Checklist de config/tiposReparacion tildados al registrar el trabajo —
  // multi-select, reemplaza el <select> de un solo tipo de antes. Habilita
  // estadística de arreglos (calcularEstadisticaArreglos).
  trabajosRealizados?:   TrabajoRealizadoItem[] | null
  // Texto autogenerado (nombres de trabajosRealizados unidos + notas
  // opcionales) — se sigue mostrando como string en todos los lugares que
  // ya lo leían así (ficha del equipo, Consulta de service, dashboard).
  trabajoRealizado?:     string | null
  conformidad?: {
    firmaDataUrl:        string
    nombreQuienConfirma: string
  } | null
  anuladoPor?:      { uid: string; nombre: string } | null
  motivoAnulacion?: string | null
  cerradoPor?:      { uid: string; nombre: string } | null
  historialAcciones: AccionHistorial[]
  fechaPedido:  Timestamp
  fechaCierre?: Timestamp | null
  createdAt:    Timestamp
  updatedAt:    Timestamp
}

// ── Preventivos (mantenimiento anual) ───────────────────────────────────────
// El documento ID es `${clientId}_${year}` — si no existe, se asume pendiente
// (no hace falta un doc "pendiente" por cliente, solo se guardan los hechos).

export interface Preventivo {
  id:       string
  clientId: string
  year:     number
  hecho:    boolean
  fecha?:   Timestamp | null
  actor?:   { uid: string; nombre: string } | null
}

// ── Pañol (repuestos y materiales) ──────────────────────────────────────────

export interface PanolArticulo {
  id:           string
  nombre:       string
  codigoBarras: string
  unidad:       string
  stockActual:  number
  stockMinimo:  number
  stockMaximo:  number
  createdAt:    Timestamp
  updatedAt:    Timestamp
}

export interface PanolMovimientoArticulo {
  articuloId: string
  nombre:     string
  cantidad:   number
}

export interface PanolMovimiento {
  id:          string
  tipo:        'entrega' | 'recepcion'
  articulos:   PanolMovimientoArticulo[]
  destinatario?: { uid: string; nombre: string; rol: UserRole } | null   // solo en 'entrega'
  confirmado:  boolean
  firmaDataUrl?: string | null
  confirmadoAt?: Timestamp | null
  actor:       { uid: string; nombre: string }
  fecha:       Timestamp
}
