"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncClientesTango = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
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
async function procesarLoteClientesTango(db, rows, opts) {
    const usersSnap = await db.collection('users').where('rol', '==', 'cliente').get();
    const porIdGva14 = new Map();
    const porCuit = new Map();
    const perfilPorUid = new Map();
    usersSnap.forEach((doc) => {
        const data = doc.data();
        perfilPorUid.set(doc.id, data);
        if (typeof data.idGva14Tango === 'number')
            porIdGva14.set(data.idGva14Tango, doc.id);
        const cuit = soloDigitos(data.cuit);
        if (cuit.length >= 6) {
            if (!porCuit.has(cuit))
                porCuit.set(cuit, []);
            porCuit.get(cuit).push(doc.id);
        }
    });
    let matchedByIdGva14 = 0;
    let matchedByCuit = 0;
    let newlyLinkedCodigoTango = 0;
    let skippedNoMatch = 0;
    let skippedAmbiguousCuit = 0;
    let actualizados = 0;
    let emailsActualizados = 0;
    let emailsConError = 0;
    const errores = [];
    const wouldUpdate = [];
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
        let uid = porIdGva14.get(row.idGva14);
        let esNuevoLink = false;
        if (!uid) {
            const cuit = soloDigitos(row.cuit);
            // Ojo con los "grupos empresarios": varias sucursales de Tango pueden compartir
            // el mismo CUIT (ver docs/tango/INTEGRACION.md, caso Golden Car / Josimar). Si el
            // cliente de la app ya tiene una sucursal de Tango vinculada (idGva14Tango seteado,
            // ya sea de antes o recién en esta misma corrida), esta fila es OTRA sucursal de la
            // misma empresa, no un match nuevo — hay que ignorarla, no pisarle el vínculo.
            const candidatos = (porCuit.get(cuit) ?? []).filter((u) => !perfilPorUid.get(u).idGva14Tango);
            if (candidatos.length === 0) {
                skippedNoMatch++;
                continue;
            }
            if (candidatos.length > 1) {
                skippedAmbiguousCuit++;
                errores.push({ idGva14: row.idGva14, cuit: row.cuit, motivo: 'CUIT ambiguo: más de un cliente de la app con ese CUIT' });
                continue;
            }
            uid = candidatos[0];
            esNuevoLink = true;
            matchedByCuit++;
        }
        else {
            matchedByIdGva14++;
        }
        const perfil = perfilPorUid.get(uid);
        const update = {};
        if (esNuevoLink) {
            update.codigoTango = row.codGva14;
            update.idGva14Tango = row.idGva14;
            newlyLinkedCodigoTango++;
            // Se marca en memoria ya mismo (no solo al escribir en Firestore) para que otra
            // fila de Tango con el mismo CUIT, procesada en esta misma tanda, no reconquiste
            // a este mismo cliente.
            perfil.idGva14Tango = row.idGva14;
        }
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
        // Email: hay 2 modelos de cuenta distintos en la base (visto en la ficha real de
        // un cliente, no en el código de un solo flujo):
        // - Clientes importados en bloque (scripts/import-clientes.mjs) tienen un campo
        //   `emailAuth` separado ("{cuit}@rolito.app") que es la credencial real de
        //   Firebase Auth — `email` ahí es puramente de contacto/exhibición, no afecta
        //   el login. Para estos, alcanza con actualizar `email` sin tocar nada más.
        // - Clientes que se autorregistraron (userService.ts createUserDocument) NO
        //   tienen `emailAuth` — para esos, `email` ES la credencial real, y hay que
        //   actualizar las 3 patas juntas (Auth + cuitIndex + perfil), nunca solo 2 de 3.
        if (pareceEmailValido(row.email) && row.email !== perfil.email) {
            if (perfil.emailAuth || opts.dryRun) {
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
        update.tangoUltimaSync = firestore_1.FieldValue.serverTimestamp();
        if (opts.dryRun) {
            if (wouldUpdate.length < 20)
                wouldUpdate.push({ uid, ...update });
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
        newlyLinkedCodigoTango,
        skippedNoMatch,
        skippedAmbiguousCuit,
        actualizados,
        emailsActualizados,
        emailsConError,
        ...(opts.dryRun ? { wouldUpdate } : {}),
        errores,
    };
}
// Recibe lotes de clientes de Tango desde el script que corre en la VM (ver
// scripts/tango/bridge-sync-clientes.mjs) y actualiza los campos "de Tango" en
// users/{uid}. Es un onRequest (no onCall) porque quien llama es un script Node
// suelto, sin el SDK de cliente de Firebase — la autorización es un bearer
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
        const resultado = await procesarLoteClientesTango(db, rows, { dryRun });
        res.status(200).json(resultado);
    }
    catch (err) {
        console.error('[syncClientesTango] error procesando lote:', err);
        res.status(500).json({ succeeded: false, reason: err instanceof Error ? err.message : String(err) });
    }
});
//# sourceMappingURL=tangoSync.js.map