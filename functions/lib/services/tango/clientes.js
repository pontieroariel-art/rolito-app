"use strict";
// Padrón maestro: Tango manda (decisión de Ariel 2026-09-06). Lógica PURA de
// alta y baja automática de cuentas de cliente a partir de las filas de
// clientes de Tango; la escritura (Auth + users + cuitIndex) la hace
// triggers/tangoAltas.ts, la baja la aplica tangoSync.ts.
//
//  - ALTA: todo cliente HABILITADO de cualquiera de las dos empresas con CUIT
//    válido y sin cuenta en la app → cuenta activa, login por CUIT con
//    contraseña inicial = CUIT (el cliente la cambia si quiere; Ariel acepta
//    el riesgo de que el CUIT es público). Un CUIT = una cuenta: si el mismo
//    CUIT aparece en las dos empresas (o varias veces en una), es UNA cuenta
//    con todos los códigos en `tangoIds`.
//  - Sin CUIT válido (consumidor final, "00000000000", CUIT mal cargado): desde
//    el 2026-09-07 (decisión de Ariel) se crea IGUAL una cuenta por código, sin
//    login (sin Auth ni cuitIndex, `sinCuit: true`), para poder venderle en
//    promo; el contado queda bloqueado hasta que le carguen el CUIT. Las fichas
//    genéricas ("NO USAR", "ANULADOS", "CONSUMIDOR FINAL") se descartan.
//  - BAJA: cuenta vinculada a Tango cuyas filas desaparecieron o están todas
//    inhabilitadas → estado 'inactivo' + Auth deshabilitado (nunca se borra
//    el doc ni el cuitIndex: conserva historial y bloquea el login). Vuelve a
//    aparecer habilitada → se reactiva sola.
//  - Circuit breaker: si Tango devolvió muchas menos filas que la corrida
//    anterior (< 80 %), esa corrida no da de baja a nadie.
Object.defineProperty(exports, "__esModule", { value: true });
exports.claveSinCuit = exports.esFilaSinCuitAdmisible = exports.emailAuthDe = exports.filaHabilitada = exports.UMBRAL_CIRCUIT_BREAKER = exports.APROBADO_POR_TANGO = exports.DOMINIO_EMAIL_AUTH = void 0;
exports.candidatosAlta = candidatosAlta;
exports.camposTangoDeFila = camposTangoDeFila;
exports.direccionNuevaDeFila = direccionNuevaDeFila;
exports.upsertDireccionTango = upsertDireccionTango;
exports.docCuentaDesdeTango = docCuentaDesdeTango;
exports.decidirBaja = decidirBaja;
exports.corridaConfiable = corridaConfiable;
const cuit_1 = require("./cuit");
const empresas_1 = require("./empresas");
exports.DOMINIO_EMAIL_AUTH = 'rolito.app';
exports.APROBADO_POR_TANGO = 'tango';
exports.UMBRAL_CIRCUIT_BREAKER = 0.8;
/** Fila deshabilitada explícitamente en Tango (si el campo no viene, se asume habilitada). */
const filaHabilitada = (f) => f.habilitado !== false;
exports.filaHabilitada = filaHabilitada;
const emailAuthDe = (cuitDigits) => `${cuitDigits}@${exports.DOMINIO_EMAIL_AUTH}`;
exports.emailAuthDe = emailAuthDe;
/** Cuentas genéricas de Tango que nunca deben aparecer como cliente en la app. */
const NOMBRE_GENERICO = /NO USAR|NO-USAR|ANULAD|CONSUMIDOR FINAL/i;
const esFilaSinCuitAdmisible = (f) => !NOMBRE_GENERICO.test(f.razonSocial ?? '') && !!(f.razonSocial ?? '').trim();
exports.esFilaSinCuitAdmisible = esFilaSinCuitAdmisible;
/** Id determinístico del doc de alta / de la cuenta de un cliente sin CUIT. */
const claveSinCuit = (codigo) => `sincuit-${codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
exports.claveSinCuit = claveSinCuit;
/**
 * Agrupa por CUIT las filas de Tango que NO tienen cuenta en la app. Devuelve
 * los candidatos (CUIT válido, al menos una fila habilitada) y los descartados
 * con su motivo, para el resumen del panel.
 */
function candidatosAlta(sinCuenta) {
    const porCuit = new Map();
    const descartados = [];
    for (const { empresa, fila } of sinCuenta) {
        const base = { empresa, idGva14: fila.idGva14, codigo: fila.codGva14, cuit: fila.cuit, nombre: fila.razonSocial ?? '' };
        if (!(0, exports.filaHabilitada)(fila)) {
            descartados.push({ ...base, motivo: 'inhabilitado' });
            continue;
        }
        const cuit = (0, cuit_1.soloDigitos)(fila.cuit);
        if (!(0, cuit_1.cuitValido)(cuit)) {
            // Sin CUIT válido: cuenta sin login, una por CÓDIGO (el mismo código en
            // las dos empresas es la misma persona). Las genéricas se descartan.
            if (!(0, exports.esFilaSinCuitAdmisible)(fila)) {
                descartados.push({ ...base, motivo: 'cuit_invalido' });
                continue;
            }
            const clave = (0, exports.claveSinCuit)(fila.codGva14);
            if (!porCuit.has(clave))
                porCuit.set(clave, { cuit: '', clave, sinCuit: true, filas: [] });
            porCuit.get(clave).filas.push({ empresa, fila });
            continue;
        }
        if (!porCuit.has(cuit))
            porCuit.set(cuit, { cuit, clave: cuit, filas: [] });
        porCuit.get(cuit).filas.push({ empresa, fila });
    }
    // Redonhielo primero: manda la ficha; sus códigos son los principales.
    const orden = (e) => empresas_1.EMPRESAS.indexOf(e);
    for (const c of porCuit.values())
        c.filas.sort((a, b) => orden(a.empresa) - orden(b.empresa) || a.fila.idGva14 - b.fila.idGva14);
    return { candidatos: [...porCuit.values()], descartados };
}
// ── Doc de la cuenta nueva ───────────────────────────────────────────────────
function telefonoDe(f) {
    for (const c of [f.telefono1, f.telefonoMovil, f.telefono2]) {
        if (!c)
            continue;
        const limpio = c.trim();
        if (/^[\d\s\-()+]{6,20}$/.test(limpio)) {
            const n = limpio.replace(/\D/g, '');
            if (n.length >= 6 && n.length <= 15)
                return limpio;
        }
    }
    return '';
}
const pareceEmail = (e) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
function direccionDe(f) {
    return [f.domicilio, f.localidad, f.provinciaDesc].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
}
const CLAVES_TANGO = ['domicilioTango', 'localidadTango', 'provinciaTango', 'codigoPostalTango', 'razonSocialTango', 'nombreComercialTango'];
/** Solo los campos de Tango no vacíos de la fila, con trim. */
function camposTangoDeFila(f) {
    const t = (v) => (v ?? '').trim();
    const out = {};
    if (t(f.domicilio))
        out.domicilioTango = t(f.domicilio);
    if (t(f.localidad))
        out.localidadTango = t(f.localidad);
    if (t(f.provinciaDesc))
        out.provinciaTango = t(f.provinciaDesc);
    if (t(f.codigoPostal))
        out.codigoPostalTango = t(f.codigoPostal);
    if (t(f.razonSocial))
        out.razonSocialTango = t(f.razonSocial);
    if (t(f.nombreComercial))
        out.nombreComercialTango = t(f.nombreComercial);
    return out;
}
/** Entrada nueva de addresses[] para un código: sin geo ni horarios, con la ficha de Tango. */
function direccionNuevaDeFila(f, opts) {
    // Nombre para los selectores de la app y el índice de búsqueda: la razón social
    // del código (en Tango es la que suele traer el barrio: "… (ONIGLIA)"); el
    // nombre comercial muchas veces repite el nombre de la cuenta truncado.
    const nombreSucursal = (f.razonSocial ?? '').trim() || (f.nombreComercial ?? '').trim() || f.codGva14;
    return {
        id: f.codGva14,
        nombre: opts.principal ? 'Principal' : nombreSucursal,
        address: direccionDe(f) || (opts.addressFallback ?? ''),
        lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '',
        esPrincipal: opts.principal,
        ...camposTangoDeFila(f),
    };
}
/**
 * Upsert de la entrada `id === fila.codGva14` en addresses[] de una cuenta
 * existente (sync de actualización). Reglas:
 *  - existe: escribe SOLO los campos *Tango (y `address` si estaba vacía);
 *    nunca lat/lng, horarios, contacto, nombre ni esPrincipal;
 *  - no existe y no es el principal: la crea;
 *  - no existe y ES el principal: la crea solo si la cuenta no tiene ninguna
 *    dirección (si ya cargaron direcciones a mano con ids propios, la ficha
 *    del principal vive en users.*Tango y no se duplica);
 *  - `manda = false` (fila de Rolito cuando la ficha la manda Redonhielo): no
 *    pisa campos *Tango ya escritos por la otra empresa;
 *  - `cambio = false` si no hubo nada que escribir (idempotente, para no
 *    reescribir el array en cada corrida).
 */
function upsertDireccionTango(addresses, fila, opts) {
    const lista = Array.isArray(addresses) ? addresses : [];
    const campos = camposTangoDeFila(fila);
    const i = lista.findIndex((a) => a && a.id === fila.codGva14);
    if (i < 0) {
        if (opts.principal && lista.length > 0)
            return { addresses: lista, cambio: false };
        return { addresses: [...lista, direccionNuevaDeFila(fila, { principal: opts.principal })], cambio: true };
    }
    const actual = lista[i];
    const nueva = { ...actual };
    let cambio = false;
    for (const k of CLAVES_TANGO) {
        const v = campos[k];
        if (!v)
            continue;
        if (actual[k] === v)
            continue;
        if (!opts.manda && actual[k])
            continue;
        nueva[k] = v;
        cambio = true;
    }
    if (!(actual.address ?? '').trim() && direccionDe(fila)) {
        nueva.address = direccionDe(fila);
        cambio = true;
    }
    if (!cambio)
        return { addresses: lista, cambio: false };
    const out = [...lista];
    out[i] = nueva;
    return { addresses: out, cambio: true };
}
/**
 * Ficha `users/{uid}` de una cuenta creada desde Tango. Modelo `emailAuth`
 * (como scripts/import-clientes.mjs): la credencial es <cuit>@rolito.app y
 * `email` es solo de contacto. Nace ACTIVA, con `aprobadoPor: 'tango'` y SIN
 * `creadoPor`, para no disparar los emails de onUserRegistered /
 * onClienteCreadoPorStaff / onUserApproved (functions/src/triggers/users.ts).
 * `ahora` = FieldValue.serverTimestamp() desde el trigger.
 */
function docCuentaDesdeTango(candidato, ahora) {
    const principal = candidato.filas[0].fila;
    // Sin CUIT no hay credencial: la cuenta existe para venderle (promo), no para que entre.
    const emailAuth = candidato.sinCuit ? '' : (0, exports.emailAuthDe)(candidato.cuit);
    const razonSocial = (principal.razonSocial ?? '').trim() || `Cliente ${principal.codGva14}`;
    const telefono = telefonoDe(principal);
    const direccion = direccionDe(principal);
    const tangoIds = {};
    for (const { empresa, fila } of candidato.filas) {
        tangoIds[empresa] = (0, empresas_1.agregarTangoId)(tangoIds[empresa], { idGva14: fila.idGva14, codigo: fila.codGva14 });
    }
    const rh = tangoIds.redonhielo?.[0];
    // Una dirección por código de Tango (addresses[].id = código, como en las
    // importaciones): la primera es la principal.
    const addresses = candidato.filas
        .map(({ fila }, i) => direccionNuevaDeFila(fila, { principal: i === 0, addressFallback: direccion }))
        .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
    const doc = {
        rol: 'cliente',
        estado: 'activo',
        ...(candidato.sinCuit ? { sinCuit: true } : { emailAuth }),
        email: pareceEmail(principal.email) ? principal.email.trim() : emailAuth,
        cuit: candidato.cuit,
        razonSocial,
        nombre: razonSocial,
        nombreContacto: razonSocial,
        telefono,
        phone: telefono,
        address: addresses[0]?.address ?? '',
        codigoCliente: principal.codGva14,
        addresses,
        tangoIds,
        ...(rh ? { codigoTango: rh.codigo, idGva14Tango: rh.idGva14 } : {}),
        ...(principal.condicionVentaDesc ? { condicionVenta: principal.condicionVentaDesc } : {}),
        ...(principal.categoriaIvaCodigo ? { categoriaIvaTango: principal.categoriaIvaCodigo } : {}),
        ...(principal.categoriaIvaDesc ? { categoriaIvaTangoDesc: principal.categoriaIvaDesc } : {}),
        ...(principal.vendedorCodigo ? { codVendedor: principal.vendedorCodigo } : {}),
        ...(principal.domicilio ? { domicilioTango: principal.domicilio } : {}),
        ...(principal.localidad ? { localidadTango: principal.localidad } : {}),
        ...(principal.provinciaDesc ? { provinciaTango: principal.provinciaDesc } : {}),
        ...(principal.codigoPostal ? { codigoPostalTango: principal.codigoPostal } : {}),
        fechaCreacion: ahora,
        fechaAprobacion: ahora,
        aprobadoPor: exports.APROBADO_POR_TANGO,
        tangoUltimaSync: ahora,
    };
    return doc;
}
/**
 * Qué hacer con una cuenta vinculada a Tango después de una corrida completa.
 *  - Está habilitada en alguna empresa → si tenía baja de la sync, se reactiva; si no, nada.
 *  - No está habilitada en ninguna y TODAS sus empresas tuvieron corrida OK → baja.
 *  - Si alguna de sus empresas no tuvo corrida OK, no se decide (nada).
 */
function decidirBaja(estado, perfil) {
    const empresas = empresas_1.EMPRESAS.filter((e) => estado.vinculada[e]);
    if (empresas.length === 0)
        return { accion: 'nada' };
    if (empresas.some((e) => estado.habilitada[e])) {
        return perfil.bajaTango && perfil.estado === 'inactivo' ? { accion: 'reactivar' } : { accion: 'nada' };
    }
    if (!empresas.every((e) => estado.corridaOk[e]))
        return { accion: 'nada' };
    if (perfil.estado === 'inactivo')
        return { accion: 'nada' }; // ya estaba de baja (por la sync o a mano)
    const inhabilitadas = empresas.filter((e) => estado.habilitada[e] === false);
    return { accion: 'baja', motivo: inhabilitadas.length ? 'inhabilitado en Tango' : 'no figura en Tango' };
}
/** Circuit breaker: ¿esta corrida trajo suficientes filas como para confiar en las ausencias? */
function corridaConfiable(recibidas, anteriores) {
    if (!anteriores || anteriores <= 0)
        return recibidas > 0;
    return recibidas >= anteriores * exports.UMBRAL_CIRCUIT_BREAKER;
}
//# sourceMappingURL=clientes.js.map