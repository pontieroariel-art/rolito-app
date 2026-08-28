import { Timestamp } from 'firebase/firestore'

export type UserRole = 'super_admin' | 'gerente_general' | 'gerente_comercial' | 'comercial' | 'logistica' | 'chofer' | 'cliente' | 'facturacion' | 'heladeras' | 'heladeras_encargado' | 'tecnico' | 'produccion_hielo' | 'produccion_encargado'
export type UserStatus = 'activo' | 'inactivo' | 'pendiente'

// Sistema (Logística/Heladeras/Producción) — ver src/utils/sistemas.ts para el
// mapeo rol→sistemas y la lógica de recorte por usuario.
export type Sistema = 'logistica' | 'heladeras' | 'produccion'

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

// ── Reparto: depósitos y venta desde camión (integración Tango) ───────────────
// Ver docs/tango/INTEGRACION.md y el plan de reparto. El stock/contabilidad es
// fuente de verdad de Tango; Rolito registra la operación en tiempo real y le
// manda los movimientos por la vía oficial (writers del bridge, por ahora stub).

// Cámaras (Torcuato/Merlo) y camiones son depósitos en Tango.
export interface Deposito {
  id:                  string
  nombre:              string
  tipo:                'camara' | 'camion'
  depositoTangoCodigo: string
  camionId?:           string   // solo si tipo === 'camion'
}

export type FormaPago = 'contado_efectivo' | 'contado_transferencia' | 'cuenta_corriente'

// Canal de la venta → decide la empresa de Tango donde entra el remito y el
// precio aplicado. 'contado' = Venta Contado (Redonhielo, se factura);
// 'promo' = Promo (Rolito, no se factura). Las dos empresas comparten la misma
// base de clientes con el mismo código, así que el codigoTango sirve para ambas.
export type CanalVenta = 'contado' | 'promo'

export interface VentaCamionItem {
  productoId:     string
  nombre:         string
  cantidad:       number
  precioUnitario: number
}

// Estado de sincronización del remito con Tango (mismo patrón que el resto de
// la cola tango-outbox: pendiente → enviado → confirmado/error).
export interface RemitoTangoEstado {
  estado:       'pendiente' | 'enviado' | 'confirmado' | 'error'
  remitoNumero?: string
  ultimoError?:  string
}

// Una venta/entrega hecha por el chofer desde el camión (flujo principal del
// reparto: a demanda, a clientes ya registrados, precio = lista del cliente).
// Descarga del depósito-camión y genera un remito en Tango (async).
export interface VentaCamion {
  id:                   string
  canal:                CanalVenta   // promo (Rolito) / contado (Redonhielo)
  camionId:             string
  choferId:             string
  choferNombre:         string
  clienteId:            string     // uid del cliente registrado
  clienteNombre:        string
  clienteCodigoTango?:  string     // COD_GVA14 (para el remito en Tango)
  clienteIdGva14Tango?: number
  items:                VentaCamionItem[]
  total:                number
  formaPago:            FormaPago
  // Constancia de entrega: dataURL PNG de la firma, guardado en el propio doc
  // (una firma pesa decenas de KB, muy por debajo del límite de 1MB, y así se
  // encola offline con el resto de la venta — Storage no encola sin red).
  firmaCliente?:        string
  firmanteNombre?:      string     // nombre y apellido de quien firma (aclaración)
  fecha:                Timestamp
  pedidoId?:            string | null   // pedido previo que la originó, si hubo
  tango?:               RemitoTangoEstado
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
  codigoTango?:       string   // COD_GVA14 de Tango (cruzado por CUIT, ver scripts/tango/) — numeración distinta de codigoCliente
  idGva14Tango?:      number   // ID_GVA14 de Tango — para GetById/Update/Delete contra la API de Plataforma
  // Datos de Tango, namespaced para no pisar los operativos existentes (domicilio
  // fiscal, no necesariamente el punto real de entrega — no usar en logística,
  // ver orderService.ts que usa `address`/`addresses[]`). Los escribe la Cloud
  // Function syncClientesTango (functions/src/triggers/tangoSync.ts).
  domicilioTango?:        string
  localidadTango?:        string
  provinciaTango?:        string
  codigoPostalTango?:     string
  categoriaIvaTango?:     string   // COD_CATEGORIA_IVA (ej. "RI")
  categoriaIvaTangoDesc?: string   // DESC_CATEGORIA_IVA (ej. "Responsable Inscripto")
  tangoUltimaSync?:       Timestamp | null
  codVendedor?:       string   // código de vendedor asignado (e.g. MV, AD)
  // Contado / cuenta corriente, etc. — ver CONDICIONES_VENTA en constants.ts.
  // String libre (no unión estricta) porque algunos clientes ya traen un
  // valor crudo de la importación vieja de Tango (COND_VTA) que no
  // necesariamente coincide con las opciones fijas del desplegable.
  condicionVenta?:    string
  dni?:               string   // DNI sin puntos (8 dígitos) — staff y choferes
  // Chofer: propio (no cobra comisión) vs fletero (cobra % mensual sobre lo
  // facturado). Ver liquidación / comisión en la integración de reparto Tango.
  tipoChofer?:        'propio' | 'fletero'
  comisionPorcentaje?: number   // % de comisión mensual (solo fleteros)
  notasContacto?:     string   // internal-only notes from Excel import (admin view)
  // Clientes que ESTE usuario de staff decidió sacarse de encima en su propio
  // mapa de Planificación (ej. estaciones de servicio que no coordina) — es
  // una preferencia personal, no un estado del cliente: no afecta su login,
  // sus pedidos ni lo que ve otro miembro del staff.
  clientesOcultosMapa?: string[]
  fechaAlta?:         Timestamp | null
  sector?:            string   // internal-only prefix from COD_CTE (e.g. FC, MDP, YPF)
  subrol?:            'chofer' | 'ayudante'
  area?:              AreaHeladera   // sector de heladeras (rol 'heladeras')
  planta?:            PlantaId   // planta de producción fija del operario (rol 'produccion_hielo')
  legajo?:            string   // login del operario de producción (rol 'produccion_hielo') — solo el número, sin contraseña, ver produccionAuthService.ts
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
  vuelta?:       number           // ver Order.vuelta / Despacho.vuelta
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
  vuelta?:       number           // ver Order.vuelta / Despacho.vuelta
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

// ── Producción de hielo ───────────────────────────────────────────────────────
// Carga de pallets en planta (rol 'produccion_hielo'). Catálogo cerrado de
// productos en src/utils/produccionCatalogo.ts.

export type ProductoHieloId =
  | 'bolsas_10kg_rolito'
  | 'bolsas_3kg_rolito'
  | 'bolsas_2kg_rolito'
  | 'picado_10kg'
  | 'escama_10kg'
  | 'barras_hielo'
  | 'rembolsado_cementera_10kg'

export interface PalletProduccion {
  id:               string
  codigo:           string   // "DT-000123" — correlativo por planta, va en QR/barcode en texto plano
  numero:           number   // parte numérica de `codigo`
  plantaId:         PlantaId
  productoId:       ProductoHieloId
  productoNombre:   string   // denormalizado del catálogo al momento de crear
  unidades:         number   // denormalizado del catálogo (protege el historial si el catálogo cambia)
  operador:         { uid: string; nombre: string }
  fechaFabricacion: Timestamp   // Timestamp.now() del cliente — se necesita para imprimir ya, no depende de serverTimestamp()
  createdAt:        Timestamp   // serverTimestamp(), solo para orden/sincronización
}

export interface Despacho {
  id:           string     // `${fecha}_${emailSanitizado}` (vuelta 1) | `${fecha}_${emailSanitizado}_v${vuelta}` (vuelta 2+)
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
  // Número de vuelta del camión/chofer ese día (1 = primera, sin campo =
  // también 1). Permite un 2do despacho independiente del mismo chofer el
  // mismo día ("sale, entrega, vuelve a cargar") sin mezclar sus paradas con
  // las de la 1ra vuelta.
  vuelta?:      number
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
  // Vuelta del despacho del chofer a la que pertenece esta parada (ver
  // Despacho.vuelta) — sin campo = vuelta 1. Se persiste en el pedido (no
  // solo en Despacho.orderIds) para que un despacho todavía en borrador
  // sobreviva a un refresh de página sin colapsar a una sola vuelta.
  vuelta?: number
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
  // Sucursal específica del cliente donde está el equipo — clientes con
  // muchas sucursales bajo un mismo CUIT (grupos empresarios: YPF, cadenas,
  // etc.) tienen UN solo `clienteAsignadoId` pero decenas de direcciones
  // distintas en `addresses[]`. Sin esto no hay forma de saber a qué
  // sucursal ir a hacer una visita o un service. `clienteAsignadoDireccionId`
  // referencia `UserProfile.addresses[].id` (coincide con el código de
  // sucursal en la mayoría de los casos); `clienteAsignadoDireccion` es un
  // snapshot de texto para no depender de un join en cada pantalla.
  clienteAsignadoDireccionId?: string | null
  clienteAsignadoDireccion?:   string | null
  fechaAsignacion?:       Timestamp | null
  // Número de compresor del equipo — se carga una sola vez al asignar (no se
  // vuelve a pedir en una renovación), va impreso en la orden de entrega.
  compresor?: string | null
  // Comodato vigente: `comodatoNumero` es el correlativo del contrato firmado
  // (mismo `numero` que su AsignacionHeladera de tipo asignación/renovación),
  // `comodatoFirmadoEl`/`comodatoVenceEl` marcan la vigencia (12 meses desde
  // la última firma). `comodatoAvisoEnviado` evita que el aviso semanal de
  // vencimiento repita la misma heladera hasta la próxima renovación.
  comodatoNumero?:        number | null
  comodatoFirmadoEl?:     Timestamp | null
  comodatoVenceEl?:       Timestamp | null
  comodatoAvisoEnviado?:  boolean
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
  direccionId?:  string | null   // sucursal del cliente, ver Heladera.clienteAsignadoDireccionId
  direccion?:    string | null
  tipo:          'asignacion' | 'retiro' | 'renovacion'
  numero:        number   // número de remito/comodato, compartido entre ambos documentos
  firmaDataUrl:  string   // PNG en base64 — pesa unos KB, no justifica Storage
  motivo?:       string | null   // solo en retiro
  // Quién firmó físicamente por el cliente — el contrato de comodato real
  // pide "representada por [nombre], cargo [x]" (el documento/CUIT ya sale
  // de clientId). Solo aplica a asignación/renovación.
  firmanteNombre?: string | null
  firmanteCargo?:  string | null
  compresor?:      string | null   // snapshot, solo se completa en asignación
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
  // Sucursal puntual donde está la heladera — snapshot tomado de
  // Heladera.clienteAsignadoDireccion al abrir el ticket, para que el
  // técnico/chofer sepa a qué dirección ir sin depender de un join (crucial
  // en clientes con muchas sucursales, ver Heladera.clienteAsignadoDireccionId).
  direccionId?:    string | null
  direccion?:      string | null
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
