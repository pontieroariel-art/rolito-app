"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAuthUsers = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
exports.deleteAuthUsers = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado');
    const callerDoc = await (0, firestore_1.getFirestore)().collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();
    if (!callerData || callerData.rol !== 'super_admin') {
        throw new https_1.HttpsError('permission-denied', 'Solo super_admin puede ejecutar esta acción');
    }
    const { uids } = request.data;
    if (!Array.isArray(uids) || uids.length === 0)
        return { deleted: 0 };
    const auth = (0, auth_1.getAuth)();
    let deleted = 0;
    for (let i = 0; i < uids.length; i += 1000) {
        const result = await auth.deleteUsers(uids.slice(i, i + 1000));
        deleted += result.successCount;
    }
    return { deleted };
});
//# sourceMappingURL=cleanup.js.map