"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crearTokenImpersonacion = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const rateLimit_1 = require("../rateLimit");
const authz_1 = require("../authz");
exports.crearTokenImpersonacion = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    if ((0, authz_1.esImpersonado)(request)) {
        throw new https_1.HttpsError('permission-denied', 'Una sesión "Ver como" no puede abrir otra');
    }
    const db = (0, firestore_1.getFirestore)();
    const adminUid = request.auth.uid;
    const admin = (await db.collection('users').doc(adminUid).get()).data();
    if (!admin || admin.rol !== 'super_admin' || admin.estado !== 'activo') {
        throw new https_1.HttpsError('permission-denied', 'Solo super_admin puede ver la app como otro usuario');
    }
    await (0, rateLimit_1.assertRateLimit)(adminUid, 'impersonacion', 30, 3600);
    const uid = request.data?.uid;
    if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
        throw new https_1.HttpsError('invalid-argument', 'Falta el uid del usuario');
    }
    if (uid === adminUid)
        throw new https_1.HttpsError('invalid-argument', 'Ya sos vos');
    const perfil = (await db.collection('users').doc(uid).get()).data();
    if (!perfil)
        throw new https_1.HttpsError('not-found', 'El usuario no existe');
    if (perfil.rol === 'super_admin') {
        throw new https_1.HttpsError('permission-denied', 'No se puede ver la app como otro super_admin');
    }
    // createCustomToken crearía la cuenta si no existiera en Auth: verificarla antes.
    try {
        await (0, auth_1.getAuth)().getUser(uid);
    }
    catch {
        throw new https_1.HttpsError('not-found', 'El usuario no tiene cuenta de acceso (Auth)');
    }
    const adminNombre = String(admin.nombre ?? admin.razonSocial ?? '');
    const token = await (0, auth_1.getAuth)().createCustomToken(uid, {
        impersonadoPor: adminUid,
        impersonadoPorNombre: adminNombre,
    });
    const nombre = String(perfil.nombre ?? perfil.razonSocial ?? perfil.email ?? uid);
    const rol = String(perfil.rol ?? '');
    await db.collection('historialAdmin').add({
        coleccion: 'users',
        docId: uid,
        accion: 'impersonacion',
        detalle: `${nombre} (${rol})`,
        riesgo: 'alto',
        actor: { uid: adminUid, nombre: adminNombre, rol: 'super_admin' },
        fecha: firestore_1.FieldValue.serverTimestamp(),
    });
    return { token, nombre, rol };
});
//# sourceMappingURL=impersonacion.js.map