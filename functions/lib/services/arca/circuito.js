"use strict";
/**
 * Qué documento le corresponde a una venta.
 *
 * La regla no es fiscal sino del negocio, y es la que decide si la app le pide
 * un CAE a ARCA o no. Está acá, sola y testeada, porque equivocarse tiene dos
 * costos caros y opuestos: facturar de más (una venta de cuenta corriente que
 * la oficina va a volver a facturar desde Tango) o no facturar una venta que
 * ya se cobró.
 *
 *   canal 'contado' = empresa REDONHIELO = oficial = ARCA
 *   canal 'promo'   = empresa ROLITO     = no oficial (comprobante propio)
 *
 * Dentro de contado manda la forma de pago:
 *
 *   efectivo / transferencia  → la app emite la factura electrónica
 *   cuenta corriente          → la app emite un remito, y la oficina factura
 *                               ESE remito desde Tango. Si la app además
 *                               facturara, la operación saldría dos veces.
 *
 * Y por encima de todo eso, el importe: una operación que no cobra nada —solo
 * cambios, la bolsa rota por una nueva— no tiene nada que facturar. Sale por
 * remito, que es lo que deja constancia de la mercadería que se movió.
 *
 * Ver docs/arca/FACTURACION_ELECTRONICA.md §11.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentoDeVenta = documentoDeVenta;
exports.facturaContraArca = facturaContraArca;
exports.destinoTango = destinoTango;
const FORMAS_QUE_FACTURAN = ['contado_efectivo', 'contado_transferencia'];
/**
 * Devuelve `null` cuando los datos de la venta no alcanzan para decidir (un
 * canal o una forma de pago que no conocemos). Quien llame tiene que tratar ese
 * caso como "no emitir todavía" y dejar rastro: emitir a ciegas es lo único
 * que no se puede deshacer.
 */
function documentoDeVenta(canal, formaPago, total) {
    if (canal === 'promo')
        return 'no_oficial';
    if (canal !== 'contado')
        return null;
    const importe = Number(total);
    // Un total que no es un número tampoco alcanza para decidir: puede ser una
    // venta a medio escribir, y ARCA rechaza un comprobante en cero de todos
    // modos.
    if (!Number.isFinite(importe))
        return null;
    if (importe <= 0)
        return 'remito';
    if (formaPago === 'cuenta_corriente')
        return 'remito';
    if (FORMAS_QUE_FACTURAN.includes(String(formaPago)))
        return 'factura_arca';
    return null;
}
/** Atajo para el trigger: ¿esta venta la factura la app contra ARCA? */
function facturaContraArca(canal, formaPago, total) {
    return documentoDeVenta(canal, formaPago, total) === 'factura_arca';
}
/**
 * A dónde va esta venta dentro de Tango.
 *
 * El canal elige la empresa (dos bases distintas, misma cartera de clientes) y
 * la forma de pago elige el comprobante. Devuelve `null` con los mismos datos
 * con los que `documentoDeVenta` no se anima a decidir.
 */
function destinoTango(canal, formaPago, total) {
    const documento = documentoDeVenta(canal, formaPago, total);
    if (documento === null)
        return null;
    if (documento === 'factura_arca') {
        return { entidad: 'factura', empresa: 'redonhielo', conCaePropio: true };
    }
    if (documento === 'remito') {
        return { entidad: 'remito', empresa: 'redonhielo', conCaePropio: false };
    }
    // Promo: mismo reparto por forma de pago, pero en Rolito y sin ARCA. La
    // numeración y el "CAE" son propios, así que nunca hay riesgo de duplicar
    // una autorización fiscal.
    const entidad = formaPago === 'cuenta_corriente' || Number(total) <= 0 ? 'remito' : 'factura';
    return { entidad, empresa: 'rolito', conCaePropio: false };
}
//# sourceMappingURL=circuito.js.map