"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAuthUsers = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
exports.deleteAuthUsers = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    const db = (0, firestore_1.getFirestore)();
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();
    if (!callerData || callerData.rol !== 'super_admin') {
        throw new https_1.HttpsError('permission-denied', 'Solo super_admin puede ejecutar esta acción');
    }
    const { uids, indices } = request.data;
    if (!Array.isArray(uids) || uids.length === 0)
        return { deleted: 0 };
    const auth = (0, auth_1.getAuth)();
    let deleted = 0;
    for (let i = 0; i < uids.length; i += 1000) {
        const result = await auth.deleteUsers(uids.slice(i, i + 1000));
        deleted += result.successCount;
    }
    // Limpiar los índices de login (cuitIndex/dniIndex/staffDniIndex) de las
    // cuentas borradas — antes quedaban huérfanos apuntando a un uid/email que
    // ya no existe, bloqueando el re-registro futuro con el mismo CUIT/DNI. Se
    // borra solo si el índice sigue apuntando al mismo email (por si ya fue
    // reasignado a una cuenta nueva en el instante entre leer y borrar).
    if (Array.isArray(indices) && indices.length > 0) {
        await Promise.all(indices.flatMap((idx) => {
            const ops = [];
            const cuitKey = idx.cuit?.replace(/\D/g, '');
            if (cuitKey && cuitKey.length === 11) {
                ops.push(deleteIfEmailMatches(db.collection('cuitIndex').doc(cuitKey), idx.email));
            }
            const dniKey = idx.dni?.replace(/\D/g, '');
            if (dniKey && dniKey.length === 8) {
                const col = idx.rol === 'chofer' ? 'dniIndex' : 'staffDniIndex';
                ops.push(deleteIfEmailMatches(db.collection(col).doc(dniKey), idx.email));
            }
            return ops;
        }));
    }
    return { deleted };
});
async function deleteIfEmailMatches(ref, email) {
    const snap = await ref.get();
    if (snap.exists && snap.data()?.email === email)
        await ref.delete();
}
//# sourceMappingURL=cleanup.js.map