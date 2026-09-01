"use strict";
/**
 * Cliente del WSAA de ARCA (Web Service de Autenticación y Autorización).
 *
 * Para llamar a cualquier método de WSFEv1 hace falta un "Ticket de Acceso"
 * (TA): un par Token + Sign que ARCA entrega a cambio de un pedido firmado
 * digitalmente con el certificado fiscal de la empresa. El TA dura 12 horas.
 *
 * El flujo completo es:
 *   1. Armar un TRA (Ticket de Requerimiento de Acceso), que es un XML chico.
 *   2. Firmarlo en formato CMS/PKCS#7 con el certificado + su clave privada.
 *   3. Mandarlo en base64 al WSAA por SOAP (método loginCms).
 *   4. Guardar el Token/Sign que devuelve hasta que venza.
 *
 * Ojo con el paso 4: **el cacheo no es una optimización, es obligatorio**. Si se
 * pide un TA nuevo mientras hay uno vigente, ARCA responde con un error
 * ("ya posee un TA válido") en vez de darte otro. Sin cache, la segunda venta
 * del día falla.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICIO_WSFE = exports.WSAA_URL = void 0;
exports.generarTRA = generarTRA;
exports.firmarTRA = firmarTRA;
exports.extraerTag = extraerTag;
exports.parsearRespuestaWsaa = parsearRespuestaWsaa;
exports.solicitarTicketAcceso = solicitarTicketAcceso;
const forge = __importStar(require("node-forge"));
const httpArca_1 = require("./httpArca");
exports.WSAA_URL = {
    homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};
/** El servicio de negocio que se pide autorizar. Para facturación es "wsfe". */
exports.SERVICIO_WSFE = 'wsfe';
// ── 1. Armado del TRA ─────────────────────────────────────────────────────────
/**
 * Ventana de validez que se le pide al TRA. ARCA rechaza pedidos con fechas
 * demasiado lejanas; se usa un margen hacia atrás para tolerar desfasajes de
 * reloj entre nuestro servidor y el de ellos.
 */
const MARGEN_ATRAS_MS = 10 * 60 * 1000; // 10 minutos
const VIGENCIA_MS = 10 * 60 * 1000; // 10 minutos
/**
 * Genera el XML del TRA. Función pura: recibe el "ahora" para poder testearla.
 *
 * El uniqueId tiene que ser distinto en cada pedido. Se usa el timestamp en
 * segundos, acotado a 32 bits porque ARCA lo trata como entero con signo.
 */
function generarTRA(servicio = exports.SERVICIO_WSFE, ahora = new Date()) {
    const generationTime = new Date(ahora.getTime() - MARGEN_ATRAS_MS).toISOString();
    const expirationTime = new Date(ahora.getTime() + VIGENCIA_MS).toISOString();
    const uniqueId = Math.floor(ahora.getTime() / 1000) % 2147483647;
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<loginTicketRequest version="1.0">',
        '  <header>',
        `    <uniqueId>${uniqueId}</uniqueId>`,
        `    <generationTime>${generationTime}</generationTime>`,
        `    <expirationTime>${expirationTime}</expirationTime>`,
        '  </header>',
        `  <service>${servicio}</service>`,
        '</loginTicketRequest>',
    ].join('\n');
}
// ── 2. Firma CMS / PKCS#7 ─────────────────────────────────────────────────────
/**
 * Firma el TRA en formato CMS (PKCS#7 SignedData) y lo devuelve en base64,
 * que es como lo espera el WSAA.
 *
 * Equivale a lo que hace `openssl cms -sign -infile TRA.xml`, pero en proceso:
 * no queremos depender de que haya un binario de openssl en el runtime de
 * Cloud Functions, ni escribir la clave privada a disco.
 *
 * @param certificadoPem  El .crt emitido por ARCA (parte pública).
 * @param clavePrivadaPem La .key generada junto al CSR. Nunca se loguea.
 */
function firmarTRA(tra, certificadoPem, clavePrivadaPem) {
    let certificado;
    let clavePrivada;
    try {
        certificado = forge.pki.certificateFromPem(certificadoPem);
    }
    catch (e) {
        throw new Error(`El certificado no es un PEM válido: ${e.message}`);
    }
    try {
        clavePrivada = forge.pki.privateKeyFromPem(clavePrivadaPem);
    }
    catch (e) {
        // A propósito no se incluye el contenido en el mensaje: es material secreto.
        throw new Error(`La clave privada no es un PEM válido: ${e.message}`);
    }
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, 'utf8');
    p7.addCertificate(certificado);
    p7.addSigner({
        key: clavePrivada,
        certificate: certificado,
        digestAlgorithm: forge.pki.oids.sha256,
        // Sin estos atributos autenticados la firma queda "bare" y algunos
        // verificadores la rechazan. contentType y messageDigest son obligatorios
        // en CMS cuando se firman atributos; signingTime lo calcula forge solo.
        authenticatedAttributes: [
            { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
            { type: forge.pki.oids.messageDigest },
            { type: forge.pki.oids.signingTime },
        ],
    });
    p7.sign({ detached: false });
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return forge.util.encode64(der);
}
// ── 3. Llamada al WSAA ────────────────────────────────────────────────────────
function envolverEnSoap(cmsBase64) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
        '                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
        '  <soapenv:Header/>',
        '  <soapenv:Body>',
        '    <wsaa:loginCms>',
        `      <wsaa:in0>${cmsBase64}</wsaa:in0>`,
        '    </wsaa:loginCms>',
        '  </soapenv:Body>',
        '</soapenv:Envelope>',
    ].join('\n');
}
/** Saca el contenido de un tag simple. Alcanza para estas respuestas chicas. */
function extraerTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
}
/**
 * Interpreta el loginTicketResponse que devuelve el WSAA (viene escapado dentro
 * del sobre SOAP, por eso primero hay que desescaparlo).
 */
function parsearRespuestaWsaa(xmlSoap) {
    const falla = extraerTag(xmlSoap, 'faultstring');
    if (falla)
        throw new Error(`WSAA rechazó el pedido: ${falla}`);
    const crudo = extraerTag(xmlSoap, 'loginCmsReturn');
    if (!crudo)
        throw new Error('La respuesta del WSAA no trae loginCmsReturn');
    const xml = crudo
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    const token = extraerTag(xml, 'token');
    const sign = extraerTag(xml, 'sign');
    const exp = extraerTag(xml, 'expirationTime');
    if (!token || !sign)
        throw new Error('La respuesta del WSAA no trae token/sign');
    return {
        token,
        sign,
        // Si no viene expiración, se asume el mínimo razonable (las 12 h del manual).
        expiracion: exp ? new Date(exp) : new Date(Date.now() + 12 * 60 * 60 * 1000),
    };
}
/**
 * Pide un Ticket de Acceso nuevo al WSAA.
 *
 * No cachea: de eso se ocupa quien lo llama (ver obtenerTicketAcceso en el
 * módulo que persiste en Firestore). Pedir tickets de más da error en ARCA.
 */
async function solicitarTicketAcceso(opts) {
    const tra = generarTRA(opts.servicio ?? exports.SERVICIO_WSFE);
    const cms = firmarTRA(tra, opts.certificadoPem, opts.clavePrivadaPem);
    const doFetch = opts.fetchImpl ?? httpArca_1.fetchArca;
    const resp = await doFetch(exports.WSAA_URL[opts.ambiente], {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: '',
        },
        body: envolverEnSoap(cms),
    });
    const texto = await resp.text();
    // El WSAA devuelve 500 con un SOAP Fault cuando rechaza; el cuerpo explica el
    // motivo mucho mejor que el status, así que se parsea igual antes de tirar.
    if (!resp.ok) {
        const falla = extraerTag(texto, 'faultstring');
        throw new Error(`WSAA respondió ${resp.status}${falla ? `: ${falla}` : ''}`);
    }
    return parsearRespuestaWsaa(texto);
}
//# sourceMappingURL=wsaa.js.map