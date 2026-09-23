// La API "con namespace" de firebase-admin (admin.initializeApp, admin.credential.cert,
// admin.firestore(), admin.firestore.FieldValue, admin.auth()…) armada sobre los
// módulos modulares de firebase-admin 14, que ya no la trae (2026-09-22, al subir
// functions de 12 a 14). Los 66 scripts operativos la usan con
//   const admin = require('./lib/firebase-admin-compat.cjs')
// y siguen igual. Un script nuevo puede importar directo de
// 'firebase-admin/app' y 'firebase-admin/firestore' (los 11 modulares ya lo hacen).
const path = require('path')
const base = path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin')
const app   = require(path.join(base, 'lib', 'app'))
const fsx   = require(path.join(base, 'lib', 'firestore'))
const authm = require(path.join(base, 'lib', 'auth'))
const stg   = require(path.join(base, 'lib', 'storage'))

const firestore = (a) => fsx.getFirestore(a)
Object.assign(firestore, { FieldValue: fsx.FieldValue, Timestamp: fsx.Timestamp, FieldPath: fsx.FieldPath, GeoPoint: fsx.GeoPoint })

module.exports = {
  initializeApp: app.initializeApp,
  getApps: app.getApps,
  getApp: app.getApp,
  get apps() { return app.getApps() },
  app: (name) => app.getApp(name),
  credential: { cert: app.cert, applicationDefault: app.applicationDefault, refreshToken: app.refreshToken },
  firestore,
  auth: (a) => authm.getAuth(a),
  storage: (a) => stg.getStorage(a),
  SDK_VERSION: app.SDK_VERSION,
}
