"use strict";
// Las dos empresas de Tango y la identidad de un cliente en cada una.
//
// Redonhielo (Company 1, la oficial) y Rolito (Company 3, la promo) son bases
// separadas: un mismo cliente tiene en cada una su propio ID_GVA14 y, casi
// siempre, el mismo COD_GVA14. Desde el 2026-09-06 (decisión de Ariel: "Tango
// es la base maestra, las dos empresas") la ficha del cliente guarda la
// identidad por empresa en `tangoIds`:
//
//   users/{uid}.tangoIds = { redonhielo: [{ idGva14, codigo }], rolito: [{...}] }
//
// Es un array por empresa porque un CUIT puede tener varios códigos en Tango
// (sucursales / grupos empresarios) y la app tiene UNA cuenta por CUIT; el
// primero es el principal. Los campos viejos `idGva14Tango` / `codigoTango`
// siguen existiendo como alias del principal de Redonhielo (los usan precios,
// los writers de facturas, la UI); `tangoIdsDe` los absorbe cuando la ficha
// todavía no tiene `tangoIds` (cuentas que la sync no volvió a tocar).
Object.defineProperty(exports, "__esModule", { value: true });
exports.esEmpresa = exports.NOMBRE_EMPRESA = exports.EMPRESAS = void 0;
exports.tangoIdsDe = tangoIdsDe;
exports.idGva14De = idGva14De;
exports.codigoTangoDe = codigoTangoDe;
exports.agregarTangoId = agregarTangoId;
exports.EMPRESAS = ['redonhielo', 'rolito'];
exports.NOMBRE_EMPRESA = { redonhielo: 'Redonhielo S.A.', rolito: 'Rolito' };
const esEmpresa = (v) => v === 'redonhielo' || v === 'rolito';
exports.esEmpresa = esEmpresa;
function limpiarLista(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const x of v) {
        const idGva14 = Number(x?.idGva14);
        const codigo = String(x?.codigo ?? '').trim();
        if (Number.isInteger(idGva14) && idGva14 > 0 && codigo && !out.some((o) => o.idGva14 === idGva14))
            out.push({ idGva14, codigo });
    }
    return out;
}
/** Identidad Tango por empresa de una ficha, absorbiendo los campos legacy de Redonhielo. */
function tangoIdsDe(perfil) {
    const out = {};
    const raw = (perfil?.tangoIds ?? {});
    for (const empresa of exports.EMPRESAS) {
        const lista = limpiarLista(raw[empresa]);
        if (lista.length)
            out[empresa] = lista;
    }
    const idLegacy = Number(perfil?.idGva14Tango);
    const codLegacy = String(perfil?.codigoTango ?? '').trim();
    if (Number.isInteger(idLegacy) && idLegacy > 0 && codLegacy) {
        const rh = out.redonhielo ?? [];
        if (!rh.some((x) => x.idGva14 === idLegacy))
            out.redonhielo = [{ idGva14: idLegacy, codigo: codLegacy }, ...rh];
    }
    return out;
}
/** ID_GVA14 principal del cliente en una empresa (null si no está vinculado ahí). */
function idGva14De(perfil, empresa) {
    return tangoIdsDe(perfil)[empresa]?.[0]?.idGva14 ?? null;
}
/** COD_GVA14 principal del cliente en una empresa (null si no está vinculado ahí). */
function codigoTangoDe(perfil, empresa) {
    return tangoIdsDe(perfil)[empresa]?.[0]?.codigo ?? null;
}
/** Agrega (o reordena como principal) una identidad en la lista de una empresa; devuelve la lista nueva. */
function agregarTangoId(actual, nuevo, opts = {}) {
    const sin = (actual ?? []).filter((x) => x.idGva14 !== nuevo.idGva14);
    return opts.principal ? [nuevo, ...sin] : [...sin, nuevo];
}
//# sourceMappingURL=empresas.js.map