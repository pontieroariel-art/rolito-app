import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { controlarRecibo } from '../services/cobranzasControl'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { destinoTango, movimientoStockDeVenta } from '../services/arca/circuito'
import { codigoTangoDe, esEmpresa, idGva14De, tangoIdsDe, type Empresa } from '../services/tango/empresas'
import { descontarCobranza, type SaldoDoc } from '../services/tango/saldos'
import { faltantesParaTango, totalCantidad, type ProductoLiquidado } from '../services/diferenciasReparto'
import {
  armarCierreMercaderia, claveDiaAr, ventasDelViaje,
  type CierreMercaderiaDoc, type ItemMercaderia,
} from '../services/cierreMercaderia'
import { normalizarUmbralFaltantes } from '../services/revisionDescarga'

// Helper: crea un item en tango-outbox con ID determinístico. Idempotente —
// un reintento del trigger tira ALREADY_EXISTS (código 6) y se ignora, así el
// mismo origen no se manda dos veces a Tango.
async function encolarOutbox(
  outboxId: string,
  item: {
    entidad: string
    origenColeccion: string
    origenId: string
    payload: unknown
    /** En cuál de las dos empresas de Tango va. Ver `destinoTango`. */
    empresa?: string
    /** El comprobante ya trae CAE de ARCA: Tango tiene que registrarlo como emitido. */
    conCaePropio?: boolean
  },
): Promise<void> {
  const db = getFirestore()
  try {
    await db.collection('tango-outbox').doc(outboxId).create({
      ...item,
      estado: 'pendiente',
      intentos: 0,
      ultimoError: null,
      creadoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    const code = (err as { code?: number })?.code
    if (code !== 6) throw err
  }
}

// Alta de un pallet de producción → un item en la cola tango-outbox, que el
// bridge en la VM de Tango escucha en tiempo real (ver
// scripts/tango/bridge-listener.mjs, docs/tango/INTEGRACION.md §7).
//
// produccionPallets es inmutable (firestore.rules: allow update, delete:
// if false), así que onCreate es el único evento que hace falta acá.
//
// ID determinístico (produccionPallets_{palletId}) + .create() en vez de
// .set(): si este trigger se reintenta (no es exactly-once), el segundo
// intento tira ALREADY_EXISTS y se ignora — evita mandar el mismo pallet dos
// veces a Tango.
export const onProduccionPalletCreado = onDocumentCreated(
  'produccionPallets/{palletId}',
  async (event) => {
    const pallet = event.data?.data()
    if (!pallet) return
    await encolarOutbox(`produccionPallets_${event.params.palletId}`, {
      entidad: 'produccionPallet',
      origenColeccion: 'produccionPallets',
      origenId: event.params.palletId,
      payload: pallet,
    })
  },
)

/**
 * El payload que viaja a Tango. La firma NO va: es constancia en Rolito (queda
 * en el doc de la venta), no en el comprobante de Tango, y pesa decenas de KB.
 */
function payloadDeVenta(venta: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...venta }
  delete payload.firmaCliente
  return payload
}

/**
 * El payload de la venta con la identidad del cliente EN LA EMPRESA destino.
 * La app graba en la venta el id/código de Redonhielo (los legacy de la ficha);
 * en Rolito el mismo cliente tiene otro ID_GVA14 (2026-09-06, users.tangoIds).
 * Si el cliente no está vinculado en esa empresa, queda lo que trajo la venta
 * y el writer lo reporta como siempre.
 */
async function payloadDeVentaEn(venta: Record<string, unknown>, empresa: string | undefined): Promise<Record<string, unknown>> {
  const payload = payloadDeVenta(venta)
  if (!esEmpresa(empresa) || typeof venta.clienteId !== 'string' || !venta.clienteId) return payload
  const user = (await getFirestore().collection('users').doc(venta.clienteId).get()).data()
  // Sucursal elegida al vender (2026-09-08): si la venta trae un código que es
  // de ESTE cliente en ESTA empresa, se respeta (Rappi RAP007, no el principal
  // MDP203). Si no, cae al principal de la empresa como antes.
  const elegido = String(venta.clienteCodigoTango ?? '').trim()
  const sucursal = elegido ? (tangoIdsDe(user)[empresa] ?? []).find((x) => x.codigo === elegido) : undefined
  const idGva14 = sucursal?.idGva14 ?? idGva14De(user, empresa)
  const codigo = sucursal?.codigo ?? codigoTangoDe(user, empresa)
  if (idGva14) payload.clienteIdGva14Tango = idGva14
  if (codigo) payload.clienteCodigoTango = codigo
  return payload
}

/**
 * Alta de una venta (camión o ventanilla) → los items que le corresponden en
 * tango-outbox:
 *
 *  1. El COMPROBANTE de venta. QUÉ comprobante y en QUÉ empresa lo decide
 *     `destinoTango`, que es la misma regla que decide si se le pide un CAE a
 *     ARCA — así no pueden divergir (docs/arca/FACTURACION_ELECTRONICA.md §11).
 *     Las que van como **factura de Redonhielo** NO se encolan acá: primero
 *     tiene que existir el CAE, que lo escribe `onVentaContadoFacturar` unos
 *     segundos después; esas las encola `onVenta*Facturada`. Mandarlas ahora
 *     sería mandar una factura sin su autorización.
 *  2. El MOVIMIENTO DE STOCK aparte, cuando el comprobante no lo hace: la
 *     factura de promo va a Rolito sin descargar stock y la mercadería sale de
 *     Redonhielo por un egreso VPR (`movimientoStockDeVenta`, decisión de Ariel
 *     2026-09-05). Item propio (`<col>_<id>_stock`), entidad 'movimientoStock',
 *     lo atiende el bridge SQL con su propio interruptor (stockSqlEnabled).
 */
async function encolarVenta(coleccion: 'ventasCamion' | 'ventasVentanilla', ventaId: string, venta: Record<string, unknown>): Promise<void> {
  const destino = destinoTango(venta.canal, venta.formaPago, venta.total)
  if (!destino) {
    // Mismo criterio que la facturación: ante la duda, no mandar. Un
    // comprobante creado en la empresa equivocada se arregla a mano del otro
    // lado; mandarlo bien más tarde, no.
    console.warn(
      `[tango] la venta ${coleccion}/${ventaId} no dice a dónde va ` +
      `(canal=${String(venta.canal)}, formaPago=${String(venta.formaPago)}, ` +
      `total=${String(venta.total)}); no se encola`,
    )
    return
  }

  if (!destino.conCaePropio) {   // con CAE espera a la factura — ver onVenta*Facturada
    await encolarOutbox(`${coleccion}_${ventaId}`, {
      entidad: destino.entidad,
      empresa: destino.empresa,
      origenColeccion: coleccion,
      origenId: ventaId,
      payload: await payloadDeVentaEn(venta, destino.empresa),
    })
  }

  const stock = movimientoStockDeVenta(venta.canal, venta.formaPago, venta.total)
  if (stock) {
    await encolarOutbox(`${coleccion}_${ventaId}_stock`, {
      entidad: 'movimientoStock',
      empresa: stock.empresa,
      origenColeccion: coleccion,
      origenId: ventaId,
      payload: { movimiento: stock.movimiento, venta: await payloadDeVentaEn(venta, stock.empresa) },
    })
  }

  // Fase B (2026-09-17): el cambio en el MOSTRADOR va planta → 99 en la venta
  // (el cajero ve la bolsa rota; no hay muelle que la cuente). En el camión el
  // cambio no mueve stock: la merma la cuenta el muelle en la descarga.
  const cambios = Array.isArray(venta.cambios) ? (venta.cambios as { productoId: string; nombre?: string; cantidad: number }[]) : []
  if (coleccion === 'ventasVentanilla' && totalCantidad(cambios) > 0) {
    const interno = venta.comprobanteInterno as { tipo?: string; puntoVenta?: number; numero?: number } | undefined
    await encolarOutbox(`${coleccion}_${ventaId}_cambio`, {
      entidad: 'transferenciaDeposito',
      empresa: 'redonhielo',
      origenColeccion: coleccion,
      origenId: ventaId,
      payload: {
        sentido:            'cambioVentanilla',   // planta → 99
        codigo:             interno?.numero ? `${interno.tipo ?? ''} ${interno.puntoVenta ?? ''}-${interno.numero}`.trim() : null,
        plantaId:           venta.plantaId ?? null,
        clienteCodigoTango: venta.clienteCodigoTango ?? null,
        clienteNombre:      venta.clienteNombre ?? null,
        items:              cambios,
        fecha:              venta.fecha,
        cajaNombre:         venta.cajaNombre ?? null,
      },
    })
  }
}

export const onVentaCamionCreada = onDocumentCreated(
  'ventasCamion/{ventaId}',
  async (event) => {
    const venta = event.data?.data()
    if (!venta) return
    await encolarVenta('ventasCamion', event.params.ventaId, venta)
  },
)

/**
 * La factura de Redonhielo viaja recién cuando ARCA la autorizó.
 *
 * El id del item es el mismo que usaría `onVentaCamionCreada`, así que una
 * venta produce **un solo** comprobante en Tango, nunca un remito y una
 * factura por la misma operación.
 *
 * `conCaePropio` viaja en el item para que el bridge lo registre como
 * comprobante YA EMITIDO: si Tango le pidiera a ARCA un CAE propio, la misma
 * venta quedaría autorizada dos veces.
 */
export const onVentaCamionFacturada = onDocumentUpdated(
  'ventasCamion/{ventaId}',
  async (event) => {
    const antes = event.data?.before.data()
    const ahora = event.data?.after.data()
    if (!ahora) return

    const facturada = (v: Record<string, unknown> | undefined) =>
      (v?.factura as { estado?: string } | undefined)?.estado === 'emitida'

    // Solo el paso a 'emitida'. Cualquier otra escritura sobre la venta no
    // tiene por qué volver a encolar nada.
    if (facturada(antes) || !facturada(ahora)) return

    const destino = destinoTango(ahora.canal, ahora.formaPago, ahora.total)
    if (!destino?.conCaePropio) return

    await encolarOutbox(`ventasCamion_${event.params.ventaId}`, {
      entidad: destino.entidad,
      empresa: destino.empresa,
      conCaePropio: true,
      origenColeccion: 'ventasCamion',
      origenId: event.params.ventaId,
      payload: await payloadDeVentaEn(ahora, destino.empresa),
    })
  },
)

// ── Ventanilla (mostrador): mismo circuito que el camión ─────────────────────
// La venta de mostrador sigue la misma tabla (docs/arca §11): contado
// efectivo/transferencia → factura ARCA (viaja recién con el CAE), cuenta
// corriente → remito, promo → Rolito. El id del item lleva la colección para
// no chocar con el del camión.
export const onVentaVentanillaCreada = onDocumentCreated(
  'ventasVentanilla/{ventaId}',
  async (event) => {
    const venta = event.data?.data()
    if (!venta) return
    await encolarVenta('ventasVentanilla', event.params.ventaId, venta)
  },
)

export const onVentaVentanillaFacturada = onDocumentUpdated(
  'ventasVentanilla/{ventaId}',
  async (event) => {
    const antes = event.data?.before.data()
    const ahora = event.data?.after.data()
    if (!ahora) return

    const facturada = (v: Record<string, unknown> | undefined) =>
      (v?.factura as { estado?: string } | undefined)?.estado === 'emitida'
    if (facturada(antes) || !facturada(ahora)) return

    const destino = destinoTango(ahora.canal, ahora.formaPago, ahora.total)
    if (!destino?.conCaePropio) return

    await encolarOutbox(`ventasVentanilla_${event.params.ventaId}`, {
      entidad: destino.entidad,
      empresa: destino.empresa,
      conCaePropio: true,
      origenColeccion: 'ventasVentanilla',
      origenId: event.params.ventaId,
      payload: await payloadDeVentaEn(ahora, destino.empresa),
    })
  },
)

/**
 * Nota de crédito de anulación de una factura de ventanilla (2026-09-09): cuando
 * el server la emite en ARCA (`anulacionesVentanilla/{id}.estado → 'emitida'`),
 * viaja al Facturador de Tango como 'CDE' referenciando a la factura. El item
 * lleva la venta (ítems, cliente, forma de pago: la NC es la factura entera al
 * revés) más la NC y el motivo. El write-back va a la solicitud (`tango`).
 */
export const onAnulacionEmitida = onDocumentUpdated(
  'anulacionesVentanilla/{ventaId}',
  async (event) => {
    const antes = event.data?.before.data()
    const ahora = event.data?.after.data()
    if (!ahora) return
    if (antes?.estado === 'emitida' || ahora.estado !== 'emitida') return
    const nc = ahora.notaCredito as Record<string, unknown> | undefined
    // NC de ARCA (factura con CAE) o NC interna de una promo (2026-09-11), sin ARCA.
    const nci = ahora.notaCreditoInterna as Record<string, unknown> | undefined
    const conArca = !!nc && nc.estado === 'emitida' && !!nc.cae
    if (!conArca && !nci) return

    const ventaId = event.params.ventaId
    const db = getFirestore()
    // La venta anulada puede ser de ventanilla o del camión (2026-09-11).
    const coleccionVenta = ahora.coleccion === 'ventasCamion' ? 'ventasCamion' : 'ventasVentanilla'
    const venta = (await db.doc(`${coleccionVenta}/${ventaId}`).get()).data()
    if (!venta) return
    const destino = destinoTango(venta.canal, venta.formaPago, venta.total)
    if (!destino || destino.entidad !== 'factura') return
    if (conArca ? !destino.conCaePropio : destino.conCaePropio) return

    await db.doc(`anulacionesVentanilla/${ventaId}`).set({ tango: { estado: 'pendiente' } }, { merge: true })
    await encolarOutbox(`anulacionesVentanilla_${ventaId}`, {
      entidad: 'notaCredito',
      empresa: destino.empresa,
      conCaePropio: conArca,
      origenColeccion: 'anulacionesVentanilla',
      origenId: ventaId,
      payload: {
        ...(await payloadDeVentaEn(venta, destino.empresa)),
        ...(conArca ? { notaCredito: nc } : { notaCreditoInterna: nci }),
        anulacion: {
          motivo: String(ahora.motivo ?? ''),
          nota: String(ahora.nota ?? ''),
          solicitadoPor: String((ahora.solicitadoPor as { nombre?: string } | undefined)?.nombre ?? ''),
          resueltaPor: String((ahora.resueltaPor as { nombre?: string } | undefined)?.nombre ?? ''),
        },
      },
    })
  },
)

// ── Transferencias de depósito: remito de carga y descarga del camión ────────
// En Tango los camiones son depósitos (STA22) y la venta desde el camión
// descarga stock de ESE depósito. Para que cierre, la mercadería tiene que
// haber entrado antes: eso es el remito de carga (planta → camión). La descarga
// contada al volver es el movimiento inverso (camión → planta); sin ella el
// depósito-camión nunca vuelve a cero. Ninguna de las dos es un comprobante de
// venta: van como entidad propia, con su writer e interruptor
// (`transferenciasEnabled`) en el bridge. Decidido 2026-09-03; el proceso de
// Tango para la transferencia está pendiente de confirmar con Axoft
// (docs/tango/INTEGRACION.md §13).
export const onRemitoCargaCreado = onDocumentCreated(
  'remitosCarga/{remitoId}',
  async (event) => {
    const remito = event.data?.data()
    if (!remito) return
    // Índice "qué camión está en la calle" (2026-09-18). Existe para que la
    // regla del remito no tenga que hacer consultas (no puede) y para que la
    // pantalla pueda decir "este camión volvió y nadie contó" con UNA lectura
    // por camión, en vez de barrer remitosCarga. Se pisa con el viaje más nuevo
    // a propósito: un camión hace un viaje por vez.
    if (remito.camionId) {
      await getFirestore().doc(`camionesEnViaje/${remito.camionId}`).set({
        remitoId:     event.params.remitoId,
        remitoCodigo: remito.codigo ?? '',
        plantaId:     remito.plantaId ?? '',
        choferNombre: remito.choferNombre ?? '',
        desde:        remito.fecha ?? FieldValue.serverTimestamp(),
        volvio:       false,
      }).catch((e) => console.warn('[camionesEnViaje] no se pudo indexar el viaje', e))
    }
    await encolarOutbox(`remitosCarga_${event.params.remitoId}`, {
      entidad: 'transferenciaDeposito',
      empresa: 'redonhielo',
      origenColeccion: 'remitosCarga',
      origenId: event.params.remitoId,
      payload: {
        sentido:      'carga',   // planta → camión
        codigo:       remito.codigo,
        numero:       remito.numero,
        plantaId:     remito.plantaId,
        depositoTango: remito.depositoTango ?? null,
        camionId:     remito.camionId,
        camionLabel:  remito.camionLabel,
        choferId:     remito.choferId,
        choferNombre: remito.choferNombre,
        items:        remito.items,
        palletsCarga: remito.palletsCarga ?? null,
        // Envases retornables (2026-09-07): viajan para cuando se mapeen los
        // artículos PALLETMETA / RACK en Tango; el writer hoy los ignora.
        envases:      remito.envases ?? null,
        fecha:        remito.fecha,
        creadoPor:    remito.creadoPor,
      },
    })
  },
)

/**
 * El camión volvió (2026-09-18): lo marca seguridad en el portón o el propio
 * chofer. Acá solo se refleja en el índice, para que la pantalla que avisa
 * "volvió y nadie contó" lea un doc por camión en vez de barrer remitos.
 */
export const onRemitoCargaRegreso = onDocumentUpdated(
  'remitosCarga/{remitoId}',
  async (event) => {
    const antes = event.data?.before.data()
    const ahora = event.data?.after.data()
    if (!ahora?.regreso || antes?.regreso) return   // solo la primera vez que aparece
    const camionId = String(ahora.camionId ?? '')
    if (!camionId) return
    const db = getFirestore()
    const ref = db.doc(`camionesEnViaje/${camionId}`)
    const actual = await ref.get()
    // Si el índice ya apunta a un viaje más nuevo (el camión volvió a salir),
    // no se toca: el que volvió es un viaje viejo y marcarlo confundiría al muelle.
    if (!actual.exists || actual.data()?.remitoId !== event.params.remitoId) return
    await ref.update({ volvio: true }).catch((e) => console.warn('[camionesEnViaje] no se pudo marcar el regreso', e))
  },
)

// Prefijo del código por planta, igual que PLANTA_INFO en src/utils/constants.ts
// (functions no puede importar de src/: ver functions/tsconfig.json).
const PREFIJO_PLANTA: Record<string, string> = { torcuato: 'DT', merlo: 'ML' }
export const codigoDescarga = (plantaId: string, numero: number): string =>
  `DC-${PREFIJO_PLANTA[plantaId] ?? 'DT'}-${String(numero).padStart(6, '0')}`

/**
 * Numera la descarga (2026-09-18). Lo hace el SERVIDOR y no la tablet porque
 * `crearDescargaCamion` es fire-and-forget: el muelle cuenta sin señal, el doc
 * se guarda igual y el número llega cuando sincroniza. El chofer que vuelve de
 * noche, con caja cerrada, escribe este código en el sobre de la plata: es lo
 * único que después le permite a caja saber de qué viaje es cada sobre.
 *
 * Idempotente: si el doc ya tiene código, devuelve el que tiene.
 */
export async function numerarDescarga(descargaId: string, plantaId: string): Promise<{ numero: number; codigo: string } | null> {
  const db = getFirestore()
  const ref = db.doc(`descargasCamion/${descargaId}`)
  const counterRef = db.doc(`config/descargaCounter_${plantaId}`)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const yaTiene = snap.data()?.codigo
    if (typeof yaTiene === 'string' && yaTiene) {
      return { numero: Number(snap.data()?.numero ?? 0), codigo: yaTiene }
    }
    const counter = await tx.get(counterRef)
    const numero = counter.exists ? Number(counter.data()?.next ?? 1) : 1
    const codigo = codigoDescarga(plantaId, numero)
    // merge: el contador puede tener otros campos (se crea solo en el primer uso).
    tx.set(counterRef, { next: numero + 1 }, { merge: true })
    tx.update(ref, { numero, codigo })
    return { numero, codigo }
  })
}

/**
 * Cierre de MERCADERÍA del viaje (2026-09-18): `cierresMercaderia/{remitoId}`.
 *
 * Lo escribe el server porque el muelle cuenta a ciegas y no puede leer ventas.
 * Se reescribe entero en cada descarga del mismo remito (segunda vuelta,
 * corrección): el cierre es el estado del viaje, no un acumulado de eventos.
 *
 * Sin `remitoId` (fletero, depósito sin remito digital) no hay viaje que
 * cerrar: esa mercadería se sigue liquidando por día.
 */
async function escribirCierreMercaderia(
  descargaId: string,
  descarga: FirebaseFirestore.DocumentData,
): Promise<CierreMercaderiaDoc<FirebaseFirestore.Timestamp> | null> {
  const remitoId = String(descarga.remitoId ?? '')
  if (!remitoId) return null
  const db = getFirestore()
  const remitoSnap = await db.doc(`remitosCarga/${remitoId}`).get()
  if (!remitoSnap.exists) return null
  const remito = remitoSnap.data() ?? {}

  const choferId = String(remito.choferId ?? '')
  const fechaRemito: Date = remito.fecha?.toDate?.() ?? descarga.fecha?.toDate?.() ?? new Date()
  const dia = claveDiaAr(fechaRemito)
  const desde = Timestamp.fromDate(new Date(`${dia}T00:00:00-03:00`))
  const hasta = Timestamp.fromDate(new Date(new Date(`${dia}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000))
  const delDia = (col: string) => db.collection(col)
    .where('choferId', '==', choferId)
    .where('fecha', '>=', desde).where('fecha', '<', hasta).get()

  const [ventasDelDia, ventasConRemito, cambios, descargas, viajesDelDia, configLiq, pedidosFabrica] = await Promise.all([
    // Las ventas sin `remitoId` (anteriores al 18/09, o del acompañante que sale
    // sin remito propio) se ubican por camión + día, como en utils/viajeDeVenta.
    delDia('ventasCamion'),
    db.collection('ventasCamion').where('remitoId', '==', remitoId).get(),
    delDia('cambiosCamion'),
    db.collection('descargasCamion').where('remitoId', '==', remitoId).get(),
    delDia('remitosCarga'),
    db.doc('config/liquidacion').get(),
    // Entregas con remito de fábrica (Coto/Carrefour, 2026-09-23): pedidos que el
    // chofer entregó sin venta de la app en ESTE viaje. Descuentan del camión
    // como una venta; Tango ya las tiene por el remito de la oficina.
    db.collection('orders').where('entregaFabrica.remitoId', '==', remitoId).get(),
  ])

  // Una venta puede venir por las dos consultas: se deduplica por id.
  const ventasPorId = new Map<string, FirebaseFirestore.DocumentData>()
  for (const d of [...ventasDelDia.docs, ...ventasConRemito.docs]) ventasPorId.set(d.id, d.data())
  const viajes = viajesDelDia.docs.map((d) => ({ id: d.id, camionId: d.data().camionId, choferId: d.data().choferId, fecha: d.data().fecha }))
  const ventas = ventasDelViaje(
    [...ventasPorId.values()].map((v) => ({
      remitoId: v.remitoId as string | undefined,
      camionId: v.camionId as string | undefined,
      choferId: v.choferId as string | undefined,
      fecha:    v.fecha,
      canal:    v.canal as string | undefined,
      items:    (v.items ?? []) as ItemMercaderia[],
      cambios:  (v.cambios ?? []) as ItemMercaderia[],
      anulacion: (v.anulacion ?? null) as { estado?: string } | null,
    })),
    viajes,
    remitoId,
  )

  const cierre = armarCierreMercaderia({
    remito: {
      id: remitoId, codigo: remito.codigo, plantaId: remito.plantaId,
      choferId: remito.choferId, choferNombre: remito.choferNombre,
      depositoTango: remito.depositoTango ?? null, depositoTangoNombre: remito.depositoTangoNombre ?? null,
      items: (remito.items ?? []) as ItemMercaderia[], palletsCarga: remito.palletsCarga, envases: remito.envases ?? null,
    },
    ventas,
    cambios: cambios.docs.map((d) => d.data() as ItemMercaderia),
    descargas: descargas.docs.map((d) => ({ id: d.id, ...(d.data() as object) })),
    entregasFabrica: pedidosFabrica.docs.map((d) => ({ productos: (d.data().entregaFabrica?.productos ?? []) as ItemMercaderia[] })),
    umbral: normalizarUmbralFaltantes(configLiq.data()?.faltantes),
    // El cierre pertenece al día del VIAJE, no al del conteo (2026-09-17).
    diaReparto: typeof descarga.diaReparto === 'string' ? descarga.diaReparto : dia,
    contadaPor: descarga.registradoPor ?? { uid: '', nombre: '' },
    contadaEn:  (descarga.fecha as FirebaseFirestore.Timestamp) ?? Timestamp.now(),
  })

  // `set` sin merge: el cierre se reemplaza entero, así un producto que
  // desaparece de la corrección no queda colgado del cierre anterior.
  await db.doc(`cierresMercaderia/${remitoId}`).set({
    ...cierre,
    ...(descarga.rectificaA ? { rectificadoEn: Timestamp.now() } : {}),
  })
  return cierre
}

export const onDescargaCamionCreada = onDocumentCreated(
  'descargasCamion/{descargaId}',
  async (event) => {
    const descarga = event.data?.data()
    if (!descarga) return
    const db = getFirestore()
    // Día del VIAJE (2026-09-17): si la tablet vieja no lo escribió, se
    // completa acá con el día del remito (o del conteo) para que la liquidación
    // y los tableros, que agrupan por diaReparto, no pierdan la descarga.
    if (typeof descarga.diaReparto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(descarga.diaReparto)) {
      let base: Date = descarga.fecha?.toDate?.() ?? new Date()
      if (descarga.remitoId) {
        const rem = (await db.doc(`remitosCarga/${descarga.remitoId}`).get().catch(() => null))?.data()
        if (rem?.fecha?.toDate) base = rem.fecha.toDate()
      }
      const diaReparto = claveDiaAr(base)
      descarga.diaReparto = diaReparto
      await db.doc(`descargasCamion/${event.params.descargaId}`).update({ diaReparto }).catch((e) => console.warn('[descarga] no se pudo completar diaReparto', e))
    }

    // Número y código de la descarga (DC-DT-000012): antes que nada, porque es
    // lo que el chofer copia en el sobre de la plata.
    if (!descarga.codigo) {
      const numerada = await numerarDescarga(event.params.descargaId, String(descarga.plantaId ?? 'torcuato'))
        .catch((e) => { console.error('[descarga] no se pudo numerar', event.params.descargaId, e); return null })
      if (numerada) { descarga.numero = numerada.numero; descarga.codigo = numerada.codigo }
    }

    // El camión ya no está en la calle: el viaje se contó. Solo si el índice
    // apunta a ESTE remito — si apunta a uno más nuevo, el camión volvió a salir
    // y borrarlo escondería el viaje en curso.
    if (descarga.remitoId) {
      const ref = db.doc(`camionesEnViaje/${String(descarga.camionId ?? '')}`)
      const enViaje = descarga.camionId ? await ref.get().catch(() => null) : null
      if (enViaje?.exists && enViaje.data()?.remitoId === descarga.remitoId) {
        await ref.delete().catch((e) => console.warn('[camionesEnViaje] no se pudo cerrar el viaje', e))
      }
    }

    // Cierre de MERCADERÍA del viaje + la diferencia que va a Tango. Aparte del
    // resto en un try: si el cálculo falla, la transferencia de stock se encola
    // igual (mismo criterio que descargaRevision).
    try {
      const cierre = await escribirCierreMercaderia(event.params.descargaId, descarga)
      // Fase B del stock (2026-09-17): lo que el chofer no puede justificar sale
      // del camión al depósito 98. Se encola al cerrar la MERCADERÍA, que es
      // cuando hay conteo, y no al cerrar la plata (2026-09-18: las dos mitades
      // se cierran por separado y la plata puede cerrarse sin descarga).
      // El id es por REMITO, así una segunda descarga o una corrección del mismo
      // viaje no vuelve a encolar (create tira ALREADY_EXISTS y se ignora).
      if (cierre && !descarga.teorica) {
        const items = faltantesParaTango(cierre.productos as ProductoLiquidado[])
        if (items.length > 0) {
          await encolarOutbox(`cierresMercaderia_${cierre.remitoId}_diferencia`, {
            entidad: 'transferenciaDeposito',
            empresa: 'redonhielo',
            origenColeccion: 'cierresMercaderia',
            origenId: cierre.remitoId,
            payload: {
              sentido:       'diferencia',   // camión → 98 (config/tango.sql.stock.tipos.diferencia.depositoDestino)
              codigo:        cierre.remitoCodigo,
              plantaId:      cierre.plantaId,
              depositoTango: cierre.depositoTango ?? null,
              choferId:      cierre.choferId,
              choferNombre:  cierre.choferNombre,
              items,
              fecha:         descarga.fecha,
              cerradaPor:    cierre.contadaPor,
            },
          })
        }
      }
    } catch (e) {
      console.error('[cierreMercaderia] no se pudo cerrar la mercadería del viaje', event.params.descargaId, e)
    }

    // Rectificación de un conteo (2026-09-13): NO va a Tango. La descarga
    // original ya encoló la transferencia camión → planta y la cola no tiene
    // contra-movimiento para transferenciaDeposito (ni buildError ni estado
    // cancelado), así que encolar la corrección duplicaría el stock. El ajuste
    // lo hace la oficina a mano, avisada por onDescargaRectificada.
    if (descarga.rectificaA) return
    await encolarOutbox(`descargasCamion_${event.params.descargaId}`, {
      entidad: 'transferenciaDeposito',
      empresa: 'redonhielo',
      origenColeccion: 'descargasCamion',
      origenId: event.params.descargaId,
      payload: {
        sentido:          'descarga',   // camión → planta
        plantaId:         descarga.plantaId,
        depositoTango:    descarga.depositoTango ?? null,
        camionId:         descarga.camionId,
        camionLabel:      descarga.camionLabel,
        choferId:         descarga.choferId,
        choferNombre:     descarga.choferNombre,
        items:            descarga.items,        // sana que volvió
        bolsasRotas:      descarga.bolsasRotas,  // rotas recibidas (contra los cambios)
        // LEGACY (descargas anteriores al 2026-09-07); las nuevas traen `envases`.
        // Sin el `?? null` el Admin SDK rechaza el undefined y la descarga no
        // se encola.
        palletsCompletos: descarga.palletsCompletos ?? null,
        palletsParciales: descarga.palletsParciales ?? null,
        palletsVacios:    descarga.palletsVacios ?? null,
        envases:          descarga.envases ?? null,
        fecha:            descarga.fecha,
        registradoPor:    descarga.registradoPor,
      },
    })
    // Fase B (2026-09-17, aprobada por Ariel): las bolsas rotas contadas por el
    // muelle son la merma real y van camión → 99 en un item aparte (prefijo de
    // referencia DM, write-back en `tango.mermaNumero`). La descarga teórica del
    // cierre de arranque no cuenta rotas. Ver services/diferenciasReparto.ts.
    // Recién cuando el tipo `merma` esté en config/tango.sql.stock.tipos (bridge
    // nuevo en la VM): antes de eso el bridge viejo mandaría el item a error.
    const tipoMerma = (await getFirestore().doc('config/tango').get()).data()?.sql?.stock?.tipos?.merma
    if (!descarga.teorica && tipoMerma && totalCantidad(descarga.bolsasRotas) > 0) {
      await encolarOutbox(`descargasCamion_${event.params.descargaId}_merma`, {
        entidad: 'transferenciaDeposito',
        empresa: 'redonhielo',
        origenColeccion: 'descargasCamion',
        origenId: event.params.descargaId,
        payload: {
          sentido:       'merma',   // camión → 99 (config/tango.sql.stock.tipos.merma.depositoDestino)
          codigo:        descarga.codigo ?? descarga.remitoCodigo ?? null,
          plantaId:      descarga.plantaId,
          depositoTango: descarga.depositoTango ?? null,
          camionId:      descarga.camionId,
          camionLabel:   descarga.camionLabel,
          choferId:      descarga.choferId,
          choferNombre:  descarga.choferNombre,
          items:         descarga.bolsasRotas,
          fecha:         descarga.fecha,
          registradoPor: descarga.registradoPor,
        },
      })
    }
  },
)

// Alta de una cobranza de supervisor → un item 'recibo' en tango-outbox (el
// bridge genera el recibo de cobranza en Tango cuando la licencia habilite
// transacciones — hasta entonces el writer es stub y el item queda pendiente)
// + DESCUENTO OPTIMISTA del cache de saldos: se resta lo imputado de cada
// comprobante en saldosTango/{clienteId} en el momento, así el próximo cobro
// no muestra deuda vieja aunque Tango todavía no haya recibido el recibo.
export const onCobranzaCreada = onDocumentCreated(
  'cobranzas/{cobranzaId}',
  async (event) => {
    const cobranza = event.data?.data()
    // Viaja a Tango toda cobranza COMPLETA (con imputación a facturas), venga
    // del supervisor, de caja o del chofer (2026-09-05). Las simples de
    // mostrador/calle de antes (sin imputaciones) siguen sin encolarse.
    // Desde el 2026-09-08 también viaja la cobranza a cuenta pura (sin factura imputada).
    if (!cobranza || !Array.isArray(cobranza.imputaciones) || (cobranza.imputaciones.length === 0 && !(Number(cobranza.aCuenta) > 0))) return
    // Un recibo que no cuadra (valores ≠ importe, imputado > recibido…) NO va a
    // Tango ni descuenta el saldo (auditoría 2026-09-22): hasta hoy la triple
    // igualdad se validaba solo en el navegador del que cobra. Lo marca y
    // avisa onCobranzaControl; la oficina decide.
    const descuadre = controlarRecibo(cobranza)
    if (descuadre) { console.error(`[outbox] cobranzas/${event.params.cobranzaId} no cuadra, no se encola: ${descuadre.motivos.join(' ')}`); return }

    const db = getFirestore()

    // El bridge necesita el vínculo Tango del cliente EN LA EMPRESA del recibo
    // (un recibo = una empresa = un código de cliente, 2026-09-06). El código lo
    // trae la cobranza (el de las facturas imputadas); si no, el principal de
    // la ficha en esa empresa.
    const empresa: Empresa = esEmpresa(cobranza.empresa) ? cobranza.empresa : 'redonhielo'
    const userSnap = await db.collection('users').doc(cobranza.clienteId).get()
    const user = userSnap.data()
    const codigoCobranza = typeof cobranza.codigoTango === 'string' && cobranza.codigoTango ? cobranza.codigoTango : null
    const idsEmpresa = (user ? tangoIdsDe(user)[empresa] : undefined) ?? []
    const identidad = (codigoCobranza ? idsEmpresa.find((x) => x.codigo === codigoCobranza) : undefined) ?? idsEmpresa[0]

    await encolarOutbox(`cobranzas_${event.params.cobranzaId}`, {
      entidad: 'recibo',
      empresa,
      origenColeccion: 'cobranzas',
      origenId: event.params.cobranzaId,
      payload: {
        numeroRecibo:  cobranza.numeroRecibo,
        empresa,
        clienteId:     cobranza.clienteId,
        clienteNombre: cobranza.clienteNombre,
        clienteIdGva14Tango: identidad?.idGva14 ?? (empresa === 'redonhielo' ? user?.idGva14Tango ?? null : null),
        clienteCodigoTango:  codigoCobranza ?? identidad?.codigo ?? (empresa === 'redonhielo' ? user?.codigoTango ?? null : null),
        importe:       cobranza.importe,
        imputaciones:  cobranza.imputaciones,
        medios:        cobranza.medios,
        aCuenta:       typeof cobranza.aCuenta === 'number' ? cobranza.aCuenta : 0,
        fecha:         cobranza.fecha,
        registradoPor: cobranza.registradoPor,
        // Quién cobró y desde dónde: LEYENDA_2 y USUARIO del recibo en Tango (2026-09-09).
        origen:        cobranza.origen ?? null,
        plantaId:      cobranza.plantaId ?? null,
        // Referencia idempotente: el writer del bridge la escribe en el recibo
        // de Tango y la busca ANTES de crear, para no duplicar recibos si se
        // muere entre el Create y la confirmación.
        referenciaIdempotente: `ROLITO:${event.params.cobranzaId}`,
      },
    })

    // Descuento optimista del cache (transacción: dos cobranzas simultáneas al
    // mismo cliente no se pisan). Si el doc de saldo no existe, no hay cache
    // que corregir.
    const imputaciones = Array.isArray(cobranza.imputaciones) ? cobranza.imputaciones : []
    const aCuenta = Number(cobranza.aCuenta) > 0 ? Number(cobranza.aCuenta) : 0
    const aplicaciones = Array.isArray(cobranza.medios?.aCuentaAplicado) ? cobranza.medios.aCuentaAplicado : []
    if (imputaciones.length === 0 && aCuenta === 0 && aplicaciones.length === 0) return
    // Solo se descuenta en la EMPRESA de la cobranza (la misma factura puede
    // existir con igual tipo y número en la otra). Reintento del trigger (no es
    // exactly-once): descontarCobranza devuelve null si ya se aplicó.
    const saldoRef = db.collection('saldosTango').doc(cobranza.clienteId)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(saldoRef)
      if (!snap.exists) return
      const r = descontarCobranza(snap.data() as Partial<SaldoDoc>, {
        id: event.params.cobranzaId, empresa, imputaciones, aCuenta,
        numeroRecibo: typeof cobranza.numeroRecibo === 'string' ? cobranza.numeroRecibo : undefined,
        codigoTango: codigoCobranza ?? identidad?.codigo ?? undefined,
        fecha: cobranza.fecha,
        medios: cobranza.medios,
      })
      if (!r) return
      tx.update(saldoRef, {
        comprobantes: r.comprobantes,
        saldoTotal: r.saldoTotal,
        porEmpresa: r.porEmpresa,
        cobranzasAplicadas: FieldValue.arrayUnion(event.params.cobranzaId),
        actualizadoEn: FieldValue.serverTimestamp(),
      })
    })
  },
)

// Write-backs por entidad: cuando el bridge confirma un item en Tango escribe
// el número devuelto en tango-outbox.resultado y marca estado 'confirmado';
// acá lo copiamos de vuelta al doc de origen (el bridge no tiene permiso para
// escribir esas colecciones — solo los campos de estado del outbox; el
// write-back va por Admin SDK, que además bypassa la inmutabilidad de
// cobranzas en las reglas, a propósito).
//
// Los updates van con dot-paths ('tango.estado') y no con el objeto entero
// ({ tango: {...} }): una venta promo recibe DOS confirmaciones (la factura de
// Rolito y el egreso de stock de Redonhielo) y la segunda no debe pisar la
// primera.
const WRITE_BACKS: Record<string, {
  /** Colecciones de origen válidas para esta entidad. */
  colecciones: string[]
  buildUpdate: (resultado: Record<string, unknown>, item?: Record<string, unknown>) => Record<string, unknown> | null
  /** Cuando la cola agota los reintentos (estado 'error'): qué marcar en el doc de origen
   *  para que la pantalla lo muestre (2026-09-08). Sin esto el doc queda "pendiente" para siempre. */
  buildError?: (ultimoError: string) => Record<string, unknown>
}> = {
  remito: {
    // Del camión o del mostrador: mismo comprobante en Tango, distinto origen.
    colecciones: ['ventasCamion', 'ventasVentanilla'],
    buildUpdate: (resultado) => {
      const remitoNumero = resultado?.remitoNumero
      if (!remitoNumero) return null
      return { 'tango.estado': 'confirmado', 'tango.remitoNumero': remitoNumero }
    },
  },
  // El número que le puso TANGO al comprobante. No se toca `venta.factura`,
  // que es el comprobante de ARCA con su propio número y CAE: son dos
  // identidades distintas de la misma operación.
  factura: {
    colecciones: ['ventasCamion', 'ventasVentanilla'],
    buildUpdate: (resultado) => {
      const facturaNumero = resultado?.facturaNumero ?? resultado?.comprobanteNumero
      if (!facturaNumero) return null
      return { 'tango.estado': 'confirmado', 'tango.facturaNumero': String(facturaNumero) }
    },
  },
  // Remito de carga y descarga del camión: el número que Tango le dio al
  // movimiento de stock.
  // Fase B (2026-09-17): merma (descarga → 99), diferencia (liquidación → 98) y
  // cambio de ventanilla (venta → 99) usan la misma entidad con otro `sentido`
  // y un campo propio, para no pisar el número de la DES de la misma descarga.
  // 'cierresMercaderia' (2026-09-22): desde el viaje en dos partes (18/09) la
  // diferencia al 98 sale del cierre de mercadería y no de la liquidación, y
  // al no estar acá el DIF quedaba confirmado en la cola sin escribir
  // tango.diferenciaNumero en el cierre (lo encontró el test de la cola).
  transferenciaDeposito: {
    colecciones: ['remitosCarga', 'descargasCamion', 'liquidaciones', 'ventasVentanilla', 'cierresMercaderia'],
    buildUpdate: (resultado, item) => {
      const numero = resultado?.transferenciaNumero ?? resultado?.comprobanteNumero ?? resultado?.savedId
      if (!numero) return null
      const sentido = (item?.payload as { sentido?: string } | undefined)?.sentido
      if (sentido === 'merma')            return { 'tango.mermaEstado': 'confirmado', 'tango.mermaNumero': String(numero) }
      if (sentido === 'diferencia')       return { 'tango.estado': 'confirmado', 'tango.diferenciaNumero': String(numero) }
      if (sentido === 'cambioVentanilla') return { 'tango.cambioEstado': 'confirmado', 'tango.cambioNumero': String(numero) }
      return { 'tango.estado': 'confirmado', 'tango.transferenciaNumero': String(numero) }
    },
  },
  // Egreso de stock en Redonhielo por la venta promo (tipo VPR). Campos propios
  // (stock*) porque el mismo doc ya tiene la confirmación de la factura de Rolito.
  movimientoStock: {
    colecciones: ['ventasCamion', 'ventasVentanilla'],
    buildUpdate: (resultado) => {
      const numero = resultado?.stockNumero
      if (!numero) return null
      return { 'tango.stockEstado': 'confirmado', 'tango.stockNumero': String(numero), 'tango.stockTipo': String(resultado?.tComp ?? '') }
    },
  },
  // Nota de crédito de anulación (ventanilla): el número con el que Tango la
  // registró queda en la solicitud, que es lo que mira la bandeja de anulaciones.
  notaCredito: {
    colecciones: ['anulacionesVentanilla'],
    buildUpdate: (resultado) => {
      const numero = resultado?.notaCreditoNumero ?? resultado?.comprobanteNumero
      if (!numero) return null
      return { 'tango.estado': 'confirmado', 'tango.numero': String(numero), 'tango.ultimoError': FieldValue.delete() }
    },
    buildError: (ultimoError) => ({ 'tango.estado': 'error', 'tango.ultimoError': ultimoError }),
  },
  recibo: {
    colecciones: ['cobranzas'],
    buildUpdate: (resultado) => {
      const reciboNumero = resultado?.reciboNumero ?? resultado?.savedId
      if (!reciboNumero) return null
      return { 'tango.estado': 'confirmado', 'tango.reciboNumero': String(reciboNumero), 'tango.ultimoError': FieldValue.delete() }
    },
    buildError: (ultimoError) => ({ 'tango.estado': 'error', 'tango.ultimoError': ultimoError }),
  },
  // Pallet de producción (2026-09-25): el número del PDT/PRO vuelve al pallet
  // para que el panel del encargado vea qué entró a Tango y qué no.
  produccionPallet: {
    colecciones: ['produccionPallets'],
    buildUpdate: (resultado) => {
      const numero = resultado?.produccionNumero
      if (!numero) return null
      return { 'tango.estado': 'confirmado', 'tango.numero': String(numero).trim(), 'tango.ultimoError': FieldValue.delete() }
    },
    buildError: (ultimoError) => ({ 'tango.estado': 'error', 'tango.ultimoError': ultimoError }),
  },
  // Anulación del remito en Tango (2026-09-20). El bridge no falla por los casos
  // previstos: los informa en `resultado`, y cada uno tiene su destino.
  //   anulado / ya_anulado → listo, la fila se va de la lista de pendientes
  //   facturado            → vuelve a la oficina: primero hay que anular la factura
  //   inexistente          → vuelve a la oficina, que revise con qué número quedó
  anulacionRemito: {
    colecciones: ['ventasCamion'],
    buildUpdate: (resultado) => {
      const r = String(resultado?.resultado ?? '')
      const listo = r === 'anulado' || r === 'ya_anulado'
      return {
        'anulacion.tango.estado': listo ? 'confirmado' : 'pendiente_oficina',
        'anulacion.tango.resultado': r,
        'anulacion.tango.en': FieldValue.serverTimestamp(),
      }
    },
    // Un error de verdad (la base caída, el stock que se movió) deja la
    // anulación en manos de la oficina: no se pierde, se ve en la lista.
    buildError: (ultimoError) => ({ 'anulacion.tango.estado': 'pendiente_oficina', 'anulacion.tango.ultimoError': ultimoError }),
  },
}

export const onOutboxConfirmado = onDocumentUpdated(
  'tango-outbox/{docId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!after) return
    if (before?.estado === after.estado) return
    const writeBack = WRITE_BACKS[after.entidad]
    const coleccion = String(after.origenColeccion ?? '')
    if (!writeBack || !writeBack.colecciones.includes(coleccion)) return

    let update: Record<string, unknown> | null = null
    if (after.estado === 'confirmado') update = writeBack.buildUpdate(after.resultado ?? {}, after)
    else if (after.estado === 'error' && writeBack.buildError) update = writeBack.buildError(String(after.ultimoError ?? 'error en el bridge de Tango').slice(0, 500))
    if (!update) return

    await getFirestore().collection(coleccion).doc(after.origenId).update(update)
  },
)
