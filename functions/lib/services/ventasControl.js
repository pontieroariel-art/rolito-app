"use strict";
/**
 * Control del total de una venta contra sus renglones (auditoría 2026-09-22).
 *
 * Las reglas de Firestore no iteran arrays, así que `total` nace atado a
 * `items` solo en el código del teléfono. Lo que se rinde en caja sale de
 * `total` (utils/importeCobrado.ts): una venta con ítems por $50.000 y
 * `total: 1` pedía $1 en la liquidación mientras el papel y Tango salían con
 * los ítems reales. Acá se recalcula del lado servidor y, si no cuadra, se
 * marca la venta y se avisa a la oficina. No se corrige el doc: la venta es
 * la prueba de lo que el chofer declaró.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.redondear2 = void 0;
exports.totalDeItems = totalDeItems;
exports.controlarTotal = controlarTotal;
exports.avisoTotalDistinto = avisoTotalDistinto;
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const redondear2 = (x) => Math.round(x * 100) / 100;
exports.redondear2 = redondear2;
/** Σ cantidad × precioUnitario de los renglones (los cambios van aparte y en $0). */
function totalDeItems(items) {
    if (!Array.isArray(items))
        return 0;
    return (0, exports.redondear2)(items.reduce((s, i) => s + n(i?.cantidad) * n(i?.precioUnitario), 0));
}
/**
 * `null` si el total declarado coincide con los renglones (tolerancia de $1
 * por redondeos); si no, el detalle para marcar la venta y avisar.
 */
function controlarTotal(venta, tolerancia = 1) {
    const esperado = totalDeItems(venta.items);
    const declarado = n(venta.total);
    const diferencia = (0, exports.redondear2)(declarado - esperado);
    if (Math.abs(diferencia) <= tolerancia)
        return null;
    return { declarado, esperado, diferencia };
}
const pesos = (x) => '$' + x.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function avisoTotalDistinto(coleccion, venta, d) {
    const quien = String(venta.choferNombre ?? venta.cajaNombre ?? '').trim();
    const donde = coleccion === 'ventasCamion' ? 'del camión' : 'de ventanilla';
    return {
        titulo: 'Venta con total que no cuadra',
        cuerpo: `Venta ${donde}${quien ? ` de ${quien}` : ''} a ${String(venta.clienteNombre ?? '')}: declara ${pesos(d.declarado)} y los renglones suman ${pesos(d.esperado)}. Revisar antes de liquidar.`,
    };
}
//# sourceMappingURL=ventasControl.js.map