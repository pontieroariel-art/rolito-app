"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDescargaMarcaRemito = void 0;
/**
 * Marca en el remito de carga que su descarga ya fue contada (2026-09-22).
 *
 * La tablet del muelle lista "en reparto, sin descargar" cruzando los remitos
 * de SU planta con las descargas de SU planta. Una descarga contada en la otra
 * planta (traslado a Merlo, caso RC-DT-000082) no la ve, y el viaje quedaba
 * como pendiente para siempre. El muelle no puede leer `cierresMercaderia`
 * (conteo ciego), así que la señal va en el remito, sin cantidades: solo qué
 * descarga, cuándo y en qué planta. Lo escribe el servidor.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
exports.onDescargaMarcaRemito = (0, firestore_1.onDocumentCreated)('descargasCamion/{descargaId}', async (event) => {
    const d = event.data?.data();
    const remitoId = typeof d?.remitoId === 'string' ? d.remitoId.trim() : '';
    if (!d || !remitoId)
        return;
    const ref = (0, firestore_2.getFirestore)().doc(`remitosCarga/${remitoId}`);
    const remito = await ref.get();
    if (!remito.exists)
        return;
    const marca = {
        id: event.params.descargaId,
        codigo: typeof d.codigo === 'string' ? d.codigo : null, // lo numera el server después; la tablet solo mira que exista
        hora: d.fecha ?? null,
        plantaId: String(d.plantaId ?? ''),
        ...(typeof d.rectificaA === 'string' ? { rectificaA: d.rectificaA } : {}),
    };
    await ref.set({ descarga: marca }, { merge: true });
});
//# sourceMappingURL=descargaMarcaRemito.js.map