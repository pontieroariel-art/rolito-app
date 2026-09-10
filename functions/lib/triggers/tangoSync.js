"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncClientesTango = void 0;
exports.soloDigitos = soloDigitos;
exports.sanitizarTelefono = sanitizarTelefono;
exports.pareceEmailValido = pareceEmailValido;
exports.indiceUsuariosClientes = indiceUsuariosClientes;
exports.procesarLoteClientesTango = procesarLoteClientesTango;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const empresas_1 = require("../services/tango/empresas");
const cuit_1 = require("../services/tango/cuit");
const clientes_1 = require("../services/tango/clientes");
const tangoBridgeSecret = (0, params_1.defineSecret)('TANGO_BRIDGE_SECRET');
// Tope de filas por request (auditoría 2026-08-29, H11): el bridge sincroniza el
// padrón en lotes y ninguno legítimo se acerca a esto. Acota el costo / DoS si
// el secret se filtrara o el bridge tuviera un bug que mande un array enorme.
const MAX_ROWS_POR_LOTE = 10000;
function soloDigitos(v) {
    return v != null ? String(v).replace(/\D/g, '') : '';
}
// Tango mezcla texto libre en los teléfonos (ej. "0810-3216-2576 pagos") — solo
// se acepta un candidato si, sacando espacios/guiones/paréntesis, queda algo que
// parece un teléfono de verdad. Si ninguno pasa, se deja el que ya hay en la app.
function sanitizarTelefono(candidatos) {
    for (const c of candidatos) {
        if (!c)
            continue;
        const limpio = c.trim();
        if (/^[\d\s\-()+]{6,20}$/.test(limpio)) {
            const soloNumeros = limpio.replace(/\D/g, '');
            if (soloNumeros.length >= 6 && soloNumeros.length <= 15)
                return limpio;
        }
    }
    return null;
}
function pareceEmailValido(email) {
    return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
async function indiceUsuariosClientes(db) {
    const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get();
    const indice = {
        perfilPorUid: new Map(),
        porIdGva14: { redonhielo: new Map(), rolito: new Map() },
        porCodigo: { redonhielo: new Map(), rolito: new Map() },
        porCuit: new Map(),
    };
    usersSnap.forEach((doc) => {
        const data = doc.data();
        data.tangoIdsRaw = data.tangoIds ?? {}; // lo que hay escrito en Firestore
        data.tangoIds = (0, empresas_1.tangoIdsDe)(data); // normalizado, con los legacy absorbidos
        indice.perfilPorUid.set(doc.id, data);
        for (const empresa of empresas_1.EMPRESAS) {
            for (const id of data.tangoIds[empresa] ?? []) {
                indice.porIdGva14[empresa].set(id.idGva14, doc.id);
                indice.porCodigo[empresa].set(id.codigo, doc.id);
            }
        }
        const cuit = soloDigitos(data.cuit);
        if (cuit.length >= 6) {
            if (!indice.porCuit.has(cuit))
                indice.porCuit.set(cuit, []);
            indice.porCuit.get(cuit).push(doc.id);
        }
    });
    return indice;
}
/**
 * Vincula y actualiza las cuentas de la app con las filas de Tango de UNA
 * empresa. La ficha (razón social, IVA, domicilio, email…) la manda Redonhielo;
 * de Rolito solo se toma la identidad (tangoIds.rolito), salvo que el cliente
 * exista únicamente en Rolito. Varias filas con el mismo CUIT → una cuenta con
 * varios códigos (la primera vinculada es la principal).
 */
async function procesarLoteClientesTango(db, rows, opts) {
    const empresa = opts.empresa ?? 'redonhielo';
    const indice = opts.indice ?? await indiceUsuariosClientes(db);
    const { perfilPorUid, porIdGva14, porCodigo, porCuit } = indice;
    let matchedByIdGva14 = 0;
    let matchedByCuit = 0;
    let matchedByCodigo = 0;
    let newlyLinkedCodigoTango = 0;
    let codigosSecundarios = 0;
    let skippedNoMatch = 0;
    let skippedAmbiguousCuit = 0;
    let actualizados = 0;
    let emailsActualizados = 0;
    let emailsConError = 0;
    const errores = [];
    const wouldUpdate = [];
    const sinCuenta = [];
    const vistos = [];
    const auth = (0, auth_1.getAuth)();
    let batch = db.batch();
    let enBatch = 0;
    const flush = async () => {
        if (enBatch === 0)
            return;
        if (!opts.dryRun)
            await batch.commit();
        batch = db.batch();
        enBatch = 0;
    };
    for (const row of rows) {
        let uid = porIdGva14[empresa].get(row.idGva14);
        let esNuevoLink = false;
        if (uid) {
            matchedByIdGva14++;
        }
        else {
            // Misma cuenta por CUIT (una cuenta por CUIT en la app). Si el cliente ya
            // tiene un código vinculado en esta empresa, esta fila es OTRO código del
            // mismo CUIT (sucursal / grupo empresario) y se agrega como secundario.
            // Solo con CUIT válido: los rellenos ("00000000000", consumidor final)
            // colgarían cientos de códigos de una misma cuenta.
            const cuit = soloDigitos(row.cuit);
            const candidatos = (0, cuit_1.cuitValido)(cuit) ? (porCuit.get(cuit) ?? []) : [];
            if (candidatos.length > 1) {
                skippedAmbiguousCuit++;
                errores.push({ idGva14: row.idGva14, cuit: row.cuit, motivo: 'CUIT ambiguo: más de un cliente de la app con ese CUIT' });
                continue;
            }
            if (candidatos.length === 1) {
                uid = candidatos[0];
                matchedByCuit++;
            }
            else if (empresa !== 'redonhielo' && row.codGva14 && porCodigo.redonhielo.has(row.codGva14)) {
                // Rolito comparte los códigos de cliente con Redonhielo: si el CUIT no
                // alcanzó (vacío / distinto), el código sí identifica la cuenta.
                uid = porCodigo.redonhielo.get(row.codGva14);
                matchedByCodigo++;
            }
            else {
                skippedNoMatch++;
                if (sinCuenta.length < 10000)
                    sinCuenta.push(row);
                continue;
            }
            esNuevoLink = true;
        }
        const perfil = perfilPorUid.get(uid);
        const ids = perfil.tangoIds;
        vistos.push({ uid, habilitado: row.habilitado !== false });
        const tienePrincipal = (ids[empresa]?.length ?? 0) > 0;
        const esPrincipal = !tienePrincipal || ids[empresa][0].idGva14 === row.idGva14;
        const update = {};
        if (esNuevoLink) {
            const lista = (0, empresas_1.agregarTangoId)(ids[empresa], { idGva14: row.idGva14, codigo: row.codGva14 }, { principal: !tienePrincipal });
            ids[empresa] = lista;
            update[`tangoIds.${empresa}`] = lista;
            porIdGva14[empresa].set(row.idGva14, uid);
            porCodigo[empresa].set(row.codGva14, uid);
            if (tienePrincipal)
                codigosSecundarios++;
            else
                newlyLinkedCodigoTango++;
            if (empresa === 'redonhielo' && !tienePrincipal) {
                // Alias legacy del principal de Redonhielo (los usan precios, writers, UI).
                update.codigoTango = row.codGva14;
                update.idGva14Tango = row.idGva14;
                perfil.codigoTango = row.codGva14;
                perfil.idGva14Tango = row.idGva14;
            }
        }
        else if (esPrincipal && !perfilTieneTangoIds(perfil, empresa)) {
            // Cuenta vinculada por los campos legacy (idGva14Tango) pero sin
            // `tangoIds` escrito todavía: se materializa una vez.
            update[`tangoIds.${empresa}`] = ids[empresa];
        }
        if (update[`tangoIds.${empresa}`])
            perfil.tangoIdsRaw[empresa] = update[`tangoIds.${empresa}`];
        if (esPrincipal && ids[empresa] && ids[empresa][0].codigo !== row.codGva14) {
            // El código cambió en Tango (raro): se refleja.
            ids[empresa] = (0, empresas_1.agregarTangoId)(ids[empresa], { idGva14: row.idGva14, codigo: row.codGva14 }, { principal: true });
            update[`tangoIds.${empresa}`] = ids[empresa];
            if (empresa === 'redonhielo')
                update.codigoTango = row.codGva14;
        }
        // La ficha la manda Redonhielo. Rolito solo si el cliente NO existe en Redonhielo.
        const escribeFicha = esPrincipal && (empresa === 'redonhielo' || !(ids.redonhielo?.length));
        if (escribeFicha) {
            if (row.razonSocial)
                update.razonSocial = row.razonSocial;
            if (row.condicionVentaDesc)
                update.condicionVenta = row.condicionVentaDesc;
            if (row.categoriaIvaCodigo)
                update.categoriaIvaTango = row.categoriaIvaCodigo;
            if (row.categoriaIvaDesc)
                update.categoriaIvaTangoDesc = row.categoriaIvaDesc;
            if (row.vendedorCodigo)
                update.codVendedor = row.vendedorCodigo;
            if (row.domicilio)
                update.domicilioTango = row.domicilio;
            if (row.localidad)
                update.localidadTango = row.localidad;
            if (row.provinciaDesc)
                update.provinciaTango = row.provinciaDesc;
            if (row.codigoPostal)
                update.codigoPostalTango = row.codigoPostal;
            if (row.fechaAlta) {
                const fecha = new Date(row.fechaAlta);
                if (!isNaN(fecha.getTime()))
                    update.fechaAlta = firestore_1.Timestamp.fromDate(fecha);
            }
            const telefono = sanitizarTelefono([row.telefono1, row.telefono2, row.telefonoMovil]);
            if (telefono)
                update.telefono = telefono;
            // Email: hay 2 modelos de cuenta distintos en la base:
            // - Clientes importados / creados desde Tango tienen `emailAuth` separado
            //   ("{cuit}@rolito.app") que es la credencial real de Firebase Auth — `email`
            //   ahí es puramente de contacto. Alcanza con actualizar `email`.
            // - Clientes que se autorregistraron NO tienen `emailAuth` — `email` ES la
            //   credencial, y hay que actualizar las 3 patas juntas (Auth + cuitIndex +
            //   perfil), nunca solo 2 de 3.
            if (pareceEmailValido(row.email) && row.email !== perfil.email) {
                // Las cuentas sin CUIT no tienen usuario de Auth: solo el contacto.
                if (perfil.emailAuth || perfil.sinCuit || opts.dryRun) {
                    update.email = row.email;
                }
                else {
                    try {
                        await auth.updateUser(uid, { email: row.email });
                        const cuitDigits = soloDigitos(perfil.cuit);
                        if (cuitDigits.length === 11) {
                            await db.doc(`cuitIndex/${cuitDigits}`).set({ email: row.email });
                        }
                        update.email = row.email;
                        emailsActualizados++;
                    }
                    catch (err) {
                        emailsConError++;
                        errores.push({
                            idGva14: row.idGva14,
                            cuit: row.cuit,
                            motivo: `No se pudo actualizar el email (¿ya está en uso por otra cuenta?): ${err instanceof Error ? err.message : String(err)}`,
                        });
                    }
                }
            }
        }
        // Ficha de Tango de ESTA sucursal en addresses[] (2026-09-10): domicilio,
        // localidad, C.P. y nombre comercial del código, para que el remito y la
        // factura de la app impriman la dirección donde se bajó la mercadería.
        // Solo escribe campos *Tango (nunca address/lat/lng/horarios de logística)
        // y solo cuando algo cambió. El perfil del índice es compartido entre las
        // filas del mismo uid, así las sucursales se acumulan en el mismo array.
        // Como el array se escribe entero, va en una transacción que relee la ficha
        // en ese momento: el índice se armó al empezar la corrida y logística (o el
        // cliente desde /sucursal) puede haber editado direcciones mientras tanto.
        {
            const manda = empresa === 'redonhielo' || !(ids.redonhielo?.length);
            const previo = (0, clientes_1.upsertDireccionTango)(perfil.addresses, row, { principal: esPrincipal, manda });
            if (previo.cambio) {
                if (opts.dryRun) {
                    update.addresses = previo.addresses;
                    perfil.addresses = previo.addresses;
                }
                else {
                    const ref = db.collection('users').doc(uid);
                    const fresco = await db.runTransaction(async (tx) => {
                        const snap = await tx.get(ref);
                        const r = (0, clientes_1.upsertDireccionTango)(snap.data()?.addresses, row, { principal: esPrincipal, manda });
                        if (r.cambio)
                            tx.update(ref, { addresses: r.addresses });
                        return r.addresses;
                    });
                    perfil.addresses = fresco;
                }
            }
        }
        update.tangoUltimaSync = firestore_1.FieldValue.serverTimestamp();
        if (opts.dryRun) {
            if (wouldUpdate.length < 20)
                wouldUpdate.push({ uid, empresa, ...update });
            actualizados++;
            continue;
        }
        batch.update(db.collection('users').doc(uid), update);
        actualizados++;
        enBatch++;
        if (enBatch >= 400)
            await flush();
    }
    await flush();
    return {
        succeeded: true,
        dryRun: opts.dryRun,
        received: rows.length,
        matchedByIdGva14,
        matchedByCuit,
        matchedByCodigo,
        newlyLinkedCodigoTango,
        codigosSecundarios,
        skippedNoMatch,
        skippedAmbiguousCuit,
        actualizados,
        emailsActualizados,
        emailsConError,
        ...(opts.dryRun ? { wouldUpdate } : {}),
        errores,
        sinCuenta,
        vistos,
    };
}
// ¿El doc en Firestore ya tiene `tangoIds.<empresa>` escrito? (tangoIdsDe lo
// sintetiza en memoria desde los legacy, así que no alcanza con mirar perfil.tangoIds.)
function perfilTieneTangoIds(perfil, empresa) {
    return Array.isArray(perfil.tangoIdsRaw?.[empresa]) && perfil.tangoIdsRaw[empresa].length > 0;
}
// Recibe lotes de clientes de Tango desde el script que corría en la VM (ver
// scripts/tango/bridge-sync-clientes.mjs — reemplazado por
// syncClientesTangoConnect el 2026-09-03; queda por compatibilidad). Bearer
// secret angosto, no un usuario autenticado. Ver docs/tango/INTEGRACION.md §4/§6.
exports.syncClientesTango = (0, https_1.onRequest)({ secrets: [tangoBridgeSecret], invoker: 'public' }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ succeeded: false, reason: 'method not allowed' });
        return;
    }
    const authHeader = req.headers.authorization ?? '';
    if (authHeader !== `Bearer ${tangoBridgeSecret.value()}`) {
        res.status(401).json({ succeeded: false, reason: 'unauthorized' });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const dryRun = req.body?.dryRun === true;
    if (!dryRun) {
        const cfgSnap = await db.doc('config/tango').get();
        if (cfgSnap.data()?.enabled !== true) {
            res.status(200).json({ succeeded: false, dryRun, reason: 'tango sync disabled via config/tango.enabled' });
            return;
        }
    }
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) {
        res.status(400).json({ succeeded: false, reason: 'rows[] requerido' });
        return;
    }
    if (rows.length > MAX_ROWS_POR_LOTE) {
        res.status(413).json({ succeeded: false, reason: `demasiadas filas (${rows.length} > ${MAX_ROWS_POR_LOTE}); enviá lotes más chicos` });
        return;
    }
    try {
        const resultado = await procesarLoteClientesTango(db, rows, { dryRun, empresa: 'redonhielo' });
        delete resultado.sinCuenta;
        res.status(200).json(resultado);
    }
    catch (err) {
        console.error('[syncClientesTango] error procesando lote:', err);
        res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) });
    }
});
//# sourceMappingURL=tangoSync.js.map