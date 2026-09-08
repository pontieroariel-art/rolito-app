"use strict";
// Cache de composición de saldos por cliente, con las DOS empresas de Tango en
// el mismo doc (saldosTango/{uid}, uid del cliente). Lógica pura, sin Firestore,
// para poder testearla: la escritura la hacen tangoSaldos.ts (sync completa),
// tangoConsultas.ts (refresh on-demand de UNA empresa) y tangoOutbox.ts
// (descuento optimista al registrar una cobranza).
//
// Forma del doc (2026-09-06, decisión de Ariel: "dos bloques separados, cada
// cobranza impacta en la empresa a la que pertenece"):
//
//   { idGva14, codigoTango, razonSocial,           // legacy: principal de Redonhielo
//     comprobantes: [ {…, empresa, codigoTango} ], // UNIÓN de las dos empresas
//     saldoTotal,                                  // Σ de las dos (la lista de deudores ordena por esto)
//     porEmpresa: { redonhielo: { saldoTotal, runId, origen, actualizadoEn }, rolito: {…} },
//     cobranzasAplicadas: [ids], actualizadoEn, origen, runId }
//
// Cada empresa se reemplaza por separado: la corrida de Rolito no pisa lo de
// Redonhielo y viceversa. `runId` es por empresa: al terminar la corrida
// completa de una empresa, los docs cuya rama no fue tocada se vacían solo en
// esa rama (el cliente dejó de deber ahí).
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumaSaldo = exports.claveComprobante = exports.redondear2 = void 0;
exports.normalizarComprobante = normalizarComprobante;
exports.comprobantesDe = comprobantesDe;
exports.comprobanteACuenta = comprobanteACuenta;
exports.descuentosDeCobranzas = descuentosDeCobranzas;
exports.aplicarDescuentos = aplicarDescuentos;
exports.fusionarRamaEmpresa = fusionarRamaEmpresa;
exports.vaciarRamaEmpresa = vaciarRamaEmpresa;
exports.descontarCobranza = descontarCobranza;
const empresas_1 = require("./empresas");
const redondear2 = (n) => Math.round(n * 100) / 100;
exports.redondear2 = redondear2;
const claveComprobante = (empresa, tipo, numero) => `${empresa}|${tipo}|${numero}`;
exports.claveComprobante = claveComprobante;
function normalizarComprobante(c, empresa, codigoTango) {
    const venc = c.fechaVencimiento;
    const idc = c.idComprobanteTango;
    const dias = c.diasAtraso;
    return {
        tipo: String(c.tipo ?? ''),
        numero: String(c.numero ?? ''),
        fechaEmision: String(c.fechaEmision ?? ''),
        ...(venc ? { fechaVencimiento: String(venc) } : {}),
        importeOriginal: (0, exports.redondear2)(Number(c.importeOriginal ?? c.saldoPendiente ?? 0)),
        saldoPendiente: (0, exports.redondear2)(Number(c.saldoPendiente ?? 0)),
        ...(typeof idc === 'number' ? { idComprobanteTango: idc } : {}),
        ...(typeof dias === 'number' && dias > 0 ? { diasAtraso: dias } : {}),
        empresa,
        codigoTango: String(c.codigoTango ?? codigoTango ?? ''),
    };
}
/** Comprobantes de un doc existente (tolera docs viejos sin `empresa` en cada fila: eran de Redonhielo). */
function comprobantesDe(doc) {
    const lista = Array.isArray(doc?.comprobantes) ? doc.comprobantes : [];
    return lista.map((c) => normalizarComprobante(c, (0, empresas_1.esEmpresa)(c.empresa) ? c.empresa : 'redonhielo', String(c.codigoTango ?? doc?.codigoTango ?? '')));
}
const sumaSaldo = (comprobantes) => (0, exports.redondear2)(comprobantes.reduce((s, c) => s + c.saldoPendiente, 0));
exports.sumaSaldo = sumaSaldo;
/** Timestamp de Firestore / Date / string → 'yyyy-MM-dd' (vacío si no se puede). */
function fechaIso(f) {
    let d = null;
    if (f instanceof Date)
        d = f;
    else if (f && typeof f === 'object') {
        const o = f;
        if (typeof o.toDate === 'function')
            d = o.toDate();
        else if (typeof (o.seconds ?? o._seconds) === 'number')
            d = new Date(Number(o.seconds ?? o._seconds) * 1000);
    }
    else if (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f))
        return f.slice(0, 10);
    if (!d || isNaN(d.getTime()))
        return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** El recibo a cuenta de una cobranza, como comprobante de saldo negativo (tipo 'REC', nº interno de la app). */
function comprobanteACuenta(c, empresa) {
    const aCuenta = (0, exports.redondear2)(Number(c.aCuenta ?? 0));
    if (!(aCuenta > 0))
        return null;
    return {
        tipo: 'REC', numero: typeof c.numeroRecibo === 'string' && c.numeroRecibo ? c.numeroRecibo : c.id,
        fechaEmision: fechaIso(c.fecha), importeOriginal: -aCuenta, saldoPendiente: -aCuenta,
        empresa, codigoTango: typeof c.codigoTango === 'string' ? c.codigoTango : '',
    };
}
function descuentosDeCobranzas(cobranzas) {
    const porCliente = new Map();
    for (const c of cobranzas) {
        if (c.tango?.estado === 'confirmado')
            continue;
        const imputaciones = Array.isArray(c.imputaciones) ? c.imputaciones : [];
        const empresa = (0, empresas_1.esEmpresa)(c.empresa) ? c.empresa : 'redonhielo';
        const aCuenta = comprobanteACuenta(c, empresa);
        if (imputaciones.length === 0 && !aCuenta)
            continue;
        if (!porCliente.has(c.clienteId))
            porCliente.set(c.clienteId, { porComprobante: new Map(), cobranzaIds: [], aCuenta: [] });
        const d = porCliente.get(c.clienteId);
        d.cobranzaIds.push(c.id);
        for (const imp of imputaciones) {
            const clave = (0, exports.claveComprobante)(empresa, String(imp.comprobanteTipo ?? ''), String(imp.comprobanteNumero ?? ''));
            const cent = Math.round(Number(imp.importeImputado ?? 0) * 100);
            d.porComprobante.set(clave, (d.porComprobante.get(clave) ?? 0) + cent);
        }
        if (aCuenta)
            d.aCuenta.push(aCuenta);
    }
    return porCliente;
}
/** Resta los descuentos a los comprobantes (por empresa+tipo+número), descarta los que quedan en 0
 *  y agrega los recibos a cuenta pendientes (saldo negativo). Los comprobantes que ya vienen de
 *  Tango con saldo negativo (recibos a cuenta confirmados) se conservan tal cual. */
function aplicarDescuentos(comprobantes, descuento) {
    if (!descuento || (descuento.porComprobante.size === 0 && descuento.aCuenta.length === 0))
        return comprobantes;
    const restados = comprobantes
        .map((c) => {
        const cent = descuento.porComprobante.get((0, exports.claveComprobante)(c.empresa, c.tipo, c.numero));
        if (!cent)
            return c;
        return { ...c, saldoPendiente: Math.max(0, Math.round(c.saldoPendiente * 100) - cent) / 100 };
    })
        .filter((c) => c.saldoPendiente !== 0);
    const yaEstan = new Set(restados.map((c) => (0, exports.claveComprobante)(c.empresa, c.tipo, c.numero)));
    return [...restados, ...descuento.aCuenta.filter((a) => !yaEstan.has((0, exports.claveComprobante)(a.empresa, a.tipo, a.numero)))];
}
/**
 * Doc nuevo con los comprobantes de `empresa` reemplazados por `nuevos` y las
 * otras empresas intactas. `cobranzasAplicadas` se reemplaza por lo que se
 * descontó en esta pasada más lo que ya estaba aplicado de OTRAS empresas.
 */
function fusionarRamaEmpresa(actual, empresa, nuevos, meta, identidad = {}, cobranzasAplicadasEmpresa = []) {
    const otras = comprobantesDe(actual).filter((c) => c.empresa !== empresa);
    const propios = nuevos.map((c) => ({ ...c, empresa }));
    const comprobantes = [...otras, ...propios];
    const porEmpresa = { ...(actual?.porEmpresa ?? {}) };
    porEmpresa[empresa] = {
        saldoTotal: (0, exports.sumaSaldo)(propios),
        comprobantes: propios.length,
        runId: meta.runId,
        origen: meta.origen,
        ...(meta.ahora !== undefined ? { actualizadoEn: meta.ahora } : {}),
    };
    // Las cobranzas aplicadas de otras empresas se conservan: no se sabe cuáles
    // eran de cuál, así que se conservan todas las que no vinieron en esta pasada
    // (la lista solo sirve para no descontar dos veces la misma cobranza).
    const previas = Array.isArray(actual?.cobranzasAplicadas) ? actual.cobranzasAplicadas : [];
    const cobranzasAplicadas = [...new Set([...previas, ...cobranzasAplicadasEmpresa])];
    return {
        idGva14: identidad.idGva14 ?? actual?.idGva14 ?? 0,
        codigoTango: identidad.codigoTango ?? actual?.codigoTango ?? '',
        razonSocial: identidad.razonSocial ?? actual?.razonSocial ?? '',
        empresa: 'redonhielo',
        comprobantes,
        saldoTotal: (0, exports.sumaSaldo)(comprobantes),
        porEmpresa,
        cobranzasAplicadas,
        origen: meta.origen,
        ...(meta.runId ? { runId: meta.runId } : {}),
    };
}
/** Vacía la rama de una empresa (el cliente ya no debe nada ahí) conservando las otras. */
function vaciarRamaEmpresa(actual, empresa, runId, ahora) {
    return fusionarRamaEmpresa(actual, empresa, [], { runId, origen: 'sync', ahora });
}
/** Descuento optimista de UNA cobranza sobre el doc (misma empresa y tipo|número). */
function descontarCobranza(actual, cobranza) {
    const yaAplicadas = Array.isArray(actual.cobranzasAplicadas) ? actual.cobranzasAplicadas : [];
    if (yaAplicadas.includes(cobranza.id))
        return null;
    const descuento = descuentosDeCobranzas([{ clienteId: '-', ...cobranza }]).get('-');
    const comprobantes = aplicarDescuentos(comprobantesDe(actual), descuento);
    const porEmpresa = { ...(actual.porEmpresa ?? {}) };
    for (const e of empresas_1.EMPRESAS) {
        const propios = comprobantes.filter((c) => c.empresa === e);
        if (porEmpresa[e] || propios.length)
            porEmpresa[e] = { runId: null, origen: 'sync', ...(porEmpresa[e] ?? {}), saldoTotal: (0, exports.sumaSaldo)(propios), comprobantes: propios.length };
    }
    return { comprobantes, saldoTotal: (0, exports.sumaSaldo)(comprobantes), porEmpresa };
}
//# sourceMappingURL=saldos.js.map