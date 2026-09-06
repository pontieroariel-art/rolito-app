"use strict";
// Catálogo de DEPÓSITOS de Tango → app (2026-09-06). En Tango cada repartidor
// es un depósito en tránsito (03 SERGIO ALVAREZ … 55, tercerizados como NOAIN
// 01-06, supervisores 23/24/25); la expedición de la app (carga, descarga,
// liquidación) trabaja por depósito, con el usuario de la app como dato
// opcional. Ver docs/tango/INTEGRACION.md §27.
//
//   depositosTango/{codigo} = {
//     codigo, nombre, idSta22, inhabilitado, actualizadoEn,   ← Tango (esta sync)
//     tipo: 'repartidor' | 'planta' | 'interno',              ← editable en la app
//     activo: boolean,                                         ← editable en la app
//     uid?, usuarioNombre?, usuarioRol?                        ← editable en la app
//   }
//
// La sync escribe con merge: nunca pisa lo editable. Solo la primera vez que
// aparece un código le pone el tipo por defecto y activo = !inhabilitado.
// Los códigos son los mismos en Redonhielo y Rolito (verificado 2026-09-04),
// así que se lee una sola empresa.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tipoDefaultDeposito = tipoDefaultDeposito;
exports.recortarDeposito = recortarDeposito;
exports.sincronizarDepositosTango = sincronizarDepositosTango;
const firestore_1 = require("firebase-admin/firestore");
const client_1 = require("./client");
const pedido_1 = require("./pedido");
/** Códigos que no son personas: plantas y depósitos contables/especiales. */
const PLANTAS = new Set(['01', '02']);
const INTERNOS = new Set(['26', '29', '81', '97', '98', '99']);
function tipoDefaultDeposito(codigo) {
    if (PLANTAS.has(codigo))
        return 'planta';
    if (INTERNOS.has(codigo))
        return 'interno';
    return 'repartidor';
}
function recortarDeposito(f) {
    const codigo = String((0, pedido_1.prop)(f, 'COD_STA22') ?? '').trim();
    const idSta22 = Number((0, pedido_1.prop)(f, 'ID_STA22'));
    if (!codigo || !Number.isInteger(idSta22))
        return null;
    return {
        codigo,
        nombre: String((0, pedido_1.prop)(f, 'NOMBRE_SUC') ?? '').trim(),
        idSta22,
        inhabilitado: (0, pedido_1.prop)(f, 'INHABILITA') === true,
    };
}
async function sincronizarDepositosTango(db, tango, cfg) {
    const company = cfg.companies?.redonhielo;
    if (!Number.isInteger(company))
        throw new Error('config/tango.companies.redonhielo no está configurado');
    const filas = (await tango.getAll(company, client_1.PROCESOS.depositos)).map(recortarDeposito).filter((d) => !!d);
    const existentes = new Set((await db.collection('depositosTango').select().get()).docs.map((d) => d.id));
    const resumen = { recibidos: filas.length, nuevos: 0, actualizados: 0, inhabilitados: 0 };
    let batch = db.batch(), ops = 0;
    for (const d of filas) {
        if (d.inhabilitado)
            resumen.inhabilitados++;
        const ref = db.doc(`depositosTango/${d.codigo}`);
        const base = { codigo: d.codigo, nombre: d.nombre, idSta22: d.idSta22, inhabilitado: d.inhabilitado, actualizadoEn: firestore_1.FieldValue.serverTimestamp() };
        if (existentes.has(d.codigo)) {
            batch.set(ref, base, { merge: true });
            resumen.actualizados++;
        }
        else {
            batch.set(ref, { ...base, tipo: tipoDefaultDeposito(d.codigo), activo: !d.inhabilitado, uid: null, usuarioNombre: null, usuarioRol: null, creadoEn: firestore_1.FieldValue.serverTimestamp() });
            resumen.nuevos++;
        }
        if (++ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
        }
    }
    if (ops)
        await batch.commit();
    return resumen;
}
//# sourceMappingURL=depositos.js.map