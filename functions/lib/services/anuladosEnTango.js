"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmarRemitosAnulados = confirmarRemitosAnulados;
exports.confirmarRecibosAnulados = confirmarRecibosAnulados;
const firestore_1 = require("firebase-admin/firestore");
const anulacionCobranza_1 = require("./anulacionCobranza");
async function indices(db, claves) {
    const mapa = new Map();
    if (!claves.length)
        return mapa;
    const snaps = await db.getAll(...claves.map((k) => db.doc(`tangoComprobantes/${k}`)));
    snaps.forEach((s, i) => mapa.set(claves[i], s.data()));
    return mapa;
}
const confirmado = () => ({ anulacion: { tango: { estado: 'confirmado', en: firestore_1.FieldValue.serverTimestamp() } } });
/**
 * El estado del comprobante SUELTO, por número (2026-09-20).
 *
 * El índice del cliente alcanza para casi todo y es una lectura por cliente,
 * pero no siempre lo tiene: el recibo de FERRANTE estaba anulado en Tango
 * desde hacía cuatro días y la fila no se iba, porque Tango lo registró con el
 * código de cliente `000000` y la ficha de FC.583 no lo mostraba nunca. El
 * lector escribe además un doc POR comprobante, cuya clave es el número — y el
 * número no depende de a qué cuenta haya ido a parar. Se usa como respaldo:
 * una lectura extra solo para los que el índice no resuelve.
 */
async function estadoSuelto(db, empresa, tipo, numero) {
    const snap = await db.doc(`tangoComprobanteDetalle/${empresa}_${tipo}_${numero.trim().toUpperCase()}`).get();
    return snap.exists ? String(snap.data()?.estado ?? '').trim().toUpperCase() : '';
}
/** Remitos de cta. cte. anulados en la app: confirma los que Tango ya muestra con estado A. */
async function confirmarRemitosAnulados(db = (0, firestore_1.getFirestore)()) {
    const pendientes = await db.collection('ventasCamion')
        .where('anulacion.tipo', '==', 'remito')
        .where('anulacion.tango.estado', '==', 'pendiente_oficina')
        .limit(200).get();
    // Un solo getAll: un cliente puede tener varios remitos pendientes.
    const codigos = [...new Set(pendientes.docs.map((d) => String(d.data().clienteCodigoTango ?? '').trim()).filter(Boolean))];
    const idx = await indices(db, codigos.map((c) => `redonhielo_${c}`));
    let confirmados = 0;
    for (const d of pendientes.docs) {
        const v = d.data();
        const codigo = String(v.clienteCodigoTango ?? '').trim();
        const numero = String(v.tango?.remitoNumero ?? '').trim();
        // Sin número no hay nada que buscar; sin código todavía queda el respaldo
        // por comprobante, que no depende de a qué cuenta fue el remito.
        if (!numero)
            continue;
        const enIndice = codigo
            ? idx.get(`redonhielo_${codigo}`)?.remitos?.[numero]?.estado
            : undefined;
        const estado = String(enIndice ?? '').trim().toUpperCase() || await estadoSuelto(db, 'redonhielo', 'REM', numero);
        if (estado === 'A') {
            await d.ref.set(confirmado(), { merge: true });
            confirmados++;
        }
    }
    return { pendientes: pendientes.size, confirmados };
}
/** Recibos de cobranza anulados en la app: confirma los que Tango ya muestra con estado ANU. */
async function confirmarRecibosAnulados(db = (0, firestore_1.getFirestore)()) {
    const pendientes = await db.collection('cobranzas')
        .where('anulacion.tango.estado', '==', 'pendiente_oficina')
        .limit(200).get();
    const claveIdx = (c) => `${String(c.empresa ?? 'redonhielo')}_${String(c.codigoTango ?? '').trim()}`;
    const claves = [...new Set(pendientes.docs.map((d) => claveIdx(d.data())).filter((k) => !k.endsWith('_')))];
    const idx = await indices(db, claves);
    let confirmados = 0;
    for (const d of pendientes.docs) {
        const c = d.data();
        const recibo = String(c.tango?.reciboNumero ?? '').trim();
        if (!recibo)
            continue;
        const indice = idx.get(claveIdx(c));
        const empresa = String(c.empresa ?? 'redonhielo');
        // El índice del cliente primero; si no lo tiene, el comprobante suelto
        // (caso FERRANTE: anulado en Tango pero bajo el código 000000).
        const anulado = (0, anulacionCobranza_1.reciboAnuladoEnIndice)(indice, recibo)
            || await estadoSuelto(db, empresa, 'REC', recibo) === 'ANU';
        if (anulado) {
            await d.ref.set(confirmado(), { merge: true });
            await db.doc(`anulacionesCobranza/${d.id}`).set({ tango: { estado: 'confirmado', en: firestore_1.FieldValue.serverTimestamp() } }, { merge: true });
            confirmados++;
        }
    }
    return { pendientes: pendientes.size, confirmados };
}
//# sourceMappingURL=anuladosEnTango.js.map