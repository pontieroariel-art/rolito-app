"use strict";
/**
 * Aviso diario de rendiciones pendientes (2026-09-23, pedido de Ariel: "que
 * caja, tesorería y gerencia tengan un aviso diario de las liquidaciones que
 * no se liquidaron", a las 6, a las 13 y a las 18).
 *
 * Tres cosas que quedan colgadas si nadie las mira, y que ninguna pantalla
 * junta sola:
 *   1. VIAJES CON PLATA SIN LIQUIDAR: remitos de carga de los últimos 45 días
 *      sin `liquidaciones/{remitoId}`, y cobradores / supervisores con recibos
 *      de calle sin `liquidaciones/{fecha}_{uid}`.
 *   2. SOBRES SIN CONTAR: rendiciones a tesorería en 'pendiente_recepcion' o
 *      'entregada' (los anticipos nacen entregados).
 *   3. CAJAS DE OTRO DÍA SIN CERRAR: turnos 'abierta' con fecha anterior a hoy
 *      (bloquean el turno de hoy de ese cajero).
 *
 * Sale por push a caja, tesorería, gerencia y super_admin (rol principal o
 * adicional), por mail a la lista `avisos.rendicionesPendientes` y queda en
 * `config/avisoRendiciones` para que la app lo muestre en una franja. Nunca
 * frena nada: es un aviso (decisión de Ariel, 2026-09-18: la plata solo avisa).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.avisarRendicionesPendientes = void 0;
exports.calcularPendientes = calcularPendientes;
exports.textoAviso = textoAviso;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const push_1 = require("../services/push");
const email_1 = require("../email");
const templates_1 = require("../templates");
const vapidPublicKey = (0, params_1.defineSecret)('VAPID_PUBLIC_KEY');
const vapidPrivateKey = (0, params_1.defineSecret)('VAPID_PRIVATE_KEY');
const TZ = 'America/Argentina/Buenos_Aires';
const DIAS_ATRAS = 45;
const ROLES_AVISO = ['caja', 'tesoreria', 'gerente_general', 'super_admin'];
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const fechaLocal = (t) => t.toDate().toLocaleDateString('en-CA', { timeZone: TZ });
const diasEntre = (fecha, hoy) => Math.max(0, Math.round((new Date(hoy + 'T12:00:00Z').getTime() - new Date(fecha + 'T12:00:00Z').getTime()) / 86400000));
/** Qué existe de una lista de ids, de a 100 (tope de getAll cómodo). */
async function existentes(coleccion, ids) {
    const db = (0, firestore_1.getFirestore)();
    const out = new Set();
    const unicos = [...new Set(ids)];
    for (let i = 0; i < unicos.length; i += 100) {
        const refs = unicos.slice(i, i + 100).map((id) => db.collection(coleccion).doc(id));
        const snaps = await db.getAll(...refs);
        for (const s of snaps)
            if (s.exists)
                out.add(s.id);
    }
    return out;
}
/** Arma el resumen. Puro salvo las lecturas: se prueba con el emulador. */
async function calcularPendientes(hoy = hoyLocal()) {
    const db = (0, firestore_1.getFirestore)();
    const desdeStr = new Date(new Date(hoy + 'T12:00:00Z').getTime() - DIAS_ATRAS * 86400000).toISOString().slice(0, 10);
    const desde = firestore_1.Timestamp.fromDate(new Date(desdeStr + 'T03:00:00Z')); // 00:00 de Buenos Aires
    // 1. Viajes: un remito de carga sin su liquidación (id = remitoId desde el 18/09).
    const remitos = await db.collection('remitosCarga').where('fecha', '>=', desde).get();
    const cobranzas = await db.collection('cobranzas').where('fecha', '>=', desde).get();
    const viajesCandidatos = remitos.docs
        .filter((d) => d.data().estado !== 'anulado')
        .map((d) => ({ clave: d.id, nombre: String(d.data().choferNombre ?? d.data().choferId ?? ''), fecha: fechaLocal(d.data().fecha), codigo: d.data().codigo, choferId: String(d.data().choferId ?? ''), tipo: 'viaje' }));
    // Cobradores y supervisores: recibos de calle sin remito ese día → `{fecha}_{uid}`.
    const conRemito = new Set(viajesCandidatos.map((v) => `${v.fecha}_${v.choferId}`));
    const porDia = new Map();
    for (const d of cobranzas.docs) {
        const c = d.data();
        if (c.origen === 'caja' || c.anulacion?.estado === 'anulada')
            continue;
        if (typeof c.remitoId === 'string' && c.remitoId)
            continue;
        const uid = String(c.registradoPor?.uid ?? '');
        const fecha = fechaLocal(c.fecha);
        if (!uid || conRemito.has(`${fecha}_${uid}`))
            continue;
        porDia.set(`${fecha}_${uid}`, { nombre: String(c.registradoPor?.nombre ?? uid), fecha });
    }
    const claves = [...viajesCandidatos.map((v) => v.clave), ...porDia.keys()];
    const liquidadas = await existentes('liquidaciones', claves);
    const viajes = [
        ...viajesCandidatos.filter((v) => !liquidadas.has(v.clave)).map((v) => ({ clave: v.clave, nombre: v.nombre, fecha: v.fecha, codigo: v.codigo, dias: diasEntre(v.fecha, hoy), tipo: 'viaje' })),
        ...[...porDia.entries()].filter(([k]) => !liquidadas.has(k)).map(([k, x]) => ({ clave: k, nombre: x.nombre, fecha: x.fecha, dias: diasEntre(x.fecha, hoy), tipo: 'cobranzas' })),
    ]
        // Los de hoy no son "pendientes" a las 6 ni a las 13: el camión sigue en la calle.
        .filter((v) => v.fecha < hoy)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
    // 2. Sobres y anticipos sin contar.
    const pendientes = await db.collection('rendiciones').where('rindeA', '==', 'tesoreria').where('estado', 'in', ['pendiente_recepcion', 'entregada']).get();
    const ahora = Date.now();
    const sobres = pendientes.docs
        .filter((d) => typeof d.data().tipo === 'string')
        .map((d) => ({ id: d.id, codigo: String(d.data().codigo ?? d.id), nombre: String(d.data().rindio?.nombre ?? ''), fecha: String(d.data().fecha ?? ''), horas: Math.round((ahora - (d.data().cerradaEn?.toMillis() ?? ahora)) / 3_600_000), tipo: d.data().tipo === 'anticipo' ? 'anticipo' : 'sobre' }))
        .sort((a, b) => b.horas - a.horas);
    // 3. Cajas de otro día sin cerrar.
    const abiertas = await db.collection('cajaSesiones').where('estado', '==', 'abierta').where('fecha', '<', hoy).get();
    const cajas = abiertas.docs.map((d) => ({ id: d.id, nombre: String(d.data().cajero?.nombre ?? ''), fecha: String(d.data().fecha ?? '') }));
    return { generadoEn: firestore_1.Timestamp.now(), hoy, viajes, sobres, cajas, total: viajes.length + sobres.length + cajas.length };
}
/** Texto corto de la push. Puro. */
function textoAviso(r) {
    const partes = [];
    if (r.viajes.length)
        partes.push(`${r.viajes.length} ${r.viajes.length === 1 ? 'viaje sin liquidar' : 'viajes sin liquidar'} (${r.viajes.slice(0, 3).map((v) => v.nombre).join(', ')}${r.viajes.length > 3 ? '…' : ''})`);
    if (r.sobres.length)
        partes.push(`${r.sobres.length} ${r.sobres.length === 1 ? 'sobre sin contar' : 'sobres sin contar'}`);
    if (r.cajas.length)
        partes.push(`${r.cajas.length} ${r.cajas.length === 1 ? 'caja de otro día sin cerrar' : 'cajas de otro día sin cerrar'} (${r.cajas.map((c) => c.nombre).join(', ')})`);
    return { titulo: `Rendiciones pendientes: ${r.total}`, cuerpo: partes.join(' · ') };
}
async function usuariosDeRoles(roles) {
    const db = (0, firestore_1.getFirestore)();
    const [principal, extra] = await Promise.all([
        db.collection('users').where('estado', '==', 'activo').where('rol', 'in', roles).get(),
        db.collection('users').where('estado', '==', 'activo').where('rolesExtra', 'array-contains-any', roles).get(),
    ]);
    const vistos = new Set();
    return [...principal.docs, ...extra.docs].filter((d) => (vistos.has(d.id) ? false : (vistos.add(d.id), true)));
}
exports.avisarRendicionesPendientes = (0, scheduler_1.onSchedule)({ schedule: '0 6,13,18 * * *', timeZone: TZ, secrets: [...email_1.MAIL_SECRETS, vapidPublicKey, vapidPrivateKey], timeoutSeconds: 300, memory: '512MiB' }, async () => {
    const db = (0, firestore_1.getFirestore)();
    const r = await calcularPendientes();
    // La app lee esto en una franja (Mi turno, Sobres, Plata del día).
    await db.doc('config/avisoRendiciones').set(r);
    if (r.total === 0) {
        console.log('[avisosRendiciones] nada pendiente');
        return;
    }
    const aviso = textoAviso(r);
    try {
        const usuarios = await usuariosDeRoles(ROLES_AVISO);
        // Cada uno a SU pantalla de liquidaciones abiertas: caja no puede abrir la de tesorería.
        const esCaja = (d) => d.data().rol === 'caja' || (Array.isArray(d.data().rolesExtra) && d.data().rolesExtra.includes('caja') && !['tesoreria', 'gerente_general', 'super_admin'].includes(String(d.data().rol)));
        const claves = { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() };
        const [caja, oficina] = await Promise.all([
            (0, push_1.enviarPushAUsuarios)(usuarios.filter(esCaja), { ...aviso, url: '/caja/liquidaciones/abiertas' }, claves),
            (0, push_1.enviarPushAUsuarios)(usuarios.filter((d) => !esCaja(d)), { ...aviso, url: '/tesoreria/liquidaciones/abiertas' }, claves),
        ]);
        console.log(`[avisosRendiciones] push a ${caja.enviados + oficina.enviados} de ${usuarios.length} usuarios`);
    }
    catch (e) {
        console.error(`[avisosRendiciones] push falló: ${e.message}`);
    }
    try {
        const emails = await (0, email_1.destinatariosAviso)('rendicionesPendientes');
        if (emails.length)
            await (0, email_1.sendEmail)(emails, `${aviso.titulo} - Rolito`, (0, templates_1.tplRendicionesPendientes)(r, email_1.APP_URL));
    }
    catch (e) {
        console.error(`[avisosRendiciones] mail falló: ${e.message}`);
    }
});
//# sourceMappingURL=avisosRendiciones.js.map