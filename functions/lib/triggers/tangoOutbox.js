"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOutboxConfirmado = exports.onCobranzaCreada = exports.onVentaCamionCreada = exports.onProduccionPalletCreado = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
// Helper: crea un item en tango-outbox con ID determinístico. Idempotente —
// un reintento del trigger tira ALREADY_EXISTS (código 6) y se ignora, así el
// mismo origen no se manda dos veces a Tango.
async function encolarOutbox(outboxId, item) {
    const db = (0, firestore_2.getFirestore)();
    try {
        await db.collection('tango-outbox').doc(outboxId).create({
            ...item,
            estado: 'pendiente',
            intentos: 0,
            ultimoError: null,
            creadoEn: firestore_2.FieldValue.serverTimestamp(),
            actualizadoEn: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    catch (err) {
        const code = err?.code;
        if (code !== 6)
            throw err;
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
exports.onProduccionPalletCreado = (0, firestore_1.onDocumentCreated)('produccionPallets/{palletId}', async (event) => {
    const pallet = event.data?.data();
    if (!pallet)
        return;
    await encolarOutbox(`produccionPallets_${event.params.palletId}`, {
        entidad: 'produccionPallet',
        origenColeccion: 'produccionPallets',
        origenId: event.params.palletId,
        payload: pallet,
    });
});
// Alta de una venta desde el camión → un item 'remito' en tango-outbox. El
// bridge genera el remito en Tango (descarga del depósito-camión) por la vía
// oficial de importación. La firma NO va en el payload: es constancia en Rolito
// (queda en el doc de la venta), no en el remito de Tango.
exports.onVentaCamionCreada = (0, firestore_1.onDocumentCreated)('ventasCamion/{ventaId}', async (event) => {
    const venta = event.data?.data();
    if (!venta)
        return;
    const payload = { ...venta };
    delete payload.firmaCliente;
    await encolarOutbox(`ventasCamion_${event.params.ventaId}`, {
        entidad: 'remito',
        origenColeccion: 'ventasCamion',
        origenId: event.params.ventaId,
        payload,
    });
});
// Alta de una cobranza de supervisor → un item 'recibo' en tango-outbox (el
// bridge genera el recibo de cobranza en Tango cuando la licencia habilite
// transacciones — hasta entonces el writer es stub y el item queda pendiente)
// + DESCUENTO OPTIMISTA del cache de saldos: se resta lo imputado de cada
// comprobante en saldosTango/{clienteId} en el momento, así el próximo cobro
// no muestra deuda vieja aunque Tango todavía no haya recibido el recibo.
exports.onCobranzaCreada = (0, firestore_1.onDocumentCreated)('cobranzas/{cobranzaId}', async (event) => {
    const cobranza = event.data?.data();
    if (!cobranza || cobranza.origen !== 'supervisor')
        return;
    const db = (0, firestore_2.getFirestore)();
    // El bridge necesita el vínculo Tango del cliente para armar el recibo.
    const userSnap = await db.collection('users').doc(cobranza.clienteId).get();
    const user = userSnap.data();
    await encolarOutbox(`cobranzas_${event.params.cobranzaId}`, {
        entidad: 'recibo',
        origenColeccion: 'cobranzas',
        origenId: event.params.cobranzaId,
        payload: {
            numeroRecibo: cobranza.numeroRecibo,
            empresa: cobranza.empresa,
            clienteId: cobranza.clienteId,
            clienteNombre: cobranza.clienteNombre,
            clienteIdGva14Tango: user?.idGva14Tango ?? null,
            clienteCodigoTango: user?.codigoTango ?? null,
            importe: cobranza.importe,
            imputaciones: cobranza.imputaciones,
            medios: cobranza.medios,
            fecha: cobranza.fecha,
            registradoPor: cobranza.registradoPor,
            // Referencia idempotente: el writer del bridge la escribe en el recibo
            // de Tango y la busca ANTES de crear, para no duplicar recibos si se
            // muere entre el Create y la confirmación.
            referenciaIdempotente: `ROLITO:${event.params.cobranzaId}`,
        },
    });
    // Descuento optimista del cache (transacción: dos cobranzas simultáneas al
    // mismo cliente no se pisan). Si el doc de saldo no existe, no hay cache
    // que corregir.
    const imputaciones = Array.isArray(cobranza.imputaciones) ? cobranza.imputaciones : [];
    if (imputaciones.length === 0)
        return;
    const saldoRef = db.collection('saldosTango').doc(cobranza.clienteId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(saldoRef);
        if (!snap.exists)
            return;
        const data = snap.data();
        const yaAplicadas = Array.isArray(data.cobranzasAplicadas) ? data.cobranzasAplicadas : [];
        // Reintento del trigger (no es exactly-once): no descontar dos veces.
        if (yaAplicadas.includes(event.params.cobranzaId))
            return;
        const comprobantes = (Array.isArray(data.comprobantes) ? data.comprobantes : []).map((c) => {
            const imp = imputaciones.find((i) => i.comprobanteTipo === c.tipo && i.comprobanteNumero === c.numero);
            if (!imp)
                return c;
            const nuevoSaldo = Math.round((c.saldoPendiente - imp.importeImputado) * 100) / 100;
            return { ...c, saldoPendiente: Math.max(0, nuevoSaldo) };
        }).filter((c) => c.saldoPendiente > 0);
        const saldoTotal = Math.round(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100;
        tx.update(saldoRef, {
            comprobantes,
            saldoTotal,
            cobranzasAplicadas: firestore_2.FieldValue.arrayUnion(event.params.cobranzaId),
            actualizadoEn: firestore_2.FieldValue.serverTimestamp(),
        });
    });
});
// Write-backs por entidad: cuando el bridge confirma un item en Tango escribe
// el número devuelto en tango-outbox.resultado y marca estado 'confirmado';
// acá lo copiamos de vuelta al doc de origen (el bridge no tiene permiso para
// escribir esas colecciones — solo los campos de estado del outbox; el
// write-back va por Admin SDK, que además bypassa la inmutabilidad de
// cobranzas en las reglas, a propósito).
const WRITE_BACKS = {
    remito: {
        coleccion: 'ventasCamion',
        buildUpdate: (resultado) => {
            const remitoNumero = resultado?.remitoNumero;
            if (!remitoNumero)
                return null;
            return { tango: { estado: 'confirmado', remitoNumero } };
        },
    },
    recibo: {
        coleccion: 'cobranzas',
        buildUpdate: (resultado) => {
            const reciboNumero = resultado?.reciboNumero ?? resultado?.savedId;
            if (!reciboNumero)
                return null;
            return { tango: { estado: 'confirmado', reciboNumero: String(reciboNumero) } };
        },
    },
};
exports.onOutboxConfirmado = (0, firestore_1.onDocumentUpdated)('tango-outbox/{docId}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after)
        return;
    if (before?.estado === 'confirmado' || after.estado !== 'confirmado')
        return;
    const writeBack = WRITE_BACKS[after.entidad];
    if (!writeBack || after.origenColeccion !== writeBack.coleccion)
        return;
    const update = writeBack.buildUpdate(after.resultado ?? {});
    if (!update)
        return;
    await (0, firestore_2.getFirestore)().collection(writeBack.coleccion).doc(after.origenId).update(update);
});
//# sourceMappingURL=tangoOutbox.js.map