import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { destinoTango } from '../services/arca/circuito'

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
 * Alta de una venta desde el camión → un item en tango-outbox.
 *
 * QUÉ comprobante y en QUÉ empresa lo decide `destinoTango`, que es la misma
 * regla que decide si se le pide un CAE a ARCA — así no pueden divergir. Ver
 * docs/arca/FACTURACION_ELECTRONICA.md §11.
 *
 * Las que van como **factura de Redonhielo** NO se encolan acá: primero tiene
 * que existir el CAE, que lo escribe `onVentaContadoFacturar` unos segundos
 * después. Esas las encola `onVentaCamionFacturada`. Mandarlas ahora sería
 * mandar una factura sin su autorización.
 */
export const onVentaCamionCreada = onDocumentCreated(
  'ventasCamion/{ventaId}',
  async (event) => {
    const venta = event.data?.data()
    if (!venta) return

    const destino = destinoTango(venta.canal, venta.formaPago, venta.total)
    if (!destino) {
      // Mismo criterio que la facturación: ante la duda, no mandar. Un
      // comprobante creado en la empresa equivocada se arregla a mano del otro
      // lado; mandarlo bien más tarde, no.
      console.warn(
        `[tango] la venta ${event.params.ventaId} no dice a dónde va ` +
        `(canal=${String(venta.canal)}, formaPago=${String(venta.formaPago)}, ` +
        `total=${String(venta.total)}); no se encola`,
      )
      return
    }

    if (destino.conCaePropio) return   // espera el CAE — ver onVentaCamionFacturada

    await encolarOutbox(`ventasCamion_${event.params.ventaId}`, {
      entidad: destino.entidad,
      empresa: destino.empresa,
      origenColeccion: 'ventasCamion',
      origenId: event.params.ventaId,
      payload: payloadDeVenta(venta),
    })
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
      payload: payloadDeVenta(ahora),
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

    const destino = destinoTango(venta.canal, venta.formaPago, venta.total)
    if (!destino) {
      console.warn(
        `[tango] la venta de ventanilla ${event.params.ventaId} no dice a dónde va ` +
        `(canal=${String(venta.canal)}, formaPago=${String(venta.formaPago)}, ` +
        `total=${String(venta.total)}); no se encola`,
      )
      return
    }
    if (destino.conCaePropio) return   // espera el CAE — ver onVentaVentanillaFacturada

    await encolarOutbox(`ventasVentanilla_${event.params.ventaId}`, {
      entidad: destino.entidad,
      empresa: destino.empresa,
      origenColeccion: 'ventasVentanilla',
      origenId: event.params.ventaId,
      payload: payloadDeVenta(venta),
    })
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
      payload: payloadDeVenta(ahora),
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
        camionId:     remito.camionId,
        camionLabel:  remito.camionLabel,
        choferId:     remito.choferId,
        choferNombre: remito.choferNombre,
        items:        remito.items,
        palletsCarga: remito.palletsCarga,
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
        camionId:         descarga.camionId,
        camionLabel:      descarga.camionLabel,
        choferId:         descarga.choferId,
        choferNombre:     descarga.choferNombre,
        items:            descarga.items,        // sana que volvió
        bolsasRotas:      descarga.bolsasRotas,  // rotas recibidas (contra los cambios)
        palletsCompletos: descarga.palletsCompletos,
        palletsParciales: descarga.palletsParciales,
        palletsVacios:    descarga.palletsVacios,
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
    if (!cobranza || cobranza.origen !== 'supervisor') return

    const db = getFirestore()

    // El bridge necesita el vínculo Tango del cliente para armar el recibo.
    const userSnap = await db.collection('users').doc(cobranza.clienteId).get()
    const user = userSnap.data()

    await encolarOutbox(`cobranzas_${event.params.cobranzaId}`, {
      entidad: 'recibo',
      origenColeccion: 'cobranzas',
      origenId: event.params.cobranzaId,
      payload: {
        numeroRecibo:  cobranza.numeroRecibo,
        empresa:       cobranza.empresa,
        clienteId:     cobranza.clienteId,
        clienteNombre: cobranza.clienteNombre,
        clienteIdGva14Tango: user?.idGva14Tango ?? null,
        clienteCodigoTango:  user?.codigoTango ?? null,
        importe:       cobranza.importe,
        imputaciones:  cobranza.imputaciones,
        medios:        cobranza.medios,
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
    if (imputaciones.length === 0) return
    const saldoRef = db.collection('saldosTango').doc(cobranza.clienteId)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(saldoRef)
      if (!snap.exists) return
      const data = snap.data()!
      const yaAplicadas: string[] = Array.isArray(data.cobranzasAplicadas) ? data.cobranzasAplicadas : []
      // Reintento del trigger (no es exactly-once): no descontar dos veces.
      if (yaAplicadas.includes(event.params.cobranzaId)) return

      const comprobantes = (Array.isArray(data.comprobantes) ? data.comprobantes : []).map(
        (c: { tipo: string; numero: string; saldoPendiente: number }) => {
          const imp = imputaciones.find(
            (i: { comprobanteTipo: string; comprobanteNumero: string }) =>
              i.comprobanteTipo === c.tipo && i.comprobanteNumero === c.numero,
          )
          if (!imp) return c
          const nuevoSaldo = Math.round((c.saldoPendiente - imp.importeImputado) * 100) / 100
          return { ...c, saldoPendiente: Math.max(0, nuevoSaldo) }
        },
      ).filter((c: { saldoPendiente: number }) => c.saldoPendiente > 0)

      const saldoTotal = Math.round(comprobantes.reduce(
        (s: number, c: { saldoPendiente: number }) => s + c.saldoPendiente, 0,
      ) * 100) / 100

      tx.update(saldoRef, {
        comprobantes,
        saldoTotal,
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
const WRITE_BACKS: Record<string, {
  /** Colecciones de origen válidas para esta entidad. */
  colecciones: string[]
  buildUpdate: (resultado: Record<string, unknown>) => Record<string, unknown> | null
}> = {
  remito: {
    // Del camión o del mostrador: mismo comprobante en Tango, distinto origen.
    colecciones: ['ventasCamion', 'ventasVentanilla'],
    buildUpdate: (resultado) => {
      const remitoNumero = resultado?.remitoNumero
      if (!remitoNumero) return null
      return { tango: { estado: 'confirmado', remitoNumero } }
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
      return { tango: { estado: 'confirmado', facturaNumero: String(facturaNumero) } }
    },
  },
  // Remito de carga y descarga del camión: el número que Tango le dio al
  // movimiento de stock.
  transferenciaDeposito: {
    colecciones: ['remitosCarga', 'descargasCamion'],
    buildUpdate: (resultado) => {
      const numero = resultado?.transferenciaNumero ?? resultado?.comprobanteNumero ?? resultado?.savedId
      if (!numero) return null
      return { tango: { estado: 'confirmado', transferenciaNumero: String(numero) } }
    },
  },
  recibo: {
    colecciones: ['cobranzas'],
    buildUpdate: (resultado) => {
      const reciboNumero = resultado?.reciboNumero ?? resultado?.savedId
      if (!reciboNumero) return null
      return { tango: { estado: 'confirmado', reciboNumero: String(reciboNumero) } }
    },
  },
}

export const onOutboxConfirmado = onDocumentUpdated(
  'tango-outbox/{docId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!after) return
    if (before?.estado === 'confirmado' || after.estado !== 'confirmado') return

    const writeBack = WRITE_BACKS[after.entidad]
    const coleccion = String(after.origenColeccion ?? '')
    if (!writeBack || !writeBack.colecciones.includes(coleccion)) return

    const update = writeBack.buildUpdate(after.resultado ?? {})
    if (!update) return

    await getFirestore().collection(coleccion).doc(after.origenId).update(update)
  },
)
