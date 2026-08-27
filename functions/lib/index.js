"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onProduccionPalletCreado = exports.syncClientesTango = exports.enviarResumenAdminDiario = exports.onHistorialAdminAltoRiesgo = exports.backupAuthUsers = exports.avisarComodatosPorVencer = exports.onTicketCreado = exports.onStockBajo = exports.onTicketCerrado = exports.generarPedidosRecurrentes = exports.orsDirections = exports.mirrorDriverLocation = exports.validarPreciosPedido = exports.notifyReprogramado = exports.notifyCerca = exports.sendPush = exports.deleteAuthUsers = exports.onOrderEnCamino = exports.onOrderConfirmado = exports.onOrderCreated = exports.onClienteCreadoPorStaff = exports.onUserApproved = exports.onUserRegistered = void 0;
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
// Nota: cambio trivial para forzar un hash de fuente distinto y que
// `firebase deploy --only functions` no salte el redeploy de las 12
// functions que quedaron en una revisión de Cloud Run vieja tras el
// "Quota exceeded for total allowable CPU per project per region" del
// 2026-08-16 (firebase-tools marca el hash como "ya deployado" apenas se
// actualiza la config, aunque el rollout de la revisión haya fallado
// después por la cuota).
var users_1 = require("./triggers/users");
Object.defineProperty(exports, "onUserRegistered", { enumerable: true, get: function () { return users_1.onUserRegistered; } });
Object.defineProperty(exports, "onUserApproved", { enumerable: true, get: function () { return users_1.onUserApproved; } });
Object.defineProperty(exports, "onClienteCreadoPorStaff", { enumerable: true, get: function () { return users_1.onClienteCreadoPorStaff; } });
var orders_1 = require("./triggers/orders");
Object.defineProperty(exports, "onOrderCreated", { enumerable: true, get: function () { return orders_1.onOrderCreated; } });
Object.defineProperty(exports, "onOrderConfirmado", { enumerable: true, get: function () { return orders_1.onOrderConfirmado; } });
Object.defineProperty(exports, "onOrderEnCamino", { enumerable: true, get: function () { return orders_1.onOrderEnCamino; } });
var cleanup_1 = require("./triggers/cleanup");
Object.defineProperty(exports, "deleteAuthUsers", { enumerable: true, get: function () { return cleanup_1.deleteAuthUsers; } });
var push_1 = require("./triggers/push");
Object.defineProperty(exports, "sendPush", { enumerable: true, get: function () { return push_1.sendPush; } });
var clientNotify_1 = require("./triggers/clientNotify");
Object.defineProperty(exports, "notifyCerca", { enumerable: true, get: function () { return clientNotify_1.notifyCerca; } });
Object.defineProperty(exports, "notifyReprogramado", { enumerable: true, get: function () { return clientNotify_1.notifyReprogramado; } });
var orderPricing_1 = require("./triggers/orderPricing");
Object.defineProperty(exports, "validarPreciosPedido", { enumerable: true, get: function () { return orderPricing_1.validarPreciosPedido; } });
var location_1 = require("./triggers/location");
Object.defineProperty(exports, "mirrorDriverLocation", { enumerable: true, get: function () { return location_1.mirrorDriverLocation; } });
var routing_1 = require("./triggers/routing");
Object.defineProperty(exports, "orsDirections", { enumerable: true, get: function () { return routing_1.orsDirections; } });
var recurrentes_1 = require("./triggers/recurrentes");
Object.defineProperty(exports, "generarPedidosRecurrentes", { enumerable: true, get: function () { return recurrentes_1.generarPedidosRecurrentes; } });
var heladeras_1 = require("./triggers/heladeras");
Object.defineProperty(exports, "onTicketCerrado", { enumerable: true, get: function () { return heladeras_1.onTicketCerrado; } });
Object.defineProperty(exports, "onStockBajo", { enumerable: true, get: function () { return heladeras_1.onStockBajo; } });
Object.defineProperty(exports, "onTicketCreado", { enumerable: true, get: function () { return heladeras_1.onTicketCreado; } });
var comodatos_1 = require("./triggers/comodatos");
Object.defineProperty(exports, "avisarComodatosPorVencer", { enumerable: true, get: function () { return comodatos_1.avisarComodatosPorVencer; } });
var authBackup_1 = require("./triggers/authBackup");
Object.defineProperty(exports, "backupAuthUsers", { enumerable: true, get: function () { return authBackup_1.backupAuthUsers; } });
var adminAudit_1 = require("./triggers/adminAudit");
Object.defineProperty(exports, "onHistorialAdminAltoRiesgo", { enumerable: true, get: function () { return adminAudit_1.onHistorialAdminAltoRiesgo; } });
Object.defineProperty(exports, "enviarResumenAdminDiario", { enumerable: true, get: function () { return adminAudit_1.enviarResumenAdminDiario; } });
var tangoSync_1 = require("./triggers/tangoSync");
Object.defineProperty(exports, "syncClientesTango", { enumerable: true, get: function () { return tangoSync_1.syncClientesTango; } });
var tangoOutbox_1 = require("./triggers/tangoOutbox");
Object.defineProperty(exports, "onProduccionPalletCreado", { enumerable: true, get: function () { return tangoOutbox_1.onProduccionPalletCreado; } });
//# sourceMappingURL=index.js.map