"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onClienteIndexado = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const clientesIndex_1 = require("../services/clientesIndex");
// Mantiene clientesIndex/{uid} (búsqueda liviana de clientes, 2026-09-10) a
// partir de users/{uid}. Corre en cada escritura de un usuario, incluida la
// sync diaria de precios (2.000 escrituras): por eso compara con el índice
// guardado y solo escribe si cambió algo de lo que se busca o se muestra.
// Si el usuario deja de ser cliente o se borra, saca el índice.
exports.onClienteIndexado = (0, firestore_1.onDocumentWritten)('users/{uid}', async (event) => {
    const uid = event.params.uid;
    const despues = event.data?.after?.exists ? event.data.after.data() : null;
    const nuevo = (0, clientesIndex_1.indiceDeCliente)(uid, despues);
    const db = (0, firestore_2.getFirestore)();
    const ref = db.doc(`clientesIndex/${uid}`);
    const actualSnap = await ref.get();
    const actual = actualSnap.exists ? actualSnap.data() : null;
    if (!nuevo) {
        if (actualSnap.exists)
            await ref.delete();
        return;
    }
    if ((0, clientesIndex_1.mismoIndice)(actual, nuevo))
        return;
    await ref.set({ ...nuevo, actualizadoEn: firestore_2.FieldValue.serverTimestamp() });
});
//# sourceMappingURL=clientesIndex.js.map