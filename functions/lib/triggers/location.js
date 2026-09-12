"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mirrorDriverLocation = void 0;
exports.valeLaPenaEspejar = valeLaPenaEspejar;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
// Espeja la posición del chofer (colección `ubicaciones`, que el cliente ya NO
// puede leer por reglas) dentro de sus pedidos `en_camino`, en el campo
// `driverLocation`. El dueño del pedido —que sí puede leer su propio pedido— ve
// el camión en vivo por su onSnapshot, sin acceso a la ubicación de la flota.
//
// Solo se espejan pedidos `en_camino` (típicamente uno por chofer a la vez),
// así que el volumen de escrituras es bajo. Los dos filtros son de igualdad, de
// modo que Firestore resuelve la query sin índice compuesto.
exports.mirrorDriverLocation = (0, firestore_1.onDocumentWritten)('ubicaciones/{driverEmail}', async (event) => {
    const after = event.data?.after;
    if (!after?.exists)
        return;
    const loc = after.data();
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number')
        return;
    const driverEmail = event.params.driverEmail;
    const db = (0, firestore_2.getFirestore)();
    const snap = await db.collection('orders')
        .where('driverId', '==', driverEmail)
        .where('status', '==', 'en_camino')
        .get();
    if (snap.empty)
        return;
    const driverLocation = {
        lat: loc.lat,
        lng: loc.lng,
        nombreChofer: loc.nombreChofer ?? '',
        telefonoChofer: loc.telefonoChofer ?? '',
        updatedAt: loc.timestamp ?? firestore_2.FieldValue.serverTimestamp(),
    };
    // El teléfono manda un ping cada 10 s; el cliente que mira el camión no
    // distingue 20 m. Solo se espeja si se movió más de ~40 m o pasó más de
    // un minuto (auditoría 2026-09-12): cada escritura en el pedido dispara
    // además el trigger de rollups.
    const batch = db.batch();
    let cambios = 0;
    snap.docs.forEach((d) => {
        if (!valeLaPenaEspejar(d.data().driverLocation, loc))
            return;
        batch.update(d.ref, { driverLocation });
        cambios++;
    });
    if (cambios > 0)
        await batch.commit();
});
const METROS_MINIMOS = 40;
const SEGUNDOS_MAXIMOS = 60;
/** Pura: ¿la posición nueva cambia algo para el que la mira? */
function valeLaPenaEspejar(previa, nueva) {
    if (!previa || typeof previa.lat !== 'number' || typeof previa.lng !== 'number')
        return true;
    const ahora = nueva.timestamp?.toMillis() ?? Date.now();
    const antes = previa.updatedAt?.toMillis?.() ?? 0;
    if (ahora - antes >= SEGUNDOS_MAXIMOS * 1000)
        return true;
    return distanciaMetros(previa.lat, previa.lng, nueva.lat, nueva.lng) >= METROS_MINIMOS;
}
function distanciaMetros(lat1, lng1, lat2, lng2) {
    const r = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
}
//# sourceMappingURL=location.js.map