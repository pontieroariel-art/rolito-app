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
    claves.forEach((k, i) => mapa.set(k, snaps[i]?.data()));
    return mapa;
}
const confirmado = () => ({ anulacion: { tango: { estado: 'confirmado', en: firestore_1.FieldValue.serverTimestamp() } } });
/**
 * El estado del comprobante SUELTO, por número (2026-09-20).
 *
 * **Cuando Tango anula un comprobante le borra el cliente** (y el usuario, y
 * los renglones): el comprobante se muda al cajón `{empresa}_000000` y lo que
 * queda en la ficha del cliente es la entrada vieja, con el estado de antes.
 * Verificado sobre producción el 2026-09-20: los 254 recibos y los 3.778
 * remitos de ese cajón están TODOS en A / ANU, ni uno vivo.
 *
 * Por eso preguntarle a la ficha del cliente "¿está anulado?" no podía dar que
 * sí nunca, y ninguna de las dos listas de pendientes se iba a vaciar jamás.
 * La respuesta la tiene el doc POR comprobante que también escribe el lector,
 * cuya clave es el NÚMERO — y el número no depende de a qué cuenta fue a
 * parar. El índice del cliente queda como atajo barato que solo puede
 * confirmar; desmentir, no.
 */
async function estadoSuelto(db, empresa, tipo, numero) {
    const snap = await db.doc(`tangoComprobanteDetalle/${empresa}_${tipo}_${numero.trim().toUpperCase()}`).get();
    return snap.exists ? String(snap.data()?.estado ?? '').trim().toUpperCase() : '';
}
/** Remitos de cta. cte. anulados en la app: confirma los que Tango ya muestra con estado A. */
async function confirmarRemitosAnulados(db = (0, firestore_1.getFirestore)()) {
    // También los `encolado` (2026-09-20): si el bridge no los procesó —estaba
    // caído, la VM apagada— la venta no aparece en la lista de la oficina y se
    // volvería invisible. Acá se confirma igual apenas Tango los muestre
    // anulados, venga de donde venga la anulación.
    const pendientes = await db.collection('ventasCamion')
        .where('anulacion.tipo', '==', 'remito')
        .where('anulacion.tango.estado', 'in', ['pendiente_oficina', 'encolado'])
        .limit(200).get();
    // Un solo getAll: un cliente puede tener varios remitos pendientes.
    const codigos = [...new Set(pendientes.docs.map((d) => String(d.data().clienteCodigoTango ?? '').trim()).filter(Boolean))];
    const idx = await indices(db, codigos.map((c) => `redonhielo_${c}`));
    let confirmados = 0;
    for (const d of pendientes.docs) {
        const v = d.data();
        const codigo = String(v.clienteCodigoTango ?? '').trim();
        const numero = String(v.tango?.remitoNumero ?? '').trim();
        // Sin número no hay nada que buscar; sin código todavía queda el
        // comprobante suelto, que no depende de a qué cuenta fue el remito.
        if (!numero)
            continue;
        const enIndice = String(codigo
            ? idx.get(`redonhielo_${codigo}`)?.remitos?.[numero]?.estado ?? ''
            : '').trim().toUpperCase();
        // El índice del cliente solo puede CONFIRMAR, nunca desmentir: cuando
        // Tango anula un remito le borra el cliente, así que el remito se muda al
        // cajón `000000` y la entrada vieja queda en la ficha del cliente con su
        // estado desactualizado ('P' o 'F') para siempre. Mirando solo ahí, un
        // remito anulado no se confirma NUNCA. Por eso el comprobante suelto
        // —cuya clave es el número— decide igual aunque el índice diga otra cosa.
        const anulado = enIndice === 'A' || await estadoSuelto(db, 'redonhielo', 'REM', numero) === 'A';
        if (anulado) {
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
        // Igual que los remitos: el índice solo confirma, el comprobante suelto
        // decide (caso FERRANTE, anulado en Tango pero bajo el código 000000).
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