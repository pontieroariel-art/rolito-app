"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presentarCotRemito = exports.onRemitoCargaCotSolicitado = exports.arbaCit = void 0;
exports.presentarCotDeRemito = presentarCotDeRemito;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_2 = require("firebase-admin/firestore");
const rateLimit_1 = require("../rateLimit");
const cot_1 = require("../services/arba/cot");
const cotHttp_1 = require("../services/arba/cotHttp");
// COT de ARBA para el remito de carga (2026-09-10). Cuando caja emite un remito
// de carga que requiere COT, el doc nace con `cotSolicitud` (destino, remito R
// que lo respalda, patente, recorrido, salida). Acá se arma el TXT, se presenta
// al web service de ARBA y se guarda el resultado en `remitosCarga.cot` (solo
// el Admin SDK escribe ese campo: las reglas de update de remitosCarga tienen
// hasOnly). El interruptor es config/cot.habilitado; la clave CIT es el secret
// ARBA_CIT. Reintentos: la callable presentarCotRemito (caja, desde la
// pantalla de remitos). Ver docs/arba/COT.md.
exports.arbaCit = (0, params_1.defineSecret)('ARBA_CIT');
const ROLES_PRESENTAN = new Set(['super_admin', 'logistica', 'caja', 'facturacion']);
async function presentarCotDeRemito(db, remitoId, cit, origen) {
    const ref = db.doc(`remitosCarga/${remitoId}`);
    const snap = await ref.get();
    const r = snap.data();
    if (!r)
        throw new https_1.HttpsError('not-found', 'El remito de carga no existe');
    const sol = r.cotSolicitud;
    if (!sol)
        return { ok: false, error: 'El remito no tiene datos para el COT (se emitió sin pedirlo)' };
    if (r.cot?.estado === 'presentado' && r.cot?.numero)
        return { ok: true, cot: String(r.cot.numero) };
    const cfg = ((await db.doc('config/cot').get()).data() ?? {});
    const intentos = Number(r.cot?.intentos ?? 0) + 1;
    const fallar = async (error) => {
        await ref.set({ cot: { estado: 'error', error: error.slice(0, 500), intentos, origen, actualizadoEn: firestore_2.FieldValue.serverTimestamp() } }, { merge: true });
        console.error(`[cot] ${r.codigo ?? remitoId}: ${error}`);
        return { ok: false, error };
    };
    if (cfg.habilitado !== true)
        return fallar('La presentación del COT a ARBA está deshabilitada (config/cot.habilitado)');
    if (!cit)
        return fallar('Falta el secret ARBA_CIT (clave de transporte de ARBA)');
    let archivo;
    try {
        const fechaEmision = r.fecha instanceof firestore_2.Timestamp ? r.fecha.toDate() : new Date();
        archivo = (0, cot_1.armarArchivoCot)({ plantaId: String(r.plantaId), fechaEmision, items: (r.items ?? []) }, sol, cfg, Number(r.numero ?? 0) || 1);
    }
    catch (e) {
        return fallar(e.message);
    }
    let respuesta;
    try {
        const ambiente = cfg.ambiente === 'prueba' ? 'prueba' : 'produccion';
        const http = await (0, cotHttp_1.presentarArchivoCot)(ambiente, { cuit: String(cfg.cuit ?? ''), cit }, archivo);
        if (http.status !== 200)
            return fallar(`ARBA respondió HTTP ${http.status}: ${http.xml.slice(0, 200)}`);
        respuesta = (0, cot_1.parsearRespuestaCot)(http.xml);
    }
    catch (e) {
        return fallar(`No se pudo conectar con ARBA: ${e.message}`);
    }
    if (!respuesta.ok || !respuesta.cot)
        return fallar(respuesta.error ?? 'ARBA no devolvió COT');
    await ref.set({
        cot: {
            estado: 'presentado',
            numero: respuesta.cot,
            ...(respuesta.numeroUnico ? { numeroUnico: respuesta.numeroUnico } : {}),
            archivo: archivo.nombre,
            txt: archivo.contenido,
            kg: archivo.kg,
            fechaValidez: (0, cot_1.fechaValidez)(sol.fechaSalida),
            intentos,
            origen,
            presentadoEn: firestore_2.FieldValue.serverTimestamp(),
            actualizadoEn: firestore_2.FieldValue.serverTimestamp(),
            error: firestore_2.FieldValue.delete(),
        },
    }, { merge: true });
    console.log(`[cot] ${r.codigo ?? remitoId}: COT ${respuesta.cot} (${archivo.nombre}, ${archivo.kg} kg)`);
    return { ok: true, cot: respuesta.cot };
}
/** Al emitir el remito de carga con datos de COT, se presenta enseguida (antes de que el camión salga). */
exports.onRemitoCargaCotSolicitado = (0, firestore_1.onDocumentCreated)({ document: 'remitosCarga/{remitoId}', secrets: [exports.arbaCit], timeoutSeconds: 60 }, async (event) => {
    const data = event.data?.data();
    if (!data?.cotSolicitud)
        return;
    try {
        await presentarCotDeRemito((0, firestore_2.getFirestore)(), event.params.remitoId, exports.arbaCit.value(), 'trigger');
    }
    catch (e) {
        console.error(`[cot] ${event.params.remitoId}: ${e.message}`);
    }
});
/** Reintento manual desde la pantalla de remitos de carga (caja / logística / super_admin). */
exports.presentarCotRemito = (0, https_1.onCall)({ secrets: [exports.arbaCit], timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Requiere autenticación');
    const uid = request.auth.uid;
    const db = (0, firestore_2.getFirestore)();
    const perfil = (await db.doc(`users/${uid}`).get()).data();
    const rolesExtra = (perfil?.rolesExtra ?? []).map((x) => x?.rol ?? '');
    if (perfil?.estado !== 'activo' || (!ROLES_PRESENTAN.has(String(perfil?.rol)) && !rolesExtra.some((x) => ROLES_PRESENTAN.has(x)))) {
        throw new https_1.HttpsError('permission-denied', 'No autorizado');
    }
    const remitoId = String(request.data?.remitoId ?? '').trim();
    if (!remitoId)
        throw new https_1.HttpsError('invalid-argument', 'Falta remitoId');
    await (0, rateLimit_1.assertRateLimit)(uid, 'presentarCotRemito', 30, 3600);
    return presentarCotDeRemito(db, remitoId, exports.arbaCit.value(), 'manual');
});
//# sourceMappingURL=cotArba.js.map