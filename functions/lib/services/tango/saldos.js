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
function descuentosDeCobranzas(cobranzas) {
    const porCliente = new Map();
    for (const c of cobranzas) {
        if (c.tango?.estado === 'confirmado')
            continue;
        if (!Array.isArray(c.imputaciones) || c.imputaciones.length === 0)
            continue;
        const empresa = (0, empresas_1.esEmpresa)(c.empresa) ? c.empresa : 'redonhielo';
        if (!porCliente.has(c.clienteId))
            porCliente.set(c.clienteId, { porComprobante: new Map(), cobranzaIds: [] });
        const d = porCliente.get(c.clienteId);
        d.cobranzaIds.push(c.id);
        for (const imp of c.imputaciones) {
            const clave = (0, exports.claveComprobante)(empresa, String(imp.comprobanteTipo ?? ''), String(imp.comprobanteNumero ?? ''));
            const cent = Math.round(Number(imp.importeImputado ?? 0) * 100);
            d.porComprobante.set(clave, (d.porComprobante.get(clave) ?? 0) + cent);
        }
    }
    return porCliente;
}
/** Resta los descuentos a los comprobantes (por empresa+tipo+número) y descarta los que quedan en 0. */
function aplicarDescuentos(comprobantes, descuento) {
    if (!descuento || descuento.porComprobante.size === 0)
        return comprobantes;
    return comprobantes
        .map((c) => {
        const cent = descuento.porComprobante.get((0, exports.claveComprobante)(c.empresa, c.tipo, c.numero));
        if (!cent)
            return c;
        return { ...c, saldoPendiente: Math.max(0, Math.round(c.saldoPendiente * 100) - cent) / 100 };
    })
        .filter((c) => c.saldoPendiente > 0);
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
    const descuento = descuentosDeCobranzas([{ id: cobranza.id, clienteId: '-', empresa: cobranza.empresa, imputaciones: cobranza.imputaciones }]).get('-');
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