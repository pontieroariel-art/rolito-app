"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicarTurnosVentanilla = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
// Tablero PÚBLICO de turnos de ventanilla (turnosPublicos/{plantaId}) — el
// documento que lee la página /turnos/{planta} abierta desde el QR del
// comprobante, con sesión anónima. Es un DERIVADO sanitizado de
// ventasVentanilla: SOLO número de turno + estado + dársena. Nombres,
// productos y montos jamás se copian acá — la seguridad es por construcción,
// no por filtrado en el cliente.
//
// Se recalcula entero en cada write de una venta de ventanilla (pocas decenas
// por día por planta — recomputar todo es más simple y a prueba de estados
// intermedios que parchear).
// Día operativo en hora argentina (UTC-3 fijo, AR no tiene horario de verano).
function rangoDiaArt() {
    const art = new Date(Date.now() - 3 * 3600000);
    const ymd = art.toISOString().slice(0, 10);
    const desde = new Date(`${ymd}T03:00:00Z`); // 00:00 ART
    const hasta = new Date(desde.getTime() + 24 * 3600000);
    return { ymd, desde: firestore_2.Timestamp.fromDate(desde), hasta: firestore_2.Timestamp.fromDate(hasta) };
}
exports.publicarTurnosVentanilla = (0, firestore_1.onDocumentWritten)('ventasVentanilla/{ventaId}', async (event) => {
    const data = event.data?.after.exists ? event.data.after.data() : event.data?.before.data();
    const plantaId = data?.plantaId;
    if (!plantaId)
        return;
    const db = (0, firestore_2.getFirestore)();
    const { ymd, desde, hasta } = rangoDiaArt();
    const snap = await db.collection('ventasVentanilla')
        .where('plantaId', '==', plantaId)
        .where('fecha', '>=', desde)
        .where('fecha', '<', hasta)
        .get();
    const turnos = snap.docs
        .map((d) => {
        const v = d.data();
        const estado = v.estado === 'entregado' ? 'entregado' : (v.turnoEstado ?? 'en_espera');
        return {
            n: v.turno,
            estado,
            ...(v.darsena != null && estado === 'llamado' ? { darsena: v.darsena } : {}),
        };
    })
        .filter((t) => typeof t.n === 'number')
        .sort((a, b) => a.n - b.n);
    await db.collection('turnosPublicos').doc(plantaId).set({
        fecha: ymd,
        turnos,
        actualizado: firestore_2.FieldValue.serverTimestamp(),
    });
});
//# sourceMappingURL=turnosVentanilla.js.map