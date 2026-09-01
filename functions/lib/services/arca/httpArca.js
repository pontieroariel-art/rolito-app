"use strict";
/**
 * Transporte HTTP para hablar con ARCA.
 *
 * No se usa el `fetch` global a propósito. Los servidores de ARCA negocian el
 * handshake con un grupo **Diffie-Hellman de 1024 bits**, y OpenSSL 3 —el que
 * trae Node 22, o sea el runtime de Cloud Functions— lo rechaza de entrada:
 *
 *     write EPROTO ... SSL routines:tls_process_ske_dhe:dh key too small
 *
 * Su nivel de seguridad por defecto (SECLEVEL=2) exige DH de 2048 bits o más.
 * Con `fetch` no hay forma limpia de bajarlo, así que se usa `node:https`, que
 * permite fijar `ciphers` y `minVersion` por conexión.
 *
 * Bajar a SECLEVEL=1 **no deshabilita TLS**: la conexión sigue siendo TLS 1.2
 * cifrada y con el certificado del servidor validado. Lo único que se afloja es
 * el tamaño mínimo aceptado en el intercambio de claves. No es una preferencia
 * nuestra — es lo que soporta la infraestructura de ARCA.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchArca = void 0;
const node_https_1 = require("node:https");
const TIMEOUT_MS = 30000;
const fetchArca = (url, init = {}) => {
    const destino = new URL(url);
    return new Promise((resolve, reject) => {
        const req = (0, node_https_1.request)({
            hostname: destino.hostname,
            port: destino.port || 443,
            path: destino.pathname + destino.search,
            method: init.method ?? 'GET',
            headers: init.headers ?? {},
            minVersion: 'TLSv1.2',
            ciphers: 'DEFAULT@SECLEVEL=1', // ver comentario del encabezado
            timeout: TIMEOUT_MS,
        }, (res) => {
            const trozos = [];
            res.on('data', (c) => trozos.push(c));
            res.on('end', () => {
                const cuerpo = Buffer.concat(trozos).toString('utf8');
                resolve({
                    ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
                    status: res.statusCode ?? 0,
                    text: async () => cuerpo,
                });
            });
            res.on('error', reject);
        });
        // Un timeout acá importa más que en otros lados: si la llamada a
        // FECAESolicitar queda colgada no sabemos si ARCA autorizó el comprobante,
        // y ese es justo el caso "incierto" que hay que resolver aparte.
        req.on('timeout', () => req.destroy(new Error(`Timeout de ${TIMEOUT_MS / 1000}s contra ARCA`)));
        req.on('error', reject);
        if (init.body)
            req.write(init.body);
        req.end();
    });
};
exports.fetchArca = fetchArca;
//# sourceMappingURL=httpArca.js.map