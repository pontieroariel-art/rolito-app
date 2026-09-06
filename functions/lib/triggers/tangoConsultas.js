"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onConsultaRespondida = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const empresas_1 = require("../services/tango/empresas");
const saldos_1 = require("../services/tango/saldos");
// Cuando se responde una consulta on-demand de saldo (tango-consultas, estado
// → 'respondida'), copia el resultado al cache saldosTango/{clienteUid}.
// Quien responde (onConsultaSaldoPendiente en la nube, o el bridge viejo)
// NUNCA escribe saldosTango directo — esta Function es el único camino, igual
// que onOutboxConfirmado con los write-backs del outbox.
//
// La consulta es de UNA empresa: se reemplaza solo esa rama del doc (la otra
// queda como la dejó su último sync), ver services/tango/saldos.ts.
exports.onConsultaRespondida = (0, firestore_1.onDocumentUpdated)('tango-consultas/{consultaId}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after)
        return;
    if (after.estado !== 'respondida' || before.estado === 'respondida')
        return;
    if (after.tipo !== 'saldoCliente')
        return;
    if (typeof after.clienteUid !== 'string' || !after.clienteUid)
        return;
    const db = (0, firestore_2.getFirestore)();
    const userSnap = await db.collection('users').doc(after.clienteUid).get();
    const user = userSnap.data();
    if (!user || user.rol !== 'cliente') {
        console.warn(`[onConsultaRespondida] ${event.params.consultaId}: clienteUid ${after.clienteUid} no es un cliente — se ignora`);
        return;
    }
    const empresa = (0, empresas_1.esEmpresa)(after.empresa) ? after.empresa : 'redonhielo';
    const codigoPrincipal = (0, empresas_1.codigoTangoDe)(user, empresa) ?? String(user.codigoTango ?? '');
    const crudos = Array.isArray(after.resultado?.comprobantes) ? after.resultado.comprobantes : [];
    const frescos = crudos.map((c) => (0, saldos_1.normalizarComprobante)(c, empresa, codigoPrincipal));
    // Igual que el sync periódico (tangoSaldos.ts): re-aplicar los descuentos de
    // cobranzas de este cliente que Tango todavía no vio (tango.estado !=
    // 'confirmado') — si no, el refresh "resucitaría" deuda ya cobrada en la calle.
    const desde = new Date();
    desde.setDate(desde.getDate() - 90);
    const cobranzasSnap = await db.collection('cobranzas')
        .where('clienteId', '==', after.clienteUid)
        .where('fecha', '>=', desde)
        .get();
    const descuento = (0, saldos_1.descuentosDeCobranzas)(cobranzasSnap.docs.map((d) => ({ id: d.id, ...d.data() }))).get(after.clienteUid);
    const comprobantes = (0, saldos_1.aplicarDescuentos)(frescos, descuento);
    // runId 'consulta': el sync periódico de esa empresa vacía las ramas cuyo
    // runId no es el de su corrida — si este cliente sigue con deuda, el próximo
    // sync la re-escribe con el runId nuevo; si no aparece en el snapshot
    // completo, es que ya no debe nada ahí y el vaciado es correcto.
    const ref = db.collection('saldosTango').doc(after.clienteUid);
    await db.runTransaction(async (tx) => {
        const actual = (await tx.get(ref)).data();
        const nuevo = (0, saldos_1.fusionarRamaEmpresa)(actual, empresa, comprobantes, { runId: 'consulta', origen: 'consulta', ahora: firestore_2.FieldValue.serverTimestamp() }, {
            idGva14: actual?.idGva14 ?? (typeof user.idGva14Tango === 'number' ? user.idGva14Tango : (typeof after.idGva14 === 'number' ? after.idGva14 : 0)),
            codigoTango: actual?.codigoTango ?? String(user.codigoTango ?? codigoPrincipal),
            razonSocial: actual?.razonSocial || String(user.razonSocial ?? user.nombre ?? ''),
        }, descuento ? descuento.cobranzaIds : []);
        tx.set(ref, { ...nuevo, actualizadoEn: firestore_2.FieldValue.serverTimestamp() });
    });
});
//# sourceMappingURL=tangoConsultas.js.map