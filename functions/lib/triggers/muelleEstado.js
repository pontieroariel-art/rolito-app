"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicarMuelleEstadoVentanilla = exports.publicarMuelleEstadoDescarga = exports.publicarMuelleEstadoRemito = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const muelleEstado_1 = require("../services/muelleEstado");
// Estado PÚBLICO del muelle (`muelleEstado/{plantaId}`, 2026-09-15): qué dársenas
// están ocupadas ahora. Derivado sanitizado de remitos de carga, descargas y
// turnos de ventanilla, recalculado ENTERO en cada write de cualquiera de los tres
// (son decenas de docs por día por planta; recomputar es más simple y a prueba de
// estados intermedios que parchear). Lo lee el chofer que volvió para elegir en
// qué boca estacionó entre las libres. Lógica pura y tests en services/muelleEstado.
async function recalcular(plantaId) {
    const db = (0, firestore_2.getFirestore)();
    const { ymd, desde, hasta } = (0, muelleEstado_1.rangoDiaArt)();
    const dia = (col) => db.collection(col).where('plantaId', '==', plantaId).where('fecha', '>=', desde).where('fecha', '<', hasta).get();
    const [remitos, descargas, ventas] = await Promise.all([dia('remitosCarga'), dia('descargasCamion'), dia('ventasVentanilla')]);
    const ocupadas = (0, muelleEstado_1.calcularOcupadas)(remitos.docs.map((d) => d.data()), descargas.docs.map((d) => d.data()), ventas.docs.map((d) => d.data()));
    await db.collection('muelleEstado').doc(plantaId).set({
        plantaId, fecha: ymd, ocupadas, actualizado: firestore_2.FieldValue.serverTimestamp(),
    });
}
const plantaDe = (event) => {
    const data = (event.data?.after.exists ? event.data.after.data() : event.data?.before.data());
    return data?.plantaId;
};
exports.publicarMuelleEstadoRemito = (0, firestore_1.onDocumentWritten)('remitosCarga/{id}', async (event) => {
    const plantaId = plantaDe(event);
    if (plantaId)
        await recalcular(plantaId);
});
exports.publicarMuelleEstadoDescarga = (0, firestore_1.onDocumentWritten)('descargasCamion/{id}', async (event) => {
    const plantaId = plantaDe(event);
    if (plantaId)
        await recalcular(plantaId);
});
exports.publicarMuelleEstadoVentanilla = (0, firestore_1.onDocumentWritten)('ventasVentanilla/{id}', async (event) => {
    const plantaId = plantaDe(event);
    if (plantaId)
        await recalcular(plantaId);
});
//# sourceMappingURL=muelleEstado.js.map