"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOrderRollup = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
// ── Rollups de pedidos ────────────────────────────────────────────────────────
// Los tableros de gerencia calculaban sus KPIs (total del mes, tendencia de la
// semana, top de clientes) sobre subscribeAllOrders, que trae los pedidos de 30
// días con un limit(500): en temporada alta eso se supera y los números salían
// incompletos SIN avisar (auditoría 2026-08-29, hallazgo A1/H5). Este trigger
// mantiene un agregado diario en `rollupsPedidos/{YYYY-MM-DD}` que los tableros
// leen en vez de escanear todos los pedidos, y un `ultimoPedidoAt` por cliente
// para detectar clientes fríos sin depender de esa ventana.
const db = () => (0, firestore_2.getFirestore)();
// Argentina es UTC-3 fijo (sin horario de verano). El día de un pedido se toma
// en esa zona para que coincida con lo que ve el navegador del usuario (mismo
// criterio que rangoDiaArt en turnosVentanilla).
const OFFSET_ARG_MS = 3 * 60 * 60 * 1000;
function diaArg(ts) {
    return new Date(ts.toMillis() - OFFSET_ARG_MS).toISOString().slice(0, 10);
}
function rangoDiaArg(fechaStr) {
    const inicio = new Date(`${fechaStr}T00:00:00.000-03:00`);
    const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
    return [firestore_2.Timestamp.fromDate(inicio), firestore_2.Timestamp.fromDate(fin)];
}
const ESTADOS = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'];
// Recalcula (no incrementa) el rollup de un día leyendo sus pedidos. Recontar es
// robusto ante cualquier cambio —alta, cambio de estado/productos, baja, o un
// pedido que se mueve de fecha— sin la fragilidad de ajustar contadores a mano.
async function recalcularDia(fechaStr) {
    const [desde, hasta] = rangoDiaArg(fechaStr);
    const snap = await db().collection('orders')
        .where('date', '>=', desde)
        .where('date', '<', hasta)
        .get();
    const porEstado = { pendiente: 0, confirmado: 0, en_camino: 0, entregado: 0, cancelado: 0 };
    const porCliente = {};
    let total = 0;
    let bolsas = 0;
    let bolsasEntregadas = 0;
    for (const doc of snap.docs) {
        const o = doc.data();
        const estado = o.status && ESTADOS.includes(o.status) ? o.status : 'pendiente';
        porEstado[estado]++;
        if (estado === 'cancelado')
            continue;
        total++;
        const q = (o.products ?? []).reduce((s, p) => s + (p.quantity ?? 0), 0);
        bolsas += q;
        if (estado === 'entregado')
            bolsasEntregadas += q;
        if (o.clientId) {
            const c = porCliente[o.clientId] ?? (porCliente[o.clientId] = { nombre: o.clientName ?? '', bolsas: 0, pedidos: 0 });
            c.bolsas += q;
            c.pedidos++;
        }
    }
    await db().doc(`rollupsPedidos/${fechaStr}`).set({
        fecha: fechaStr, total, bolsas, bolsasEntregadas, porEstado, porCliente,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
}
// ultimoPedidoAt del cliente: monotónico (solo avanza). Sirve para "clientes
// fríos" (sin pedir hace N días) sin recorrer todos los pedidos. Se deja algo
// optimista a propósito: no retrocede ante una baja, y un cliente frío de más
// nunca es peor que uno de menos.
async function tocarUltimoPedido(clientId, date) {
    const ref = db().doc(`users/${clientId}`);
    await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            return;
        const actual = snap.data()?.ultimoPedidoAt;
        if (actual && actual.toMillis() >= date.toMillis())
            return;
        tx.update(ref, { ultimoPedidoAt: date });
    });
}
exports.onOrderRollup = (0, firestore_1.onDocumentWritten)('orders/{orderId}', async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    // Recalcular todos los días tocados (before y after pueden diferir si el
    // pedido cambió de fecha; en una baja solo hay before).
    const dias = new Set();
    if (before?.date)
        dias.add(diaArg(before.date));
    if (after?.date)
        dias.add(diaArg(after.date));
    for (const dia of dias)
        await recalcularDia(dia);
    const vigente = after ?? before;
    if (after && vigente?.clientId && vigente.date) {
        await tocarUltimoPedido(vigente.clientId, vigente.date);
    }
});
//# sourceMappingURL=rollups.js.map