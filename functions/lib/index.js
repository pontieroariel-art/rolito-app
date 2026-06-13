"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAuthUsers = exports.onOrderEnCamino = exports.onOrderConfirmado = exports.onOrderCreated = exports.onUserApproved = exports.onUserRegistered = void 0;
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
var users_1 = require("./triggers/users");
Object.defineProperty(exports, "onUserRegistered", { enumerable: true, get: function () { return users_1.onUserRegistered; } });
Object.defineProperty(exports, "onUserApproved", { enumerable: true, get: function () { return users_1.onUserApproved; } });
var orders_1 = require("./triggers/orders");
Object.defineProperty(exports, "onOrderCreated", { enumerable: true, get: function () { return orders_1.onOrderCreated; } });
Object.defineProperty(exports, "onOrderConfirmado", { enumerable: true, get: function () { return orders_1.onOrderConfirmado; } });
Object.defineProperty(exports, "onOrderEnCamino", { enumerable: true, get: function () { return orders_1.onOrderEnCamino; } });
var cleanup_1 = require("./triggers/cleanup");
Object.defineProperty(exports, "deleteAuthUsers", { enumerable: true, get: function () { return cleanup_1.deleteAuthUsers; } });
//# sourceMappingURL=index.js.map