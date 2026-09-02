"use strict";
/**
 * Cliente del WSFEv1 de ARCA (facturación electrónica).
 *
 * Se habla SOAP a mano en vez de usar una librería de WSDL: son cinco métodos,
 * el contrato no cambia, y traer un stack de SOAP a Cloud Functions por esto
 * sería desproporcionado. El armado de XML está acotado a este archivo.
 *
 * La autenticación (Token/Sign) la provee wsaa.ts; la lógica fiscal (qué
 * comprobante, cuánto IVA) vive en comprobante.ts. Acá solo se transporta.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feParamGetCondicionIvaReceptor = exports.feParamGetTiposCbte = exports.feParamGetTiposIva = exports.feParamGetTiposTributos = exports.ArcaError = exports.WSFEV1_URL = void 0;
exports.extraerTodos = extraerTodos;
exports.parsearErrores = parsearErrores;
exports.parsearObservaciones = parsearObservaciones;
exports.feDummy = feDummy;
exports.feCompUltimoAutorizado = feCompUltimoAutorizado;
exports.feCompConsultar = feCompConsultar;
exports.feParamGet = feParamGet;
exports.feParamGetPtosVenta = feParamGetPtosVenta;
exports.feCaeSolicitar = feCaeSolicitar;
const wsaa_1 = require("./wsaa");
const httpArca_1 = require("./httpArca");
exports.WSFEV1_URL = {
    homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};
const NS = 'http://ar.gov.afip.dif.FEV1/';
class ArcaError extends Error {
    constructor(message, errores = []) {
        super(message);
        this.errores = errores;
        this.name = 'ArcaError';
    }
}
exports.ArcaError = ArcaError;
// ── Armado de SOAP ────────────────────────────────────────────────────────────
function escaparXml(v) {
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function tagsAuth(c) {
    return [
        '<ar:Auth>',
        `<ar:Token>${escaparXml(c.token)}</ar:Token>`,
        `<ar:Sign>${escaparXml(c.sign)}</ar:Sign>`,
        `<ar:Cuit>${escaparXml(c.cuit)}</ar:Cuit>`,
        '</ar:Auth>',
    ].join('');
}
function envolver(operacion, cuerpoInterno) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
        `                  xmlns:ar="${NS}">`,
        '<soapenv:Header/>',
        '<soapenv:Body>',
        `<ar:${operacion}>`,
        cuerpoInterno,
        `</ar:${operacion}>`,
        '</soapenv:Body>',
        '</soapenv:Envelope>',
    ].join('');
}
// ── Parseo de respuestas ──────────────────────────────────────────────────────
/** Devuelve el contenido de cada ocurrencia de un tag. */
function extraerTodos(xml, tag) {
    // Mismo criterio que `extraerTag`: el espacio antes de los atributos evita
    // que un tag enganche a otro cuyo nombre empieza igual.
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null)
        out.push(m[1]);
    return out;
}
function parsearErrores(xml) {
    const bloque = (0, wsaa_1.extraerTag)(xml, 'Errors');
    if (!bloque)
        return [];
    return extraerTodos(bloque, 'Err').map((e) => ({
        code: Number((0, wsaa_1.extraerTag)(e, 'Code') ?? 0),
        msg: (0, wsaa_1.extraerTag)(e, 'Msg') ?? '',
    }));
}
function parsearObservaciones(xml) {
    const bloque = (0, wsaa_1.extraerTag)(xml, 'Observaciones');
    if (!bloque)
        return [];
    // <Observaciones> contiene uno o más <Obs>; algunos entornos devuelven los
    // campos sueltos si hay una sola. Se contemplan las dos formas.
    const obs = extraerTodos(bloque, 'Obs');
    const fuentes = obs.length > 0 ? obs : [bloque];
    return fuentes.map((o) => ({
        code: Number((0, wsaa_1.extraerTag)(o, 'Code') ?? 0),
        msg: (0, wsaa_1.extraerTag)(o, 'Msg') ?? '',
    }));
}
/** Lanza si la respuesta trae un SOAP Fault o errores de ARCA. */
function verificarRespuesta(xml, operacion) {
    const falla = (0, wsaa_1.extraerTag)(xml, 'faultstring');
    if (falla)
        throw new ArcaError(`${operacion}: ${falla}`);
    const errores = parsearErrores(xml);
    if (errores.length > 0) {
        const detalle = errores.map((e) => `[${e.code}] ${e.msg}`).join(' | ');
        throw new ArcaError(`${operacion} rechazado por ARCA: ${detalle}`, errores);
    }
}
async function llamar(cfg, operacion, cuerpo) {
    const doFetch = cfg.fetchImpl ?? httpArca_1.fetchArca;
    const resp = await doFetch(exports.WSFEV1_URL[cfg.ambiente], {
        method: 'POST',
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: `${NS}${operacion}`,
        },
        body: envolver(operacion, cuerpo),
    });
    const texto = await resp.text();
    // ARCA usa 500 para los SOAP Fault; el cuerpo explica mejor que el status.
    if (!resp.ok && !texto.includes('faultstring')) {
        throw new ArcaError(`${operacion}: HTTP ${resp.status}`);
    }
    verificarRespuesta(texto, operacion);
    return texto;
}
// ── Métodos ───────────────────────────────────────────────────────────────────
/**
 * Health check de la infraestructura de ARCA. No necesita autenticación.
 * Útil para distinguir "ARCA está caído" de "nuestro token está mal".
 */
async function feDummy(cfg) {
    const xml = await llamar(cfg, 'FEDummy', '');
    return {
        appServer: (0, wsaa_1.extraerTag)(xml, 'AppServer') ?? '',
        dbServer: (0, wsaa_1.extraerTag)(xml, 'DbServer') ?? '',
        authServer: (0, wsaa_1.extraerTag)(xml, 'AuthServer') ?? '',
    };
}
/**
 * Último número de comprobante autorizado para un punto de venta y tipo.
 *
 * Es la fuente de verdad de la correlatividad: el número lo lleva el emisor,
 * ARCA solo valida que no haya saltos ni repeticiones. El próximo a emitir es
 * este + 1.
 */
async function feCompUltimoAutorizado(cfg, ptoVta, cbteTipo) {
    const cuerpo = [
        tagsAuth(cfg.credenciales),
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
    ].join('');
    const xml = await llamar(cfg, 'FECompUltimoAutorizado', cuerpo);
    return Number((0, wsaa_1.extraerTag)(xml, 'CbteNro') ?? 0);
}
/**
 * Consulta un comprobante ya emitido.
 *
 * Es la pieza central de la idempotencia: si se cortó la red después de pedir
 * un CAE, el comprobante puede haber quedado autorizado igual. Antes de
 * reintentar hay que preguntar por ese número — reintentar a ciegas puede
 * generar un duplicado, que es un problema fiscal, no un bug.
 */
async function feCompConsultar(cfg, ptoVta, cbteTipo, cbteNro) {
    const cuerpo = [
        tagsAuth(cfg.credenciales),
        '<ar:FeCompConsReq>',
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
        `<ar:CbteNro>${cbteNro}</ar:CbteNro>`,
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
        '</ar:FeCompConsReq>',
    ].join('');
    try {
        const xml = await llamar(cfg, 'FECompConsultar', cuerpo);
        const cae = (0, wsaa_1.extraerTag)(xml, 'CodAutorizacion') ?? (0, wsaa_1.extraerTag)(xml, 'CAE');
        if (!cae)
            return { existe: false };
        return {
            existe: true,
            cae,
            caeFchVto: (0, wsaa_1.extraerTag)(xml, 'FchVto') ?? (0, wsaa_1.extraerTag)(xml, 'CAEFchVto') ?? undefined,
            cbteFch: (0, wsaa_1.extraerTag)(xml, 'CbteFch') ?? undefined,
            impTotal: Number((0, wsaa_1.extraerTag)(xml, 'ImpTotal') ?? 0) || undefined,
        };
    }
    catch (e) {
        // 602 = "No existen datos en nuestros registros": el comprobante no está
        // emitido. Es una respuesta válida a esta pregunta, no una falla.
        if (e instanceof ArcaError && e.errores.some((x) => x.code === 602)) {
            return { existe: false };
        }
        throw e;
    }
}
/**
 * Consulta una tabla de referencia de ARCA.
 *
 * Estas listas (tipos de tributo, alícuotas de IVA, tipos de comprobante…) son
 * la fuente autoritativa: el manual no las fija, justamente para que puedan
 * cambiar. Conviene consultarlas en vez de hardcodear códigos — un `Id` de
 * tributo equivocado es un comprobante mal informado.
 */
async function feParamGet(cfg, operacion, tagItem) {
    const xml = await llamar(cfg, operacion, tagsAuth(cfg.credenciales));
    return extraerTodos(xml, tagItem).map((item) => ({
        id: (0, wsaa_1.extraerTag)(item, 'Id') ?? '',
        desc: (0, wsaa_1.extraerTag)(item, 'Desc') ?? '',
    }));
}
const feParamGetTiposTributos = (cfg) => feParamGet(cfg, 'FEParamGetTiposTributos', 'TributoTipo');
exports.feParamGetTiposTributos = feParamGetTiposTributos;
const feParamGetTiposIva = (cfg) => feParamGet(cfg, 'FEParamGetTiposIva', 'IvaTipo');
exports.feParamGetTiposIva = feParamGetTiposIva;
const feParamGetTiposCbte = (cfg) => feParamGet(cfg, 'FEParamGetTiposCbte', 'CbteTipo');
exports.feParamGetTiposCbte = feParamGetTiposCbte;
const feParamGetCondicionIvaReceptor = (cfg) => feParamGet(cfg, 'FEParamGetCondicionIvaReceptor', 'CondicionIvaReceptor');
exports.feParamGetCondicionIvaReceptor = feParamGetCondicionIvaReceptor;
/** Puntos de venta habilitados para facturación electrónica por web service. */
async function feParamGetPtosVenta(cfg) {
    const xml = await llamar(cfg, 'FEParamGetPtosVenta', tagsAuth(cfg.credenciales));
    return extraerTodos(xml, 'PtoVenta').map((p) => ({
        nro: (0, wsaa_1.extraerTag)(p, 'Nro') ?? '',
        emisionTipo: (0, wsaa_1.extraerTag)(p, 'EmisionTipo') ?? '',
        bloqueado: (0, wsaa_1.extraerTag)(p, 'Bloqueado') ?? '',
        fechaBaja: (0, wsaa_1.extraerTag)(p, 'FchBaja') ?? '',
    }));
}
function tagsDetalle(d) {
    const iva = d.Iva.map((i) => ['<ar:AlicIva>',
        `<ar:Id>${i.Id}</ar:Id>`,
        `<ar:BaseImp>${i.BaseImp}</ar:BaseImp>`,
        `<ar:Importe>${i.Importe}</ar:Importe>`,
        '</ar:AlicIva>'].join('')).join('');
    // Percepciones y demás tributos. ARCA valida que la suma de los importes
    // coincida con ImpTrib (validación 10029).
    const tributos = (d.Tributos ?? []).map((t) => ['<ar:Tributo>',
        `<ar:Id>${t.Id}</ar:Id>`,
        t.Desc ? `<ar:Desc>${escaparXml(t.Desc)}</ar:Desc>` : '',
        `<ar:BaseImp>${t.BaseImp}</ar:BaseImp>`,
        `<ar:Alic>${t.Alic}</ar:Alic>`,
        `<ar:Importe>${t.Importe}</ar:Importe>`,
        '</ar:Tributo>'].join('')).join('');
    return [
        '<ar:FECAEDetRequest>',
        `<ar:Concepto>${d.Concepto}</ar:Concepto>`,
        `<ar:DocTipo>${d.DocTipo}</ar:DocTipo>`,
        `<ar:DocNro>${d.DocNro}</ar:DocNro>`,
        `<ar:CbteDesde>${d.CbteDesde}</ar:CbteDesde>`,
        `<ar:CbteHasta>${d.CbteHasta}</ar:CbteHasta>`,
        `<ar:CbteFch>${d.CbteFch}</ar:CbteFch>`,
        `<ar:ImpTotal>${d.ImpTotal}</ar:ImpTotal>`,
        `<ar:ImpTotConc>${d.ImpTotConc}</ar:ImpTotConc>`,
        `<ar:ImpNeto>${d.ImpNeto}</ar:ImpNeto>`,
        `<ar:ImpOpEx>${d.ImpOpEx}</ar:ImpOpEx>`,
        `<ar:ImpTrib>${d.ImpTrib}</ar:ImpTrib>`,
        `<ar:ImpIVA>${d.ImpIVA}</ar:ImpIVA>`,
        `<ar:MonId>${d.MonId}</ar:MonId>`,
        `<ar:MonCotiz>${d.MonCotiz}</ar:MonCotiz>`,
        `<ar:CondicionIVAReceptorId>${d.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>`,
        tributos ? `<ar:Tributos>${tributos}</ar:Tributos>` : '',
        iva ? `<ar:Iva>${iva}</ar:Iva>` : '',
        '</ar:FECAEDetRequest>',
    ].join('');
}
/**
 * Pide el CAE de un comprobante.
 *
 * Se manda de a UN comprobante por request a propósito, aunque el servicio
 * acepte lotes: cada venta se resuelve por su cuenta, y un rechazo no arrastra
 * a las demás. El volumen de la venta en calle no justifica el lote.
 */
async function feCaeSolicitar(cfg, ptoVta, cbteTipo, detalle) {
    const cuerpo = [
        tagsAuth(cfg.credenciales),
        '<ar:FeCAEReq>',
        '<ar:FeCabReq>',
        '<ar:CantReg>1</ar:CantReg>',
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
        '</ar:FeCabReq>',
        `<ar:FeDetReq>${tagsDetalle(detalle)}</ar:FeDetReq>`,
        '</ar:FeCAEReq>',
    ].join('');
    const xml = await llamar(cfg, 'FECAESolicitar', cuerpo);
    const det = (0, wsaa_1.extraerTag)(xml, 'FECAEDetResponse') ?? xml;
    const resultado = ((0, wsaa_1.extraerTag)(det, 'Resultado') ?? (0, wsaa_1.extraerTag)(xml, 'Resultado') ?? 'R');
    const cae = (0, wsaa_1.extraerTag)(det, 'CAE');
    const observaciones = parsearObservaciones(det);
    if (resultado === 'R' || !cae) {
        const detalleObs = observaciones.map((o) => `[${o.code}] ${o.msg}`).join(' | ');
        throw new ArcaError(`ARCA rechazó el comprobante${detalleObs ? `: ${detalleObs}` : ''}`, observaciones);
    }
    return {
        resultado,
        cae,
        caeFchVto: (0, wsaa_1.extraerTag)(det, 'CAEFchVto'),
        cbteDesde: Number((0, wsaa_1.extraerTag)(det, 'CbteDesde') ?? detalle.CbteDesde),
        observaciones,
    };
}
//# sourceMappingURL=wsfev1.js.map