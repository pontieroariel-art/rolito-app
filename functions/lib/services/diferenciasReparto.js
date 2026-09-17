"use strict";
// Faltante de mercadería de una liquidación cerrada, por producto, tal como va a
// Tango (fase B del stock, aprobada por Ariel el 2026-09-17): lo que el chofer no
// puede justificar sale del camión al depósito 98 DIFERENCIAS DE REPARTO.
//
//   faltante = carga − ventas − rotas contadas por el muelle − descarga sana
//
// OJO: no es la `diferencia` que muestra la app (descarga − devolución teórica,
// donde la teórica descuenta los CAMBIOS que registró el chofer). Con el modelo
// aprobado los cambios no mueven stock: la merma real es la bolsa rota que el
// muelle contó (camión → 99). Un cambio sin su rota es faltante, no merma.
//   Ejemplo de Ariel: carga 100, ventas 90, 5 cambios, 3 rotas, 4 sanas →
//   la app muestra diferencia −1; a Tango van 3 al 99 y 3 al 98.
// El sobrante (faltante negativo) no genera movimiento (decisión de Ariel).
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalCantidad = void 0;
exports.faltantesParaTango = faltantesParaTango;
exports.rotasPorProductoDe = rotasPorProductoDe;
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/**
 * Renglones para la transferencia camión → 98. `rotasPorProducto` reemplaza (o
 * completa) `p.rotas` cuando el cierre no lo trae (front viejo): se calcula
 * desde las descargas del cierre.
 */
function faltantesParaTango(productos, rotasPorProducto = {}) {
    const out = [];
    for (const p of productos ?? []) {
        if (!p?.productoId)
            continue;
        const rotas = typeof p.rotas === 'number' ? n(p.rotas) : n(rotasPorProducto[p.productoId]);
        const faltante = n(p.carga) - n(p.ventaContado) - n(p.ventaPromo) - rotas - n(p.descarga);
        if (faltante > 0)
            out.push({ productoId: p.productoId, nombre: p.nombre ?? p.productoId, cantidad: faltante });
    }
    return out;
}
/** Rotas por producto sumadas de las descargas de un cierre (docs de `descargasCamion`). */
function rotasPorProductoDe(descargas) {
    const acum = {};
    for (const d of descargas)
        for (const r of d.bolsasRotas ?? []) {
            if (!r?.productoId)
                continue;
            acum[r.productoId] = (acum[r.productoId] ?? 0) + n(r.cantidad);
        }
    return acum;
}
/** Suma de cantidades de una lista de renglones (rotas de una descarga, cambios de una venta). */
const totalCantidad = (items) => (items ?? []).reduce((s, i) => s + n(i?.cantidad), 0);
exports.totalCantidad = totalCantidad;
//# sourceMappingURL=diferenciasReparto.js.map