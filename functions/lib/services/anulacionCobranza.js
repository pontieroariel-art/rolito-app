"use strict";
/**
 * Anulación de un recibo de cobranza con autorización (2026-09-15) — lógica pura
 * del circuito, separada del trigger para poder testearla.
 *
 * El que cobró pide (`anulacionesCobranza/{cobranzaId}`), quien tiene
 * `autorizaAnulaciones` aprueba o rechaza, y el server marca la cobranza
 * (`cobranzas.anulacion`, que el cliente no puede escribir). Un recibo anulado
 * deja de contar en rendición, liquidación, tesorería y saldos. En Tango lo anula
 * la oficina (push a facturación) hasta que exista el writer SQL; el lector de
 * comprobantes lo confirma cuando ve el recibo con ESTADO 'ANU'.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.motivoLegible = void 0;
exports.transicionRecibo = transicionRecibo;
exports.avisoSolicitudRecibo = avisoSolicitudRecibo;
exports.urlDelCobrador = urlDelCobrador;
exports.urlReemitirRecibo = urlReemitirRecibo;
exports.marcaAnulada = marcaAnulada;
exports.avisoAnularEnTango = avisoAnularEnTango;
exports.reciboAnuladoEnIndice = reciboAnuladoEnIndice;
/**
 * Qué hacer ante un cambio de la solicitud. Pura.
 *   pendiente|error → aprobada   anular el recibo
 *   pendiente       → rechazada  reflejar el rechazo y avisar al cobrador
 *   rechazada       → pendiente  volvió a pedir: avisar de nuevo
 */
function transicionRecibo(antes, despues) {
    const a = antes?.estado;
    const d = despues?.estado;
    if (a === d)
        return null;
    if (d === 'aprobada' && (a === 'pendiente' || a === 'error'))
        return 'anular';
    if (d === 'rechazada' && a === 'pendiente')
        return 'rechazar';
    if (d === 'pendiente' && a === 'rechazada')
        return 'resolicitar';
    return null;
}
const pesos = (n) => `$${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const txt = (v) => String(v ?? '').trim();
const MOTIVOS = {
    cheque_equivocado: 'datos del cheque equivocados',
    importe_equivocado: 'importe equivocado',
    cliente_equivocado: 'cliente equivocado',
    facturas_equivocadas: 'facturas imputadas equivocadas',
    medio_equivocado: 'medio de pago equivocado',
    otro: 'otro motivo',
};
const motivoLegible = (m) => MOTIVOS[txt(m)] ?? txt(m);
exports.motivoLegible = motivoLegible;
/** Texto de la push a los autorizantes. */
function avisoSolicitudRecibo(a) {
    const quien = txt(a.origen) === 'supervisor' ? 'supervisor' : txt(a.origen) === 'cobrador' ? 'chofer' : 'mostrador';
    return {
        titulo: 'Anulación de recibo por autorizar',
        cuerpo: `Recibo ${txt(a.numeroRecibo) || 'sin número'} · ${txt(a.clienteNombre) || 'cliente'} · ${pesos(a.importe)} · ${(0, exports.motivoLegible)(a.motivo)}${txt(a.nota) ? ` · ${txt(a.nota)}` : ''} (pidió ${txt(a.solicitadoPor?.nombre) || quien})`,
    };
}
/** A dónde vuelve el que cobró cuando le contestan, y a dónde va "Hacer el recibo correcto". */
function urlDelCobrador(a) {
    const o = txt(a.origen);
    return o === 'supervisor' ? '/supervisor' : o === 'cobrador' ? '/chofer/cobrar' : '/caja/cobranzas';
}
function urlReemitirRecibo(a, cobranzaId) {
    const o = txt(a.origen);
    const base = o === 'supervisor' ? '/supervisor/cobrar' : o === 'cobrador' ? '/chofer/cobrar' : '/caja/cobranzas';
    return `${base}?reemitir=${cobranzaId}`;
}
/** Lo que queda escrito en `cobranzas.anulacion` al aprobarse. `ahora` lo pone el trigger (Timestamp). */
function marcaAnulada(a, cobranzaId, ahora) {
    const enTango = txt(a.reciboTango) !== '';
    return {
        estado: 'anulada',
        solicitudId: cobranzaId,
        motivo: txt(a.motivo),
        nota: txt(a.nota),
        anuladaPor: { uid: txt(a.resueltaPor?.uid), nombre: txt(a.resueltaPor?.nombre) },
        anuladaEn: ahora,
        fechaCobranza: txt(a.fechaCobranza),
        // Si el recibo nunca llegó a Tango no hay nada que anular allá.
        tango: { estado: enTango ? 'pendiente_oficina' : 'no_aplica' },
    };
}
/** Texto de la push a facturación cuando hay que anular el recibo en Tango a mano. */
function avisoAnularEnTango(a) {
    return {
        titulo: 'Anular un recibo en Tango',
        cuerpo: `Recibo ${txt(a.reciboTango)} (${txt(a.numeroRecibo)}) de ${txt(a.clienteNombre)} por ${pesos(a.importe)}: anulado en la app con autorización de ${txt(a.resueltaPor?.nombre)}. Anularlo en Tango (cta. cte. y tesorería).`,
    };
}
/**
 * ¿El índice de comprobantes de Tango ya muestra el recibo anulado? El lector
 * publica cada GVA12 bajo `facturas[TIPO_NUMERO]` con su ESTADO; un recibo
 * anulado queda 'ANU'.
 */
function reciboAnuladoEnIndice(indice, reciboTango) {
    const clave = `REC_${reciboTango.trim().toUpperCase()}`;
    return String(indice?.facturas?.[clave]?.estado ?? '').trim().toUpperCase() === 'ANU';
}
//# sourceMappingURL=anulacionCobranza.js.map