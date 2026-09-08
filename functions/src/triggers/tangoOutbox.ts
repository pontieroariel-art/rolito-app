import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { destinoTango, movimientoStockDeVenta } from '../services/arca/circuito'
import { codigoTangoDe, esEmpresa, idGva14De, tangoIdsDe, type Empresa } from '../services/tango/empresas'
import { descontarCobranza, type SaldoDoc } from '../services/tango/saldos'

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

export const onDescargaCamionCreada = onDocumentCreated(
  'descargasCamion/{descargaId}',
  async (event) => {
    const descarga = event.data?.data()
    if (!descarga) return
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
  buildUpdate: (resultado: Record<string, unknown>) => Record<string, unknown> | null
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
  transferenciaDeposito: {
    colecciones: ['remitosCarga', 'descargasCamion'],
    buildUpdate: (resultado) => {
      const numero = resultado?.transferenciaNumero ?? resultado?.comprobanteNumero ?? resultado?.savedId
      if (!numero) return null
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
  recibo: {
    colecciones: ['cobranzas'],
    buildUpdate: (resultado) => {
      const reciboNumero = resultado?.reciboNumero ?? resultado?.savedId
      if (!reciboNumero) return null
      return { 'tango.estado': 'confirmado', 'tango.reciboNumero': String(reciboNumero), 'tango.ultimoError': FieldValue.delete() }
    },
    buildError: (ultimoError) => ({ 'tango.estado': 'error', 'tango.ultimoError': ultimoError }),
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
    if (after.estado === 'confirmado') update = writeBack.buildUpdate(after.resultado ?? {})
    else if (after.estado === 'error' && writeBack.buildError) update = writeBack.buildError(String(after.ultimoError ?? 'error en el bridge de Tango').slice(0, 500))
    if (!update) return

    await getFirestore().collection(coleccion).doc(after.origenId).update(update)
  },
)
