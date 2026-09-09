"use strict";
/**
 * Pegamento entre los servicios puros de ARCA y Firebase: los secrets del
 * certificado, el adaptador de Firestore a `DbLike` y el puerto hacia ARCA
 * (autenticación con cache + las dos operaciones). Lo comparten los triggers
 * de facturación y los de anulación (nota de crédito).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.arcaKey = exports.arcaCert = void 0;
exports.comoDb = comoDb;
exports.puertoArca = puertoArca;
const params_1 = require("firebase-functions/params");
const ticketCache_1 = require("./ticketCache");
const wsaa_1 = require("./wsaa");
const wsfev1_1 = require("./wsfev1");
// El certificado y su clave viven en secrets, nunca en el repo ni en Firestore:
// con ellos se puede emitir comprobantes en nombre de la empresa.
exports.arcaCert = (0, params_1.defineSecret)('ARCA_CERT_PEM');
exports.arcaKey = (0, params_1.defineSecret)('ARCA_KEY_PEM');
/** Firestore real, con la forma mínima que esperan los servicios. */
function comoDb(db) {
    return {
        doc: (path) => db.doc(path),
        runTransaction: (fn) => db.runTransaction(fn),
    };
}
/** Arma el puerto hacia ARCA: autentica (con cache) y expone las dos operaciones. */
async function puertoArca(db, config) {
    // El certificado (secret) y el ambiente (config/arca) se cambian por
    // separado, y el de homologación está a nombre de otro CUIT. Cruzados, ARCA
    // devuelve un 601 que no dice cuál de las dos puntas está mal.
    (0, wsaa_1.verificarCertificadoCoincide)(exports.arcaCert.value(), config.cuit);
    const ta = await (0, ticketCache_1.obtenerTicketAcceso)({
        db: comoDb(db),
        cuit: config.cuit,
        ambiente: config.ambiente,
        certificadoPem: exports.arcaCert.value(),
        clavePrivadaPem: exports.arcaKey.value(),
    });
    const cfg = {
        ambiente: config.ambiente,
        credenciales: { token: ta.token, sign: ta.sign, cuit: config.cuit },
    };
    return {
        solicitarCae: (ptoVta, cbteTipo, detalle) => (0, wsfev1_1.feCaeSolicitar)(cfg, ptoVta, cbteTipo, detalle),
        consultarComprobante: (ptoVta, cbteTipo, numero) => (0, wsfev1_1.feCompConsultar)(cfg, ptoVta, cbteTipo, numero),
    };
}
//# sourceMappingURL=puertoFirebase.js.map