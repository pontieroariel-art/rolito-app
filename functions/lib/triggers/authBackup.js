"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupAuthUsers = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const auth_1 = require("firebase-admin/auth");
const storage_1 = require("firebase-admin/storage");
const TZ = 'America/Argentina/Buenos_Aires';
// 'YYYY-MM-DD' de una fecha vista desde Argentina (en-CA da ese formato).
const fechaART = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
// Los backups nativos de Firestore (diario + semanal) no cubren Firebase Auth
// — un incidente que borre/corrompa usuarios de Auth no tiene forma de
// restaurarse hoy. Exporta todos los usuarios (paginado, 1000 por página, el
// máximo que acepta listUsers) a un JSON en el bucket default de Storage.
// Solo lectura de Auth — no toca ningún dato ni afecta ningún flujo existente.
exports.backupAuthUsers = (0, scheduler_1.onSchedule)({ schedule: '0 5 * * 0', timeZone: TZ }, async () => {
    const users = [];
    let pageToken;
    do {
        const page = await (0, auth_1.getAuth)().listUsers(1000, pageToken);
        users.push(...page.users.map((u) => u.toJSON()));
        pageToken = page.pageToken;
    } while (pageToken);
    const fecha = fechaART(new Date());
    const file = (0, storage_1.getStorage)().bucket().file(`auth-backups/${fecha}.json`);
    await file.save(JSON.stringify(users, null, 2), { contentType: 'application/json' });
    console.log(`[backupAuthUsers] ${users.length} usuario(s) exportados a auth-backups/${fecha}.json`);
});
//# sourceMappingURL=authBackup.js.map