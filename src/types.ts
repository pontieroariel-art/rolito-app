import { Timestamp } from 'firebase/firestore'

export type UserRole = 'super_admin' | 'gerente_general' | 'gerente_comercial' | 'comercial' | 'logistica' | 'chofer' | 'cliente' | 'facturacion' | 'heladeras' | 'heladeras_encargado' | 'tecnico' | 'produccion_hielo' | 'produccion_encargado' | 'caja' | 'muelle' | 'seguridad' | 'supervisor' | 'tesoreria'
export type UserStatus = 'activo' | 'inactivo' | 'pendiente'

// Sistema (Logística/Heladeras/Producción/Expedición) — ver src/utils/sistemas.ts
// para el mapeo rol→sistemas y la lógica de recorte por usuario.
export type Sistema = 'logistica' | 'heladeras' | 'produccion' | 'expedicion'

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
  fotoUrl?:          string   // downloadURL de Storage (botonera de venta)
  destacado?:        boolean  // aparece en la sección "Frecuentes" de la botonera
  etiqueta?:         string   // texto del badge de la tarjeta (lo que distingue: "10 kg", "Picado"…); default: peso del nombre
  color?:            string   // color del badge/placeholder (hex); default: derivado del id
}

// Las listas de precios propias de la app (colección listas-precios) se
// eliminaron el 2026-09-03: los precios vienen de Tango (preciosTango/* y
// users.preciosTango). Ver docs/tango/INTEGRACION.md §17.

// ── Reparto: depósitos y venta desde camión (integración Tango) ───────────────
// Ver docs/tango/INTEGRACION.md y el plan de reparto. El stock/contabilidad es
// fuente de verdad de Tango; Rolito registra la operación en tiempo real y le
// manda los movimientos por la vía oficial (writers del bridge, por ahora stub).

// Depósitos de Tango (depositosTango/{codigo}): en Tango cada repartidor es un
// depósito en tránsito (03 SERGIO ALVAREZ … 55, tercerizados, supervisores);
// 01/02 son las plantas y 26/29/81/97/98/99 depósitos internos. La expedición
// de la app (carga, descarga, liquidación) trabaja por depósito; el usuario de
// la app vinculado es opcional. Ver utils/depositos.ts (identidad en los docs).
export type TipoDeposito = 'repartidor' | 'planta' | 'interno'
export interface DepositoTango {
  codigo:        string      // COD_STA22 ('03', '21', '33')
  nombre:        string      // NOMBRE_SUC de Tango ('SERGIO ALVAREZ', 'NOAIN 01')
  idSta22:       number
  inhabilitado:  boolean     // INHABILITA en Tango
  tipo:          TipoDeposito
  activo:        boolean     // editable: esconderlo de los combos sin tocar Tango
  uid?:          string | null   // usuario de la app vinculado (chofer o supervisor)
  usuarioNombre?: string | null
  usuarioRol?:   string | null
  actualizadoEn?: Timestamp
}

// Constancia del mail con el comprobante de una venta al cliente. La escribe
// SOLO el server (enviarComprobantePorMail) en ventasCamion / ventasVentanilla;
// `automatico` = lo mandó la app sola al registrar la venta (2026-09-11).
export interface EnvioMailVenta {
  estado:      'enviado' | 'error'
  para:        string
  enviadoEn:   Timestamp
  automatico?: boolean
  error?:      string
  resendId?:   string
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
  /** Write-back del recibo de cobranza (onOutboxConfirmado, entidad 'recibo'): 'X0110600000041'. */
  reciboNumero?: string
  /** Write-back de la factura de Tango (entidad 'factura'). */
  facturaNumero?: string
  ultimoError?:  string
  /**
   * Movimiento de STOCK aparte del comprobante (entidad 'movimientoStock'):
   * el egreso VPR en Redonhielo por una venta promo, cuya factura va a Rolito
   * sin descargar stock (2026-09-05). Campos propios para no pisar los de la
   * factura: un mismo doc tiene las dos confirmaciones.
   */
  stockEstado?:  'confirmado'
  stockNumero?:  string
  stockTipo?:    string
}

// Una venta/entrega hecha por el chofer desde el camión (flujo principal del
// reparto: a demanda, a clientes ya registrados, precio = lista del cliente).
// Descarga del depósito-camión y genera un remito en Tango (async).
// Espejo de la factura electrónica en la venta, que escribe el trigger
// `onVentaContadoFacturar`. Los importes son los que se le informaron a ARCA:
// el comprobante impreso tiene que mostrar exactamente eso, no un recálculo.
export interface FacturaArcaVenta {
  estado:     'emitida' | 'rechazada' | 'incierta'
  numero:     number
  puntoVenta: number
  cbteTipo:   number      // 1 = Factura A, 6 = Factura B, 11 = C
  cae:        string | null
  caeFchVto:  string | null   // AAAAMMDD
  importes?: {
    fecha:    string      // AAAAMMDD
    neto:     number
    iva:      number
    tributos: number      // percepción de IIBB
    total:    number
  }
}

export interface VentaCamion {
  id:                   string
  canal:                CanalVenta   // promo (Rolito) / contado (Redonhielo)
  camionId:             string
  choferId:             string
  choferNombre:         string
  depositoTango?:       string     // depósito de Tango del vendedor al momento de vender
  depositoTangoNombre?: string
  clienteId:            string     // uid del cliente registrado
  clienteNombre:        string
  clienteCodigoTango?:  string     // COD_GVA14 (para el remito en Tango)
  clienteIdGva14Tango?: number
  /** Nombre de la sucursal de Tango donde se entregó (razón social del código), cuando
   *  la cuenta tiene varias y difiere del nombre de la cuenta. Los listados lo muestran
   *  en vez de `clienteNombre` (utils/nombreClienteVenta.ts, 2026-09-11). */
  clienteSucursalNombre?: string
  /** Orden de compra del cliente (2026-09-11): la carga el chofer o viene del pedido (orders.numeroOC); se imprime en remito/factura y va a Tango en una leyenda. */
  ordenCompra?:         string
  /** Venta anulada que esta reemplaza (reemisión asistida, 2026-09-11): id en la misma colección. */
  reemiteDe?:           string
  items:                VentaCamionItem[]
  // Bolsas rotas que el cliente devuelve y el chofer repone, sin cargo.
  // Renglones del documento que salga de la operación (factura si se cobró en
  // efectivo o transferencia, remito si va a cuenta corriente), SIEMPRE con
  // precioUnitario 0: no suman al total ni a lo que se le declara a ARCA.
  // Los ids llevan el prefijo `cambio_` — ver utils/cambios.ts.
  cambios?:             VentaCamionItem[]
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
  factura?:             FacturaArcaVenta   // solo en ventas contado
  /** Anulación de la factura con nota de crédito (2026-09-11): la pide caja desde la
   *  liquidación abierta; el server la escribe (misma forma que en ventanilla). */
  anulacion?:           AnulacionEnVenta
  /** Mail del comprobante al cliente (lo anota el server al mandarlo; automático desde 2026-09-11). */
  envioMail?:           EnvioMailVenta
  // Numeración propia del documento que sale cuando NO hay factura de ARCA:
  // el remito (cuenta corriente Redonhielo / promo Rolito) o la factura "X" de
  // promo. Punto de venta aparte del de ARCA. Ausente = venta sin numerar
  // (contador no inicializado o sin lote reservado).
  comprobanteInterno?:  ComprobanteInternoVenta
}

// Comprobantes internos de la venta del camión (los que no autoriza ARCA):
// 'remito' para cuenta corriente y promo sin cobro; 'facturaX' para promo
// cobrada (Rolito, no oficial). Decisión 2026-09-03.
// 'remito' = Redonhielo (oficial, con CAI del talonario cuando está cargado);
// 'remitoPromo' = Rolito (mismo papel, número de control interno);
// 'facturaX' = promo cobrada. Series independientes.
export type TipoComprobanteInterno = 'remito' | 'remitoPromo' | 'facturaX'
export interface ComprobanteInternoVenta {
  tipo:       TipoComprobanteInterno
  puntoVenta: number
  numero:     number
}

// Factura emitida por Tango (no por la app) cuyo PDF administración guardó
// desde Recupero de facturas (2026-09-07), para que el supervisor la comparta
// con el cliente desde la composición de saldos. Tango no las entrega por
// API. Doc id: `${empresa}-${clave}`; el PDF vive en Storage `storagePath`.
export interface FacturaArchivada {
  id:          string
  clave:       string        // 'A0010100173697' — ver utils/facturaClave.ts
  empresa:     EmpresaTango
  letra:       'A' | 'B' | 'C'
  puntoVenta:  number
  numero:      number
  fecha:       string        // yyyy-MM-dd (emisión)
  total:       number
  cuitCliente: string
  razonSocial: string
  storagePath: string        // 'facturas/{empresa}/{clave}.pdf'
  subidoPor:   { uid: string; nombre: string }
  subidoEn:    Timestamp
}

// ── Expedición: remito de carga del camión ────────────────────────────────────
// Caja (rol 'caja', fijo por planta) arma el remito de carga: qué mercadería
// sube a qué camión con qué chofer. Se imprime y muelle entrega contra él —
// reemplaza el remito manuscrito del circuito viejo. Es el "debe" contra el
// que después se liquida el día del repartidor (ventas + cambios + descarga).

// ── Envases retornables del camión (2026-09-07) ──────────────────────────────
// Un pallet armado es "completo" (tarima de madera + 4 puntales + 1 aro) o de
// metal (pallet de metal + 4 puntales + 1 aro). A la ida puntales y aros van
// implícitos (PUNTALES_POR_PALLET / AROS_POR_PALLET en utils/envases.ts); a la
// vuelta muelle los cuenta sueltos, por si faltan. Los racks de agua están
// numerados: se registra qué números salen y cuáles vuelven (no se vinculan a
// los bidones, que son un producto más del remito). Tango no los recibe por
// ahora (viajan en el payload de la cola para mapearlos más adelante).
export interface EnvasesCarga {
  tarimasMadera: number     // pallets "completos": tarima + 4 puntales + 1 aro
  palletsMetal:  number     // pallet de metal + 4 puntales + 1 aro
  racks:         number[]   // números de rack de agua (únicos, enteros > 0)
}
export interface EnvasesDescarga {
  tarimasMadera: number
  palletsMetal:  number
  puntales:      number
  aros:          number
  racks:         number[]
}
export interface ConteoEnvases { tarimasMadera: number; palletsMetal: number; puntales: number; aros: number }
export interface LiquidacionEnvases {
  salieron:       ConteoEnvases & { racks: number[] }   // Σ remitos del día (puntales/aros implícitos)
  volvieron:      ConteoEnvases & { racks: number[] }   // Σ descargas del día
  diferencia:     ConteoEnvases                          // volvieron − salieron (negativo = faltan)
  racksFaltantes: number[]                               // salieron y no volvieron
  racksSobrantes: number[]                               // volvieron sin haber salido
}

export interface RemitoCargaItem {
  productoId: string   // id de config/catalogo
  nombre:     string
  cantidad:   number
  // Pallets que ocupa este producto: ceil(cantidad / unidadesPorPallet del
  // catálogo). Ausente si el producto no viaja en pallet (sin unidadesPorPallet).
  pallets?:   number
}

// Estados del circuito físico: caja lo emite → muelle entrega la mercadería →
// seguridad controla la salida en el portón → la liquidación del día lo cierra.
// Fase 1 solo usa 'emitido'; las transiciones llegan con muelle/seguridad.
export type RemitoCargaEstado = 'emitido' | 'entregado' | 'salido' | 'liquidado'

export interface RemitoCarga {
  id:           string
  numero:       number       // correlativo por planta (config/cargaCounter_{plantaId})
  codigo:       string       // "RC-DT-000123" / "RC-ML-000045"
  plantaId:     PlantaId
  camionId:     string
  camionLabel:  string       // patente + modelo al momento de emitir (snapshot)
  choferId:     string       // identidad del depósito: uid del usuario vinculado o 'dep:<código>' (utils/depositos.ts)
  choferNombre: string
  depositoTango?:       string   // código del depósito de Tango (expedición por depósito, 2026-09-06)
  depositoTangoNombre?: string
  items:        RemitoCargaItem[]
  // Total de pallets que salen en el camión = envases.tarimasMadera +
  // envases.palletsMetal (lo leen el TV de muelle, seguridad, el chofer y el
  // payload de Tango). El sugerido sale de las cantidades por formato (suma de
  // items[].pallets) y caja lo reparte entre madera y metal.
  palletsCarga: number
  // Composición de los envases retornables que salen (2026-09-07): la declara
  // caja al emitir (muelle se la dicta; cuando tenga dispositivos podrá
  // corregirla al entregar). Ausente en remitos anteriores — ver
  // src/utils/envases.ts (envasesDeRemito) para la lectura compatible.
  envases?:     EnvasesCarga
  estado:       RemitoCargaEstado
  // Dársena asignada por muelle cuando el camión entra a cargar (1..N según
  // la planta — ver DARSENAS_POR_PLANTA). Sin asignar = en espera. El
  // tablero de TV del muelle agrupa por este campo.
  darsena?:     number
  creadoPor:    { uid: string; nombre: string }
  fecha:        Timestamp
  entregadoPor?: { uid: string; nombre: string; hora: Timestamp }   // muelle (Fase 2)
  salida?:       { uid: string; nombre: string; hora: Timestamp }   // seguridad (Fase 4)
  tango?:       RemitoTangoEstado
  // COT de ARBA (2026-09-10): kilos totales de la carga (según config/cot.productos),
  // lo que caja declara al emitir y lo que ARBA devolvió (solo lo escribe el server).
  kg?:           number
  cotSolicitud?: CotSolicitud
  cot?:          CotResultado
  /**
   * Remito R oficial de la carga (2026-09-10): número del talonario 00025 que
   * la app asigna al emitir (contador config/remitoCargaCounter) con el CAI
   * vigente de ese momento. Se imprime como remito R "PARA REPARTO" y es el
   * comprobante que respalda el COT.
   */
  remitoR?:      { puntoVenta: number; numero: number; cai: string; vencimiento: string }
}

// ── COT de ARBA: Código de Operación de Traslado del remito de carga ─────────
// (2026-09-10) Obligatorio cuando la carga que sale de la planta supera
// config/cot.umbralKg (4.500 kg) o umbralImporte ($9.529.691 en 2026). Caja lo
// declara al emitir el remito de carga (destino, remito R que lo respalda,
// patente, recorrido) y la Cloud Function presentarCotArba arma el TXT, lo
// presenta al web service de ARBA y guarda el COT en `remitosCarga.cot`.
// Ver docs/arba/COT.md.

export interface CotDomicilio {
  calle:        string
  numero:       number      // 0 = S/N
  complemento?: string      // '', 'S/N', '1/2', '1/4', 'BIS'
  piso?:        string
  dto?:         string
  barrio?:      string
  cp:           string
  localidad:    string
  provincia:    string      // tabla ARBA: 'B' = Buenos Aires, 'C' = CABA
}

export type CotTipoRecorrido = 'U' | 'R' | 'M' | ''

export interface CotRecorrido {
  tipo:      CotTipoRecorrido
  localidad: string   // recorrido urbano
  calle?:    string
  ruta:      string   // recorrido rural: ruta/autopista principal
}

export interface CotPlantaConfig {
  /** Planta y puerta con que se nombra el archivo (TB_cuit_plantapuerta_fecha_sec.txt), 3 dígitos cada uno. */
  codigoPlanta: string
  puerta:       string
  domicilio:    CotDomicilio
  recorrido:    CotRecorrido
}

export interface CotProductoConfig {
  pesoKg:      number   // kg por unidad del catálogo (bolsa, barra, bidón)
  codigoArba:  string   // Nomenclador COT / NCM 6 dígitos (hielo 220190)
  descripcion: string   // PROPIO_DESCRIPCION_PRODUCTO (máx. 40)
}

export interface CotConfig {
  habilitado:     boolean                     // presenta a ARBA al emitir el remito
  ambiente:       'produccion' | 'prueba'
  cuit:           string                      // CUIT_EMPRESA / ORIGEN_CUIT (sin guiones)
  razonSocial:    string
  umbralKg:       number
  umbralImporte:  number
  importePorKg:   number                      // sugiere el importe a declarar
  bloqueaSalida:  boolean                     // seguridad no libera un camión que requiere COT y no lo tiene
  /**
   * Remito R que respalda la carga: código ARBA ('091'), talonario (25) y, si
   * la app lo numera e imprime como comprobante oficial ("PARA REPARTO", como
   * el de Bluesoft), el CAI del talonario con su vencimiento. Sin CAI vigente
   * o con numeraLaApp en false, caja tipea el número del talonario manual.
   */
  respaldo:       { codigoComprobante: string; prefijo: number; cai?: string; vencimiento?: string; numeraLaApp?: boolean }
  transportista:  { cuit: string }            // propio = mismo CUIT
  plantas:        Record<PlantaId, CotPlantaConfig>
  productos:      Record<string, CotProductoConfig>
}

export type CotDestino =
  | { tipo: 'planta'; plantaId: PlantaId }
  | { tipo: 'cliente'; clienteUid: string; codigoTango?: string; razonSocial: string; cuit: string; consumidorFinal: boolean; domicilio: CotDomicilio }

export interface CotSolicitud {
  destino:     CotDestino
  respaldo:    { codigoComprobante: string; prefijo: number; numero: number; importe: number }
  patente:     string
  recorrido:   CotRecorrido
  fechaSalida: string   // yyyy-MM-dd
  horaSalida:  string   // HH:MM
}

export type CotEstado = 'pendiente' | 'presentado' | 'error'

export interface CotResultado {
  estado:        CotEstado
  numero?:       string   // el COT
  numeroUnico?:  string
  archivo?:      string
  fechaValidez?: string   // yyyy-MM-dd
  error?:        string
  intentos?:     number
  presentadoEn?: Timestamp
  actualizadoEn?: Timestamp
}

// ── Expedición: venta por ventanilla (caja, en planta) ────────────────────────
// Terceros que compran en el mostrador de la planta: caja cobra (o anota en
// cta. cte. si es cliente registrado) y muelle entrega la mercadería contra el
// comprobante. Cliente registrado → su lista de precios; ocasional (sin
// registro) → la lista que elija caja.
export type VentaVentanillaEstado = 'pendiente_entrega' | 'entregado'

// Ciclo de vida del TURNO mientras la venta sigue pendiente de entrega
// (sistema de cola de ventanilla, ver plan): en_espera → preparado (la
// mercadería ya está juntada fuera de cámara) → llamado (muelle lo llama a
// una dársena; el TV lo canta y la página pública avisa) → se entrega
// (estado 'entregado') — o 'ausente' si no se presenta (sale de la cola
// activa sin bloquear la dársena; se lo puede re-llamar cuando aparece).
export type TurnoEstado = 'en_espera' | 'preparado' | 'llamado' | 'ausente'

export interface VentaVentanilla {
  id:                   string
  plantaId:             PlantaId
  canal:                CanalVenta   // mismo ruteo que el camión: contado=Redonhielo / promo=Rolito
  cajaId:               string
  cajaNombre:           string
  // Registrado (uid + datos Tango) O ocasional (solo nombre/cuit) — uno de los dos.
  clienteId?:           string
  clienteNombre:        string
  clienteCodigoTango?:  string
  clienteIdGva14Tango?: number
  clienteSucursalNombre?: string   // ver VentaCamion.clienteSucursalNombre
  ordenCompra?:         string     // ver VentaCamion.ordenCompra
  reemiteDe?:           string     // ver VentaCamion.reemiteDe
  envioMail?:           EnvioMailVenta
  // Ocasional: consumidor final. CUIT o DNI si los tiene; sin ninguno, la
  // factura sale "sin identificar" hasta el tope de config/arca.
  clienteOcasional?:    { nombre: string; cuit?: string; dni?: string }
  items:                VentaCamionItem[]   // misma shape que la venta del camión
  total:                number
  formaPago:            FormaPago   // cuenta_corriente solo para registrados
  estado:               VentaVentanillaEstado
  // Sistema de turnos: correlativo del DÍA por planta (T-7), impreso grande
  // en el comprobante junto con un QR que abre /turnos/{planta}?turno=N.
  turno:                number
  turnoEstado:          TurnoEstado
  darsena?:             number      // asignada al llamar (dársenas de ventanilla)
  llamadoAt?:           Timestamp   // último llamado (el TV lo canta ~30s)
  entregadoPor?:        { uid: string; nombre: string; hora: Timestamp }   // muelle
  salida?:              { uid: string; nombre: string; hora: Timestamp }   // seguridad en el portón (Fase 4)
  fecha:                Timestamp
  tango?:               RemitoTangoEstado
  // Espejo de la factura electrónica (contado efectivo/transferencia), que
  // escribe onVentaVentanillaContadoFacturar — mismo circuito que el camión.
  factura?:             FacturaArcaVenta
  // Factura X de promo (Rolito, 2026-09-08) o remito de cuenta corriente
  // (Redonhielo, 2026-09-09), numerados en la misma transacción de la venta
  // desde config/numeracionInterna_{facturaX|remito}. Sin número Tango no
  // tiene qué registrar. Ausente en las ventas anteriores y en las de contado.
  comprobanteInterno?:  ComprobanteInternoVenta
  // Anulación de la factura con nota de crédito (2026-09-09). Lo escribe el
  // server (triggers de anulacionesVentanilla): 'pendiente' mientras espera
  // autorización, 'aprobada' mientras se emite la NC, 'anulada' con la NC
  // emitida (la venta deja de contar en Mi día / cierre de caja / tesorería),
  // 'rechazada' o 'error' (ARCA rechazó la NC) → la venta sigue contando.
  anulacion?:           AnulacionEnVenta
}

// ── Anulación de facturas de ventanilla con nota de crédito (2026-09-09) ─────
// El cajero pide (anulacionesVentanilla/{ventaId}, id = venta → una por
// venta), un usuario con `users.autorizaAnulaciones` aprueba o rechaza, y el
// server emite la NC en ARCA (misma clase e importes que la factura) y la
// refleja en la venta. Solo anulación TOTAL, solo mientras la caja del cajero
// no esté cerrada.
export type EstadoAnulacion = 'pendiente' | 'aprobada' | 'rechazada' | 'emitida' | 'error'
export type EstadoAnulacionEnVenta = 'pendiente' | 'aprobada' | 'anulada' | 'rechazada' | 'error'

export type MotivoAnulacion =
  | 'cliente_equivocado' | 'articulos_equivocados' | 'forma_pago_equivocada' | 'importe_equivocado' | 'cliente_desistio' | 'otro'
export const MOTIVOS_ANULACION: Record<MotivoAnulacion, string> = {
  cliente_equivocado:    'Cliente equivocado',
  articulos_equivocados: 'Artículos o cantidades equivocados',
  forma_pago_equivocada: 'Forma de pago equivocada',
  importe_equivocado:    'Importe o precio equivocado',
  cliente_desistio:      'El cliente desistió de la compra',
  otro:                  'Otro',
}

/** La nota de crédito emitida por ARCA, con la misma forma que la factura más el comprobante asociado. */
export interface NotaCreditoArcaVenta extends FacturaArcaVenta {
  cbtesAsoc: { Tipo: number; PtoVta: number; Nro: number; Cuit?: string; CbteFch?: string }[]
}

/** Nota de crédito INTERNA de una promo anulada (2026-09-11): número propio, sin ARCA. */
export interface NotaCreditoInternaVenta { tipo: 'notaCreditoX'; puntoVenta: number; numero: number; fecha: string }

export interface AnulacionEnVenta {
  estado:       EstadoAnulacionEnVenta
  solicitudId:  string
  notaCredito?: NotaCreditoArcaVenta
  notaCreditoInterna?: NotaCreditoInternaVenta
  /**
   * Remito de cuenta corriente anulado por el propio chofer, sin autorización
   * (2026-09-11, decisión de Ariel): la app lo saca de la liquidación y la
   * oficina lo anula en Tango; `tango.estado` pasa a 'confirmado' cuando el
   * lector de comprobantes ve el remito anulado (ESTADO_MOV 'A').
   */
  tipo?:        'remito'
  motivo?:      MotivoAnulacion
  nota?:        string
  anuladaPor?:  { uid: string; nombre: string }
  anuladaEn?:   Timestamp
  fechaVenta?:  string   // yyyy-MM-dd (las reglas cotejan que la liquidación de ese día no esté cerrada)
  tango?:       { estado: 'pendiente_oficina' | 'confirmado'; en?: Timestamp }
}

export interface AnulacionVentanilla {
  id:            string          // = ventaId
  ventaId:       string
  /** Ventanilla, o factura del camión pedida por caja desde la liquidación abierta (2026-09-11). */
  coleccion:     'ventasVentanilla' | 'ventasCamion'
  plantaId:      PlantaId
  /** Quien pide: el cajero de la venta (ventanilla) o el cajero que liquida (camión). */
  cajaId:        string
  cajaNombre:    string
  /** Solo camión: el chofer de la venta (las reglas lo cotejan y la bandeja lo muestra). */
  choferId?:     string
  choferNombre?: string
  clienteNombre: string
  fechaVenta:    string          // yyyy-MM-dd
  facturaOriginal: { cbteTipo: number; puntoVenta: number; numero: number; cae: string | null; total: number }
  // Snapshot de la venta para la bandeja (sin releer la venta).
  items:         { nombre: string; cantidad: number; precioUnitario: number }[]
  total:         number
  formaPago:     FormaPago
  motivo:        MotivoAnulacion
  nota:          string
  estado:        EstadoAnulacion
  solicitadoPor: { uid: string; nombre: string }
  solicitadaEn:  Timestamp
  resueltaPor:   { uid: string; nombre: string } | null
  resueltaEn?:   Timestamp
  notaResolucion?: string
  notaCredito?:  NotaCreditoArcaVenta
  /** Promo: NC interna numerada por la app (sin ARCA), 2026-09-11. */
  notaCreditoInterna?: NotaCreditoInternaVenta
  ultimoError?:  string | null
  // La NC en Tango (Facturador, tipo CDE): lo escribe el worker del outbox.
  tango?:        { estado: 'pendiente' | 'confirmado' | 'error'; numero?: string; ultimoError?: string }
}

// ── Expedición: cobranza (mostrador, calle o supervisor) ──────────────────────
// Plata que entra por fuera de una venta del momento: clientes de cta. cte.
// que pagan deudas. Tres puntos de captura, misma entidad: caja en ventanilla
// (origen 'caja'), cobradores en la calle (origen 'cobrador') y supervisores
// (origen 'supervisor': flujo completo con imputación de facturas de Tango,
// recibo multi-medio con cheques y retenciones — los campos extra son
// opcionales para no tocar las cobranzas simples). Inmutable.

// Imputación: contra qué factura de la composición de saldos va la plata.
// Parcial permitido (importeImputado <= saldoAlMomento).
export interface ImputacionFactura {
  comprobanteTipo:    string
  comprobanteNumero:  string
  idComprobanteTango?: number
  saldoAlMomento:     number   // snapshot del saldo pendiente al cobrar
  importeImputado:    number
}

// Cheque recibido ("valores a depositar").
export interface ChequeRecibido {
  numero:            string
  bancoCodigo:       string   // código BCRA — ver src/constants/bancos.ts
  bancoNombre:       string   // snapshot
  fechaEmision:      string   // yyyy-MM-dd
  fechaAcreditacion: string   // yyyy-MM-dd (>= emisión)
  dias:              number   // días entre emisión y acreditación (derivado, snapshoteado)
  importe:           number
  esEcheq?:          boolean
}

export type TipoRetencion = 'ganancias' | 'iva' | 'iibb_caba' | 'iibb_pba' | 'suss'

export interface RetencionRecibida {
  tipo:           TipoRetencion
  nroCertificado: string
  importe:        number
  fecha?:         string   // yyyy-MM-dd
}

// Desglose multi-medio del recibo de supervisor: Σ(medios) == Σ(imputaciones)
// == importe total (validado en cliente, en centavos).
export interface MediosPago {
  efectivo:      number
  transferencia: number
  cheques:       ChequeRecibido[]
  retenciones:   RetencionRecibida[]
  /** Saldo a favor del cliente (recibos a cuenta ya en Tango) que se aplica a las facturas de este
   *  recibo, sin plata nueva (2026-09-08, etapa 2 del pago a cuenta). En Tango es una imputación. */
  aCuentaAplicado?: AplicacionACuenta[]
}
export interface AplicacionACuenta {
  reciboNumero:    string   // nº del recibo en Tango ('X0000100032835')
  idReciboTango?:  number   // ID_GVA12 del recibo
  importe:         number
}

export interface Cobranza {
  id:            string
  origen:        'caja' | 'cobrador' | 'supervisor'
  plantaId?:     PlantaId   // solo origen 'caja'
  registradoPor: { uid: string; nombre: string }
  depositoTango?: string    // depósito de Tango de quien cobra (para su liquidación)
  clienteId:     string
  clienteNombre: string
  importe:       number     // total; en origen 'supervisor' admite 2 decimales
  formaPago:     'contado_efectivo' | 'contado_transferencia' | 'mixto'   // 'mixto' solo supervisor
  referencia?:   string   // n° de factura/recibo que se está pagando (texto libre)
  fecha:         Timestamp
  // ── Solo origen 'supervisor' ──
  numeroRecibo?: string             // 'RS-000123' (interno; el fiscal lo asigna Tango)
  empresa?:      EmpresaTango
  codigoTango?:  string             // código de cliente en esa empresa al que se imputa (varios códigos por CUIT)
  imputaciones?: ImputacionFactura[]
  medios?:       MediosPago
  /** Parte de los valores que NO se imputó a ninguna factura: queda a cuenta (saldo a favor)
   *  del cliente en Tango (2026-09-08). `importe` = Σ imputado + aCuenta = Σ valores recibidos. */
  aCuenta?:      number
  tango?:        RemitoTangoEstado  // write-back del recibo en Tango (Fase 4)
}

// ── Cobranzas de supervisor: composición de saldos de Tango ───────────────────
// Cache en Firestore de la cuenta corriente del cliente en Tango (facturas
// pendientes con su saldo restante, incluidas las cobradas parcialmente). Lo
// escribe SOLO el Admin SDK: el sync periódico del bridge (origen 'sync') o la
// respuesta a un refresh on-demand (origen 'consulta', cola tango-consultas).
// Empresa de Tango a la que pertenece la deuda (header Company del API).
export type EmpresaTango = 'redonhielo' | 'rolito'

export interface ComprobanteSaldoTango {
  tipo:               string   // 'FAC' | 'ND' | 'NC' | … (tal como venga de Tango)
  numero:             string   // ej. 'A0010100173697'
  fechaEmision:       string   // 'yyyy-MM-dd' — puede venir vacía (las Live de deudas no la traen)
  fechaVencimiento?:  string
  importeOriginal:    number   // hasta 2 decimales
  saldoPendiente:     number   // saldo restante (facturas parciales incluidas)
  idComprobanteTango?: number  // ID_GVA12 — ID interno del comprobante, para imputar en el recibo
  diasAtraso?:        number   // días vencida (solo deudas vencidas)
  // Empresa y código de cliente de Tango a los que pertenece la factura
  // (2026-09-06: el doc trae las DOS empresas; un recibo imputa facturas de UNA
  // sola empresa y UN solo código). Los docs anteriores no los traen → Redonhielo.
  empresa?:           EmpresaTango
  codigoTango?:       string
}

// Identidad del cliente en una empresa de Tango (ver utils/tangoEmpresas.ts).
export interface TangoIdEmpresa {
  idGva14: number
  codigo:  string
}

export interface SaldoTangoRama {
  saldoTotal:     number
  comprobantes:   number
  runId:          string | null
  origen:         'sync' | 'consulta'
  actualizadoEn?: Timestamp
}

export interface SaldoTango {
  id:            string   // == uid del cliente en la app
  idGva14:       number   // principal de Redonhielo (legacy)
  codigoTango:   string   // principal de Redonhielo (legacy)
  empresa:       EmpresaTango   // legacy, siempre 'redonhielo'
  razonSocial:   string   // snapshot para listar sin join
  comprobantes:  ComprobanteSaldoTango[]   // unión de las dos empresas
  saldoTotal:    number   // Σ saldoPendiente de las dos empresas
  porEmpresa?:   Partial<Record<EmpresaTango, SaldoTangoRama>>
  actualizadoEn: Timestamp
  origen:        'sync' | 'consulta'
}

// Consulta on-demand a Tango (cola inversa tango-consultas): la pantalla de
// cobro pide el saldo fresco de UN cliente, el bridge la responde en segundos
// escribiendo `resultado` en el mismo doc, y onConsultaRespondida lo copia al
// cache saldosTango. Si el bridge está caído, la UI cae al cache por timeout.
export interface TangoConsulta {
  id:            string
  /** 'sincronizarComprobantes' (2026-09-10): el bridge corre el lector de facturas/remitos para `codigos`. */
  tipo:          'saldoCliente' | 'sincronizarComprobantes'
  clienteUid:    string
  idGva14:       number
  idsGva14?:     number[]   // todos los códigos del cliente en esa empresa
  codigos?:      string[]   // sincronizarComprobantes: códigos de Tango del cliente en esa empresa
  empresa:       EmpresaTango
  solicitadoPor: { uid: string; nombre: string }
  estado:        'pendiente' | 'respondida' | 'error'
  resultado?:    { comprobantes: ComprobanteSaldoTango[]; saldoTotal: number }
  ultimoError?:  string | null
  creadoEn:      Timestamp
  actualizadoEn?: Timestamp
}

// ── Índice liviano de clientes para buscar (2026-09-10) ───────────────────────
// clientesIndex/{uid}: solo lo que hace falta para buscar y listar. Lo mantiene
// el trigger onClienteIndexado a partir de users; la ficha completa (precios,
// condición de venta, domicilios) se pide por id al elegir el cliente. Espejo de
// functions/src/services/clientesIndex.ts.
export interface ClienteIndex {
  uid:            string
  razonSocial:    string
  nombreContacto: string
  cuit:           string
  sinCuit?:       boolean
  codigoCliente?: string
  /** Códigos de Tango de la cuenta en las dos empresas, sin repetir. */
  codigos:        string[]
  /** Nombres de las sucursales (para buscar "MONROE"). */
  sucursales:     string[]
  direccion:      string
  localidad:      string
  estado:         string
  vinculadoTango: boolean
  /** Empresas donde Tango lo tiene inhabilitado (ausente = habilitado en todas). */
  inhabilitadoEn?: EmpresaTango[]
  actualizadoEn?: Timestamp
}

// ── Comprobantes de Tango: facturas y remitos de los últimos 13 meses ─────────
// (2026-09-09) Los publica el lector de la VM (scripts/tango/bridge-sync-
// comprobantes.mjs) leyendo SQL Server: un índice liviano por código de cliente
// (tangoComprobantes/{empresa}_{codigo}) y un detalle por comprobante para
// regenerar el PDF en la app (tangoComprobanteDetalle/{empresa}_{tipo}_{numero}).
// La composición de saldos los usa para "ver todas", el remito de cada factura
// y los remitos pendientes de facturar. Ver docs/tango/INTEGRACION.md §35.

export interface FacturaTangoResumen {
  tipo:      string      // 'FAC' | 'NC' | 'ND'
  numero:    string      // 'A0010100282787'
  fecha:     string      // yyyy-MM-dd (emisión)
  importe:   number
  estado:    string      // GVA12.ESTADO: 'PEN' (pendiente) | 'CAN' (cancelada) | 'ANU' (anulada) …
  idGva12?:  number
  remitos?:  string[]    // números de remito que absorbió ('R0000100482053')
  h:         string      // huella de cambios (uso interno del lector)
}

export interface RemitoTangoResumen {
  fecha:      string      // yyyy-MM-dd
  estado:     string      // STA14.ESTADO_MOV: 'P' pendiente de facturar | 'F' facturado | 'A' anulado
  bultos:     number
  idSta14?:   number
  facturas?:  string[]    // números de factura que lo absorbieron
  h:          string
}

export interface TangoComprobantesDoc {
  id:             string          // '{empresa}_{codigo}'
  empresa:        EmpresaTango
  codigo:         string          // código del cliente en Tango (sucursal)
  razonSocial?:   string
  email?:         string          // E_MAIL de la ficha de Tango (para enviarle comprobantes)
  desde?:         string          // yyyy-MM-dd de la última ventana leída
  actualizadoEn?: Timestamp
  facturas:       Record<string, FacturaTangoResumen>   // clave '{tipo}_{numero}'
  remitos:        Record<string, RemitoTangoResumen>    // clave = número
}

export interface ClienteTangoImpreso {
  codigo:         string
  razonSocial:    string
  cuit:           string
  domicilio:      string
  localidad:      string
  cp:             string
  provincia:      string
  condicionIva:   string
  condicionVenta: string
  vendedor:       string
}

export interface FacturaTangoDetalle {
  empresa:        EmpresaTango
  tipo:           string          // 'FAC' | 'NC' | 'ND'
  numero:         string
  codigo:         string
  fecha:          string
  letra:          string          // 'A' | 'B' | 'C' | …
  puntoVenta:     number
  nro:            number
  cbteTipo:       number | null   // código ARCA (1 = Factura A, …)
  estado:         string
  fechaAnulacion?: string
  cliente:        ClienteTangoImpreso
  renglones:      { codigo: string; descripcion: string; cantidad: number; precioUnitario: number; dtoPct: number; ivaPct: number; importe: number }[]
  totales:        { gravado: number; exento: number; iva: number; ivaAlic: number; internos: number; otros: number; total: number }
  cae:            string          // '' si no es electrónica
  caeVto:         string          // yyyy-MM-dd
  remitos:        string[]
  actualizadoEn?: Timestamp
}

export interface RemitoTangoDetalle {
  empresa:        EmpresaTango
  tipo:           'REM'
  numero:         string          // 'R0000100482053'
  codigo:         string
  fecha:          string
  estado:         string          // 'P' | 'F' | 'A'
  fechaAnulacion?: string
  cliente:        ClienteTangoImpreso
  renglones:      { codigo: string; descripcion: string; cantidad: number }[]
  bultos:         number
  talonario:      { numero: number; cai?: string; vencimiento?: string; descripcion?: string }
  usuario:        string          // usuario de Tango que lo cargó
  facturas:       string[]
  actualizadoEn?: Timestamp
}

// ── Expedición: cambio de producto defectuoso (en la calle) ───────────────────
// El cliente le entrega al chofer una bolsa defectuosa/rota y el chofer se la
// cambia por una nueva: baja una unidad buena del stock del camión SIN generar
// venta ni plata. La bolsa rota vuelve físicamente y muelle la cuenta en la
// descarga — en la liquidación los cambios deben cuadrar con las rotas
// recibidas. Inmutable (comprobante de un hecho ya ocurrido).
export interface CambioCamion {
  id:            string
  camionId:      string
  choferId:      string
  choferNombre:  string
  clienteId:     string
  clienteNombre: string
  productoId:    string
  nombre:        string   // nombre del producto (snapshot)
  cantidad:      number
  fecha:         Timestamp
}

// ── Expedición: descarga del camión (retorno contado por muelle) ─────────────
// Cuando el camión vuelve, muelle cuenta FÍSICAMENTE lo que bajó: mercadería
// sin vender, bolsas rotas de los cambios, y los envases (cada pallet = 1 base
// de metal + 4 puntales; vuelven completos con hielo, parciales o vacíos).
// Una descarga por retorno de camión — si hay dos vueltas, dos descargas; la
// liquidación del día agrega todas las del chofer. Inmutable.
export interface DescargaCamionItem {
  productoId: string
  nombre:     string
  cantidad:   number
}

export interface DescargaCamion {
  id:               string
  plantaId:         PlantaId
  camionId:         string
  camionLabel:      string
  choferId:         string   // identidad del depósito (uid o 'dep:<código>')
  choferNombre:     string
  depositoTango?:       string
  depositoTangoNombre?: string
  items:            DescargaCamionItem[]   // mercadería sana que volvió
  bolsasRotas:      DescargaCamionItem[]   // rotas recibidas (contra los cambios)
  // Envases que volvieron, contados sueltos por muelle (desde 2026-09-07).
  envases?:         EnvasesDescarga
  // LEGACY (descargas anteriores al 2026-09-07): pallets completos (con hielo),
  // parciales y vacíos. Solo lectura — utils/envases.ts los traduce a envases.
  palletsCompletos?: number
  palletsParciales?: number
  palletsVacios?:    number
  registradoPor:    { uid: string; nombre: string }
  fecha:            Timestamp
  // Transferencia camión → planta en Tango (mismo mecanismo que el remito de
  // carga: onDescargaCamionCreada la encola; el write-back la confirma).
  tango?:           RemitoTangoEstado
}

// ── Expedición: liquidación del repartidor ────────────────────────────────────
// Cierre del día por persona (repartidor; a futuro también cobrador). El doc se
// crea recién AL CERRAR — hasta entonces la pantalla de caja calcula todo en
// vivo desde las fuentes (remitosCarga + ventasCamion + cambiosCamion +
// descargasCamion). Snapshot inmutable, calcado de la hoja "Liquidación de
// repartidores" del sistema viejo. ID determinístico: {yyyy-MM-dd}_{choferId}.
export interface LiquidacionResumenProducto {
  productoId:        string
  nombre:            string
  carga:             number   // total cargado (remitos del día)
  ventaContado:      number   // unidades vendidas canal contado
  ventaPromo:        number   // unidades vendidas canal promo
  cambios:           number   // unidades entregadas por cambio (sin venta)
  devolucionTeorica: number   // carga − ventas − cambios
  descarga:          number   // contado físico por muelle
  diferencia:        number   // descarga − devolucionTeorica (0 = cuadra)
}

export interface Liquidacion {
  id:            string     // {yyyy-MM-dd}_{choferId}
  // Correlativo POR PERSONA (serie del depósito de Tango, 2026-09-09):
  // config/liquidacionCounter_{clave} → "LQ-21-000015". Los cierres anteriores no lo tienen.
  numero?:       number
  codigo?:       string
  fecha:         string     // yyyy-MM-dd (día liquidado)
  plantaId:      PlantaId
  choferId:      string     // identidad del depósito (uid o 'dep:<código>')
  choferNombre:  string
  depositoTango?:       string
  depositoTangoNombre?: string
  productos:     LiquidacionResumenProducto[]
  // Cuadre de envases por tipo (tarimas, pallets de metal, puntales, aros y
  // racks por número) — los cierres desde el 2026-09-07 lo escriben.
  envases?:      LiquidacionEnvases
  // LEGACY (cierres anteriores): salieron (Σ palletsCarga) vs volvieron.
  pallets?: {
    salidos:    number
    completos:  number
    parciales:  number
    vacios:     number
    diferencia: number   // (completos+parciales+vacios) − salidos
  }
  // Bolsas rotas recibidas por muelle vs cambios registrados por el chofer.
  cambios: { registrados: number; rotasRecibidas: number }
  // Plata: totales por forma de pago (de ventasCamion del día).
  importes: {
    contadoEfectivo:      number
    contadoTransferencia: number
    cuentaCorriente:      number
    total:                number
  }
  // Cobranzas de cta. cte. hechas en la calle por esta persona (los
  // cobradores son choferes en la app — ver Fase 5). Ausente en
  // liquidaciones cerradas antes de esta fase.
  cobranzasCalle?: {
    cantidad:      number
    efectivo:      number
    transferencia: number
    total:         number
    // Valores en papel (desde 2026-09-09): se rinden aparte del efectivo.
    cheques?:      { cantidad: number; total: number }
    retenciones?:  { cantidad: number; total: number }
  }
  efectivoARendir:  number   // = ventas en efectivo + cobranzas en efectivo
  efectivoRecibido: number   // lo que caja contó al recibir la plata
  diferenciaEfectivo: number // recibido − a rendir
  // ── Cierre con control (2026-09-06) ──
  // Motivo obligatorio cuando hay diferencia de efectivo, con nota libre.
  diferencia?:   { motivo: MotivoDiferenciaLiquidacion; nota: string }
  // Conformidad del repartidor: firma en la pantalla de caja (dataURL PNG).
  firmaRepartidor?:    string
  firmanteRepartidor?: string
  // Firma de quien RECIBE la rendición (el cajero = cerradaPor), 2026-09-09:
  // así el repartidor tiene constancia de que le recibieron.
  firmaRecibe?:        string
  firmanteRecibe?:     string
  // Cheques y certificados de retención de sus cobranzas, tildados por caja
  // al recibirlos (recibido / no entregado + motivo). `valoresFaltantes` es el
  // resumen de los no entregados, para historial y tesorería.
  cheques?:            ChequeRendido[]
  retenciones?:        RetencionRendida[]
  valoresFaltantes?:   { cantidad: number; total: number }
  // Entrega a tesorería que la incluye (null = todavía en caja). Los cierres
  // anteriores no lo tienen y no son candidatos a entrega.
  entregaId?:          string | null
  // Caja marcó que el repartidor confirmó no tener movimientos sin subir en el teléfono.
  confirmoSinPendientes?: boolean
  // Qué documentos componen este cierre (para reconstruir el detalle al reimprimir).
  remitosCargaIds?:  string[]
  ventasIds?:        string[]
  descargasIds?:     string[]
  cobranzasIds?:     string[]
  cantidadVentas?:    number
  cantidadCobranzas?: number
  clientesVisitados?: number
  cerradaPor:    { uid: string; nombre: string }
  createdAt:     Timestamp
}

export type MotivoDiferenciaLiquidacion = 'faltante_repartidor' | 'faltante_caja' | 'faltante_entrega' | 'vuelto_mal_dado' | 'error_de_carga' | 'otro'
// Labels de todos los motivos (sirven para mostrar cualquier cierre); qué
// motivos se OFRECEN en cada cierre lo dicen las listas de abajo.
export const MOTIVOS_DIFERENCIA_LIQUIDACION: Record<MotivoDiferenciaLiquidacion, string> = {
  faltante_repartidor: 'Faltante del repartidor',
  faltante_caja:       'Faltante de caja',
  faltante_entrega:    'Faltante en la entrega a tesorería',
  vuelto_mal_dado:     'Vuelto mal dado',
  error_de_carga:      'Error de carga en la app',
  otro:                'Otro',
}
export const MOTIVOS_LIQUIDACION_REPARTIDOR: MotivoDiferenciaLiquidacion[] = ['faltante_repartidor', 'vuelto_mal_dado', 'error_de_carga', 'otro']
// Cierre de caja de ventanilla (2026-09-09).
export const MOTIVOS_CIERRE_MOSTRADOR: MotivoDiferenciaLiquidacion[] = ['faltante_caja', 'vuelto_mal_dado', 'error_de_carga', 'otro']
// Entrega de caja a tesorería (2026-09-09): caja entrega distinto del teórico, o tesorería cuenta distinto de lo entregado.
export const MOTIVOS_ENTREGA_TESORERIA: MotivoDiferenciaLiquidacion[] = ['faltante_entrega', 'faltante_caja', 'error_de_carga', 'otro']

// ── Expedición: rendiciones (cierre de caja por persona y día, 2026-09-09) ────
// Una sola colección `rendiciones` para los tres sujetos que manejan plata
// (plan de rendiciones 2026-09-08): repartidor (mismo id que su liquidación),
// cobrador/supervisor y mostrador. Hoy existe el tipo 'mostrador': el cierre
// de caja de UN usuario de ventanilla en un día. Inmutable, id determinístico
// `{fecha}_{sujetoId}`; solo cambian `validacion` (tesorería) y `entregaId`
// (entrega a tesorería, fase siguiente).
export type TipoRendicion = 'repartidor' | 'cobrador' | 'mostrador'

// Valor en papel (cheque / certificado de retención) dentro de una rendición,
// liquidación o entrega: de qué recibo salió y si quien recibe lo tildó.
// `recibido` ausente (docs anteriores al 2026-09-09) = recibido.
export interface ChequeRendido extends ChequeRecibido { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; recibido?: boolean; motivoNoEntregado?: string }
export interface RetencionRendida extends RetencionRecibida { cobranzaId: string; numeroRecibo?: string; clienteNombre: string; recibido?: boolean; motivoNoEntregado?: string }

export interface Rendicion {
  id:            string            // {yyyy-MM-dd}_{sujetoId}
  numero:        number            // correlativo por planta (config/rendicionCounter_{plantaId})
  codigo:        string            // "RD-DT-000012"
  tipo:          TipoRendicion
  fecha:         string            // yyyy-MM-dd (día rendido)
  plantaId:      PlantaId
  sujetoId:      string            // mostrador: uid del cajero
  sujetoNombre:  string
  // Teórico (snapshot del cálculo de utils/rendicionMostrador al cerrar)
  ventas: {
    cantidad: number
    contadoEfectivo: number; contadoTransferencia: number; cuentaCorriente: number
    promoEfectivo: number; promoTransferencia: number; promoCuentaCorriente: number
    total: number
  }
  cobranzas: {
    cantidad: number; efectivo: number; transferencia: number
    cheques: { cantidad: number; total: number }; retenciones: { cantidad: number; total: number }
    total: number
  }
  // Liquidaciones de repartidores que este cajero cerró en el día: el efectivo
  // recibido entró a su caja y se rinde con lo demás.
  recibido: { liquidaciones: { id: string; choferId: string; choferNombre: string; efectivoARendir: number; efectivoRecibido: number; diferenciaEfectivo: number }[]; efectivo: number }
  bultos:        { productoId: string; nombre: string; cantidad: number }[]
  cheques:       ChequeRendido[]
  retenciones:   RetencionRendida[]
  efectivoARendir:    number
  // Real
  efectivoContado:    number
  diferenciaEfectivo: number      // contado − a rendir
  diferencia?:   { motivo: MotivoDiferenciaLiquidacion; nota: string }
  firma:         string            // dataURL PNG de quien rinde
  firmante:      string
  confirmoSinPendientes?: boolean
  // Referencias para reconstruir el detalle
  ventasIds:         string[]
  cobranzasIds:      string[]
  liquidacionesIds:  string[]
  cantidadVentas:    number
  cantidadCobranzas: number
  desde:         Timestamp         // ventana cubierta (00:00 del día)
  hasta:         Timestamp         // momento del cierre
  cerradaPor:    { uid: string; nombre: string }
  createdAt:     Timestamp
  // Tesorería la revisó (único campo que tesorería escribe).
  validacion:    { uid: string; nombre: string; fecha: Timestamp; nota?: string } | null
  // Entrega a tesorería que la incluye (fase siguiente del plan de rendiciones).
  entregaId:     string | null
}

// ── Entrega de caja a tesorería (2026-09-09) ────────────────────────────────
// Caja junta el efectivo y los valores del día (liquidaciones de repartidores
// que recibió + sus cierres de caja), firma y los manda; tesorería cuenta,
// tilda cada valor y firma. Doble firma, acta PDF. Lógica pura en
// utils/entregaTesoreria.ts (dedupe: el cierre de caja ya incluye el efectivo
// de las liquidaciones que ese cajero cerró).
export type EstadoEntregaTesoreria = 'entregada' | 'confirmada'

export interface EntregaTesoreria {
  id:        string                  // {fecha}_{plantaId}_{numero}
  numero:    number                  // correlativo por planta (config/entregaCounter_{plantaId})
  codigo:    string                  // "ET-DT-000045"
  fecha:     string                  // yyyy-MM-dd (día de la entrega)
  plantaId:  PlantaId
  estado:    EstadoEntregaTesoreria
  destino:   'tesoreria'
  liquidacionIds: string[]
  rendicionIds:   string[]
  // Snapshots de lo incluido (para el acta y el historial sin releer)
  liquidaciones: { id: string; codigo: string | null; fecha: string; choferId: string; choferNombre: string; efectivoRecibido: number; incluidaEnCierre: boolean }[]
  rendiciones:   { id: string; codigo: string; fecha: string; sujetoId: string; sujetoNombre: string; efectivoContado: number }[]
  efectivo: { cierresCaja: number; liquidacionesSueltas: number; teorico: number }
  efectivoEntregado: number          // lo que caja dice que manda
  diferenciaEntrega?: { motivo: MotivoDiferenciaLiquidacion; nota: string }   // si entrega distinto del teórico
  // Valores en papel que viajan. Nacen SIN `recibido` (tesorería todavía no los
  // contó); al confirmar, cada uno queda con recibido true/false + motivo.
  cheques:     ChequeRendido[]
  retenciones: RetencionRendida[]
  entregadoPor:    { uid: string; nombre: string }
  firmaEntrega:    string            // dataURL PNG de quien entrega (caja)
  firmanteEntrega: string
  createdAt:       Timestamp
  // Confirmación de tesorería
  recibidoPor:        { uid: string; nombre: string } | null
  firmaRecibe?:       string
  firmanteRecibe?:    string
  efectivoContado?:   number
  diferenciaEfectivo?: number        // contado − entregado
  diferencia?:        { motivo: MotivoDiferenciaLiquidacion; nota: string }
  valoresFaltantes?:  { cantidad: number; total: number }
  confirmadaEn?:      Timestamp
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
  // Ficha de Tango del código de esta sucursal (addresses[].id = COD_GVA14,
  // 2026-09-10). Los escribe SOLO la sync de clientes (functions/triggers/
  // tangoSync.ts) sin tocar el resto de la entrada (address, lat/lng, horarios
  // y contacto los corrige logística). Son lo que imprimen el remito y la
  // factura de la app cuando la venta fue a esa sucursal (utils/clienteImpreso.ts).
  domicilioTango?:       string
  localidadTango?:       string
  provinciaTango?:       string
  codigoPostalTango?:    string
  razonSocialTango?:     string
  /** NOM_COM de Tango: el nombre propio de la sucursal ("YPF RUTA 8 KM 40"). */
  nombreComercialTango?: string
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
  /**
   * Lista de precios que el cliente tiene asignada en TANGO, por empresa
   * (nro de lista GVA10). La escribe la sync diaria de precios
   * (functions/src/services/tango/precios.ts); el precio de cada producto sale
   * de preciosTango/{empresa}. Tango es la fuente maestra (2026-09-03).
   */
  listaTango?: { redonhielo?: number; rolito?: number }
  listaTangoNombre?: { redonhielo?: string; rolito?: string }
  // Precios ya resueltos por la sync (especial del cliente > su lista; sin 0):
  // lo que el cliente ve en su perfil y en el pedido. { empresa: { productoId: precio } }
  preciosTango?: { redonhielo?: Record<string, number>; rolito?: Record<string, number> }
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
  codigoCliente?:     string
  codigoTango?:       string   // COD_GVA14 de Tango (cruzado por CUIT, ver scripts/tango/) — numeración distinta de codigoCliente
  idGva14Tango?:      number   // ID_GVA14 de Tango — para GetById/Update/Delete contra la API de Plataforma
  // Identidad por empresa (2026-09-06): un CUIT = una cuenta; en cada empresa
  // puede tener varios códigos (el primero es el principal). codigoTango /
  // idGva14Tango quedan como alias del principal de Redonhielo.
  tangoIds?:          { redonhielo?: TangoIdEmpresa[]; rolito?: TangoIdEmpresa[] }
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
  subrol?:            'chofer' | 'ayudante' | 'maquinista'   // 'maquinista' aplica a rol 'produccion_hielo': parte de máquinas en vez de carga de pallets
  area?:              AreaHeladera   // sector de heladeras (rol 'heladeras')
  planta?:            PlantaId   // planta fija del usuario (roles 'produccion_hielo', 'caja', 'muelle' y 'seguridad')
  legajo?:            string   // login del operario de producción (rol 'produccion_hielo'), junto con un PIN individual — ver produccionAuthService.ts
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
  // Roles ADICIONALES al principal (solo caja / muelle / seguridad), para
  // quien cubre el mostrador además de su puesto — ver src/utils/roles.ts.
  // Van con `planta`. Solo los asigna el super_admin.
  rolesExtra?: UserRole[]
  // Puede aprobar o rechazar las anulaciones de facturas de ventanilla (nota
  // de crédito), sea cual sea su rol. Solo lo asigna el super_admin (2026-09-09).
  autorizaAnulaciones?: boolean
  // Cliente de Tango SIN CUIT (consumidor final del mostrador / promo), creado
  // por el padrón automático sin usuario de Auth ni cuitIndex: no puede entrar
  // a la app y solo se le vende en promo (Rolito). El contado (factura ARCA)
  // queda bloqueado por `esClienteFacturable` hasta que le carguen el CUIT en
  // Tango; ahí la sync lo convierte en cuenta normal. Decisión de Ariel 2026-09-07.
  sinCuit?: boolean
  // Habilitado en cada empresa de Tango (lo escribe la sync diaria, 2026-09-11).
  // Inhabilitado en las dos → la sync lo da de baja; inhabilitado en UNA → sigue
  // activo pero la app no le vende en esa empresa (contado/cta. cte. = Redonhielo,
  // promo = Rolito). Ver utils/inhabilitadoTango.ts. Ausente = habilitado.
  habilitadoTango?: Partial<Record<EmpresaTango, boolean>>
  // Percepción de IIBB CABA (padrón de AGIP, lo carga functions/triggers/padronIIBB):
  // alícuota y mes de vigencia. La factura la aplica el server; la pantalla de
  // venta la muestra en el total con IVA (utils/totalFacturado.ts).
  percepcionIIBB?: { alicuota?: number; vigenciaDesde?: string | Timestamp; vigenciaHasta?: string | Timestamp } | null
  // Fecha del último pedido del cliente, que mantiene el trigger onOrderRollup
  // (monotónico). Sirve para detectar clientes "fríos" sin recorrer todos los
  // pedidos — ver auditoría H5.
  ultimoPedidoAt?: Timestamp
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
  // Visita pedida por un supervisor desde la calle (2026-09-07): sin chofer,
  // logística le pone día y camión desde Visitas.
  origenSupervisor?: { uid: string; nombre: string }
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

// Dársenas de carga del muelle por planta (dato de Ariel 2026-08-29: hoy hay
// 5 en Torcuato). Si cambia la infraestructura, se ajusta acá.
export const DARSENAS_POR_PLANTA: Record<PlantaId, number> = {
  torcuato: 5,
  merlo:    5,
}

// Dársenas reservadas a clientes de ventanilla (alta temporada): las demás
// son de los camiones propios, que siempre tienen prioridad en las suyas.
export const DARSENAS_VENTANILLA: Record<PlantaId, number[]> = {
  torcuato: [4, 5],
  merlo:    [4, 5],
}

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

// Parte de máquinas — planilla diaria por turno que carga el maquinista
// (subrol 'maquinista' del rol 'produccion_hielo'): horarios de cada ciclo de
// las roliteras + qué maquinarias estuvieron encendidas. Digitaliza la
// planilla papel "PARTE DE MÁQUINAS" (catálogo en utils/maquinasCatalogo.ts).
export type TurnoProduccion = 'manana' | 'tarde' | 'noche'

export interface CicloRolitera {
  rolitera: number      // 1..ROLITERAS_POR_PLANTA
  ciclo:    number      // correlativo dentro del turno para esa rolitera (1, 2, 3…)
  sale:     Timestamp | null   // la rolitera empieza a tirar el hielo
  entra:    Timestamp | null   // arranca el ciclo nuevo de producción (~4 min después de sale)
}

export interface ParteMaquinas {
  id:            string   // `${plantaId}_${fecha}_${turno}` — un parte por planta/día/turno
  plantaId:      PlantaId
  fecha:         string   // 'yyyy-MM-dd' (fecha local de planta)
  turno:         TurnoProduccion
  maquinista:    { uid: string; nombre: string }
  ciclos:        CicloRolitera[]
  maquinarias:   Record<string, number[]>   // { bombas: [1,2,3], osmosis: [2], … } — ids de utils/maquinasCatalogo.ts
  observaciones: string
  createdAt:     Timestamp   // Timestamp.now() del cliente — mismo criterio offline-first que PalletProduccion
  updatedAt:     Timestamp
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

// ── Rollups de pedidos ────────────────────────────────────────────────────────
// Agregados diarios que mantiene el trigger onOrderRollup (functions/src/triggers/
// rollups.ts). Los tableros de gerencia los leen en vez de escanear todos los
// pedidos, que se truncaban en silencio a escala (auditoría 2026-08-29, H5).
export interface RollupClienteDia { nombre: string; bolsas: number; pedidos: number }
export interface RollupPedidosDia {
  fecha:            string   // YYYY-MM-DD (Argentina, UTC-3)
  total:            number   // pedidos no cancelados del día
  bolsas:           number   // suma de unidades de pedidos no cancelados
  bolsasEntregadas: number   // suma de unidades de pedidos entregados (kg reales)
  porEstado:        Record<OrderStatus, number>
  porCliente:       Record<string, RollupClienteDia>
  updatedAt:        Timestamp | null
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
  origenManual?: boolean
  // Email del staff que cargó el pedido manual (auditoría; ausente en pedidos
  // viejos y en los del propio cliente, donde clientId ya identifica al autor).
  creadoPor?: string
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
  // Pedido que un supervisor tomó en la calle (ficha del cliente, 2026-09-07):
  // entra a la Bandeja de logística (date = ayer) sin chofer ni día; logística
  // lo programa. El trigger onPedidoSupervisorCreado avisa por push.
  origenSupervisor?: { uid: string; nombre: string }
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
  // Quién lo abrió: 'cliente' (autogestionado desde "Mis heladeras"),
  // 'staff' (Toma de service) o 'supervisor' (desde la ficha del cliente en
  // la calle, 2026-09-07). Determina si el trigger onTicketCreado avisa por
  // push a los encargados — un ticket de staff ya lo conoce quien lo creó;
  // uno de cliente o de supervisor no lo conoce nadie hasta que alguien se entera.
  origen:          'cliente' | 'staff' | 'supervisor'
  // Quién lo creó (las reglas del supervisor lo comparan con auth.uid).
  // Los tickets anteriores al 2026-09-07 no lo traen: ver historialAcciones[0].
  creadoPor?:      { uid: string; nombre: string }
  // Texto libre y foto del problema (Storage ticketsServicio/{id}/foto.jpg),
  // los carga el supervisor desde la calle.
  observacion?:    string | null
  fotoUrl?:        string | null
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
