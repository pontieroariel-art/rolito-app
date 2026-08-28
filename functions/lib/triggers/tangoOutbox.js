"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOutboxConfirmado = exports.onVentaCamionCreada = exports.onProduccionPalletCreado = void 0;
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
// Cuando el bridge confirma un remito en Tango, escribe el número devuelto en
// tango-outbox.resultado y marca estado 'confirmado'. Acá lo copiamos de vuelta
// al doc de la venta (el bridge no tiene permiso para escribir ventasCamion —
// solo los campos de estado del outbox; el write-back va por Admin SDK).
exports.onOutboxConfirmado = (0, firestore_1.onDocumentUpdated)('tango-outbox/{docId}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after)
        return;
    if (before?.estado === 'confirmado' || after.estado !== 'confirmado')
        return;
    if (after.entidad !== 'remito' || after.origenColeccion !== 'ventasCamion')
        return;
    const remitoNumero = after.resultado?.remitoNumero;
    if (!remitoNumero)
        return;
    await (0, firestore_2.getFirestore)().collection('ventasCamion').doc(after.origenId).update({
        tango: { estado: 'confirmado', remitoNumero },
    });
});
//# sourceMappingURL=tangoOutbox.js.map