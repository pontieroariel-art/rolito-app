"use strict";
// Espejo de src/utils/entregaFabrica.ts (productosFabricaTopeados): misma regla del
// lado del servidor. Al tocar uno, tocar el otro (tests iguales en los dos lados).
Object.defineProperty(exports, "__esModule", { value: true });
exports.productosFabricaTopeados = productosFabricaTopeados;
/**
 * Tope de la entrega con remito de fábrica a lo que tenía el pedido (2026-09-26,
 * auditoría del chofer, C4). Las reglas no pueden comparar las cantidades
 * contra el pedido, así que el que la lee (la cuenta de mercadería del viaje,
 * la revisión de la descarga y lo que va al 98 en Tango) nunca toma más de lo
 * pedido: una cantidad inflada hacía "desaparecer" mercadería sin faltante.
 * Un producto que el pedido no tiene por código solo puede usar las unidades
 * de los renglones del pedido que no traen código (pedidos cargados por nombre).
 * Lo que excede queda como faltante en la descarga, que es donde se controla.
 */
function productosFabricaTopeados(pedido, entregados) {
    const porId = new Map();
    let sinCodigo = 0;
    for (const p of pedido ?? []) {
        const q = Number(p?.quantity) || 0;
        if (q <= 0)
            continue;
        if (typeof p.productoId === 'string' && p.productoId)
            porId.set(p.productoId, (porId.get(p.productoId) ?? 0) + q);
        else
            sinCodigo += q;
    }
    let excedido = false;
    const productos = (entregados ?? []).map((e) => {
        const pedida = porId.get(e.productoId);
        let tope;
        if (pedida !== undefined) {
            tope = pedida;
            porId.set(e.productoId, 0);
        }
        else {
            tope = sinCodigo;
            sinCodigo = 0;
        }
        const cantidad = Math.max(0, Math.min(Number(e.cantidad) || 0, tope));
        if (cantidad !== e.cantidad)
            excedido = true;
        if (pedida !== undefined)
            porId.set(e.productoId, Math.max(0, pedida - cantidad));
        else
            sinCodigo = Math.max(0, tope - cantidad);
        return { ...e, cantidad };
    });
    return { productos, excedido };
}
//# sourceMappingURL=entregaFabricaTope.js.map