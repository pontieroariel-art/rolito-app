"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAuthUsers = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");

exports.deleteAuthUsers = (0, https_1.onCall)(async (request) => {
    // Solo super_admin puede llamar esta función
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    }

    const db = (0, firestore_1.getFirestore)();
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();
    if (!callerData || callerData.rol !== 'super_admin') {
        throw new https_1.HttpsError('permission-denied', 'Solo super_admin puede ejecutar esta acción');
    }

    const { uids } = request.data;
    if (!Array.isArray(uids) || uids.length === 0) return { deleted: 0 };

    const auth = (0, auth_1.getAuth)();

    // Firebase Admin deleteUsers acepta hasta 1000 UIDs por llamada
    let deleted = 0;
    for (let i = 0; i < uids.length; i += 1000) {
        const chunk = uids.slice(i, i + 1000);
        const result = await auth.deleteUsers(chunk);
        deleted += result.successCount;
    }

    return { deleted };
});
