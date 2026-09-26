"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMPOS_FICHA = void 0;
exports.soloLoQueCambia = soloLoQueCambia;
const firestore_1 = require("firebase-admin/firestore");
// Sync de clientes de Tango (2026-09-26): escribir solo lo que cambió.
// Hasta acá la corrida reescribía las 6.500 fichas cada vez (con la hora de la
// sync, que nadie lee), y cada escritura disparaba onClienteIndexado. Para poder
// correrla más seguido (pedido de los choferes: que la condición de venta de
// Tango llegue en el día) se descartan los campos de la ficha que vienen iguales.
//
// Solo se filtran los campos de FICHA, que el sync pone siempre. Los demás
// (tangoIds.*, habilitadoTango.*, codigoTango, idGva14Tango, addresses, email) el
// sync los agrega únicamente cuando ya detectó un cambio y además actualiza el
// perfil en memoria al hacerlo: compararlos contra ese perfil los borraría.
exports.CAMPOS_FICHA = [
    'razonSocial', 'condicionVenta', 'categoriaIvaTango', 'categoriaIvaTangoDesc', 'codVendedor',
    'domicilioTango', 'localidadTango', 'provinciaTango', 'codigoPostalTango', 'fechaAlta', 'telefono',
];
const CLAVE_HORA_SYNC = 'tangoUltimaSync';
function iguales(a, b) {
    if (a instanceof firestore_1.Timestamp || b instanceof firestore_1.Timestamp) {
        return a instanceof firestore_1.Timestamp && b instanceof firestore_1.Timestamp && a.isEqual(b);
    }
    if (a === b)
        return true;
    if (a == null || b == null)
        return false;
    if (typeof a === 'object' || typeof b === 'object')
        return JSON.stringify(a) === JSON.stringify(b);
    return false;
}
/**
 * Devuelve la actualización sin los campos de ficha que ya están iguales en el
 * perfil, o `null` si no queda nada para escribir más que la hora de la sync.
 */
function soloLoQueCambia(update, perfil) {
    const out = {};
    for (const [k, v] of Object.entries(update)) {
        if (exports.CAMPOS_FICHA.includes(k) && iguales(v, perfil[k]))
            continue;
        out[k] = v;
    }
    return Object.keys(out).some((k) => k !== CLAVE_HORA_SYNC) ? out : null;
}
//# sourceMappingURL=cambiosCliente.js.map