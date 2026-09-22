"use strict";
/**
 * Rol, estado, planta y permisos del usuario en el TOKEN (custom claims),
 * auditoría de performance 2026-09-12.
 *
 * Las reglas de Firestore leían `users/{uid}` (exists + get) en cada helper de
 * cada consulta: un `read` de ventasCamion encadena hasta ocho helpers. Con
 * los claims, las reglas miran `request.auth.token` y no leen nada; si el
 * token todavía no los trae (usuario sin backfill, token viejo, sesión "Ver
 * como"), las reglas siguen leyendo el documento como siempre (camino doble,
 * ver firestore.rules → perfil()).
 *
 * Este trigger mantiene los claims iguales al documento. Cuando cambian, deja
 * `claimsActualizadosEn` en el doc y AuthContext refresca el ID token en el
 * momento, así el cambio de rol no espera a la hora de vida del token.
 * `scripts/backfill-claims.mjs` los carga para todos los usuarios existentes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserClaims = void 0;
exports.claimsDeUsuario = claimsDeUsuario;
exports.debeEstarDeshabilitado = debeEstarDeshabilitado;
exports.mismosClaims = mismosClaims;
const firestore_1 = require("firebase-functions/v2/firestore");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-admin/firestore");
/** Claims que corresponden al documento del usuario. Pura. */
function claimsDeUsuario(d) {
    if (!d)
        return null;
    const rol = String(d.rol ?? d.role ?? '');
    if (!rol)
        return null;
    const c = { rol, estado: String(d.estado ?? 'activo') };
    // Un CLIENTE no tiene planta, área, roles adicionales ni permisos de
    // oficina: aunque el doc los traiga (auditoría 2026-09-22: el registro
    // público los aceptaba), el token no los lleva.
    if (rol === 'cliente')
        return c;
    if (typeof d.planta === 'string' && d.planta)
        c.planta = d.planta;
    if (typeof d.area === 'string' && d.area)
        c.area = d.area;
    if (Array.isArray(d.rolesExtra) && d.rolesExtra.length)
        c.rolesExtra = d.rolesExtra.map(String);
    if (d.autorizaAnulaciones === true)
        c.autorizaAnulaciones = true;
    return c;
}
/**
 * ¿La cuenta de Auth tiene que estar deshabilitada? Solo la baja explícita
 * (estado 'inactivo'): un cliente 'pendiente' entra y ve "esperando
 * aprobación". Sin doc no se toca nada (semillas, cuentas de servicio). Pura.
 */
function debeEstarDeshabilitado(d) {
    if (!d)
        return null;
    return String(d.estado ?? 'activo') === 'inactivo';
}
/** ¿Los claims vigentes ya dicen lo mismo? Pura. */
function mismosClaims(actuales, deseados) {
    const a = actuales ?? {};
    const claves = ['rol', 'estado', 'planta', 'area', 'rolesExtra', 'autorizaAnulaciones'];
    if (!deseados)
        return claves.every((k) => a[k] === undefined);
    return claves.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(deseados[k] ?? null));
}
exports.onUserClaims = (0, firestore_1.onDocumentWritten)('users/{uid}', async (event) => {
    const uid = event.params.uid;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    const deseados = claimsDeUsuario(after);
    const auth = (0, auth_1.getAuth)();
    let usuario;
    try {
        usuario = await auth.getUser(uid);
    }
    catch {
        return; // doc sin usuario de Auth (semillas, cuentas borradas): nada que hacer
    }
    // La baja deshabilita la cuenta y revoca el refresh token (auditoría
    // 2026-09-22: la baja de staff solo escribía estado:'inactivo' y el
    // chofer desvinculado seguía vendiendo con la PWA instalada). El ID token
    // vivo caduca en menos de una hora; las reglas de plata ya miran el estado.
    const deshabilitar = debeEstarDeshabilitado(after);
    if (deshabilitar !== null && usuario.disabled !== deshabilitar) {
        await auth.updateUser(uid, { disabled: deshabilitar });
        if (deshabilitar)
            await auth.revokeRefreshTokens(uid).catch((e) => console.warn('[claims] no se pudo revocar el token', uid, e));
        console.log(`[claims] ${uid} ${deshabilitar ? 'deshabilitado' : 'rehabilitado'} en Auth (estado ${String(after?.estado)})`);
    }
    const actuales = usuario.customClaims ?? {};
    if (mismosClaims(actuales, deseados))
        return;
    // Se conservan claims ajenos a esto (hoy no hay, pero por si aparecen).
    const { rol: _r, estado: _e, planta: _p, area: _a, rolesExtra: _x, autorizaAnulaciones: _z, ...otros } = actuales;
    await auth.setCustomUserClaims(uid, deseados ? { ...otros, ...deseados } : (Object.keys(otros).length ? otros : null));
    if (after) {
        // Marca para que el cliente refresque el token ya. Este update vuelve a
        // disparar el trigger, pero los claims ya coinciden y sale por arriba.
        await (0, firestore_2.getFirestore)().doc(`users/${uid}`).update({ claimsActualizadosEn: firestore_2.FieldValue.serverTimestamp() }).catch(() => { });
    }
});
//# sourceMappingURL=claims.js.map