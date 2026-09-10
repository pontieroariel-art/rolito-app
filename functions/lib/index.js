"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sincronizarDepositosTangoAhora = exports.syncDepositosTango = exports.procesarAltasTangoAhora = exports.altasClientesTango = exports.onConsultaSaldoPendiente = exports.sincronizarSaldosTangoAhora = exports.sincronizarClientesTangoAhora = exports.syncSaldosTangoConnect = exports.syncClientesTangoConnect = exports.sincronizarPreciosTangoAhora = exports.syncPreciosTango = exports.barridoOutboxTango = exports.onOutboxPendiente = exports.onOutboxConfirmado = exports.onCobranzaCreada = exports.onDescargaCamionCreada = exports.onRemitoCargaCreado = exports.onAnulacionEmitida = exports.onVentaVentanillaFacturada = exports.onVentaVentanillaCreada = exports.onVentaCamionFacturada = exports.onVentaCamionCreada = exports.onProduccionPalletCreado = exports.onConsultaRespondida = exports.syncSaldosTango = exports.syncClientesTango = exports.enviarResumenAdminDiario = exports.onHistorialAdminAltoRiesgo = exports.backupAuthUsers = exports.onVisitaSupervisorCreada = exports.onPedidoSupervisorCreado = exports.avisarComodatosPorVencer = exports.onTicketCreado = exports.onStockBajo = exports.onTicketCerrado = exports.generarPedidosRecurrentes = exports.orsDirections = exports.mirrorDriverLocation = exports.validarPreciosPedido = exports.notifyReprogramado = exports.notifyCerca = exports.sendPush = exports.deleteAuthUsers = exports.onOrderEnCamino = exports.onOrderConfirmado = exports.onOrderCreated = exports.onClienteIndexado = exports.onClienteCreadoPorStaff = exports.onUserApproved = exports.onUserRegistered = void 0;
exports.presentarCotRemito = exports.onRemitoCargaCotSolicitado = exports.enviarComprobantePorMail = exports.avisarPadronIIBB = exports.onAnulacionResuelta = exports.onAnulacionSolicitada = exports.reconciliarFacturasArca = exports.onVentaVentanillaContadoFacturar = exports.onVentaContadoFacturar = exports.resetPinProduccion = exports.onOrderRollup = exports.publicarTurnosVentanilla = void 0;
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
// Índice liviano de clientes para los buscadores (clientesIndex/{uid}, 2026-09-10).
var clientesIndex_1 = require("./triggers/clientesIndex");
Object.defineProperty(exports, "onClienteIndexado", { enumerable: true, get: function () { return clientesIndex_1.onClienteIndexado; } });
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
var supervisor_1 = require("./triggers/supervisor");
Object.defineProperty(exports, "onPedidoSupervisorCreado", { enumerable: true, get: function () { return supervisor_1.onPedidoSupervisorCreado; } });
Object.defineProperty(exports, "onVisitaSupervisorCreada", { enumerable: true, get: function () { return supervisor_1.onVisitaSupervisorCreada; } });
var authBackup_1 = require("./triggers/authBackup");
Object.defineProperty(exports, "backupAuthUsers", { enumerable: true, get: function () { return authBackup_1.backupAuthUsers; } });
var adminAudit_1 = require("./triggers/adminAudit");
Object.defineProperty(exports, "onHistorialAdminAltoRiesgo", { enumerable: true, get: function () { return adminAudit_1.onHistorialAdminAltoRiesgo; } });
Object.defineProperty(exports, "enviarResumenAdminDiario", { enumerable: true, get: function () { return adminAudit_1.enviarResumenAdminDiario; } });
var tangoSync_1 = require("./triggers/tangoSync");
Object.defineProperty(exports, "syncClientesTango", { enumerable: true, get: function () { return tangoSync_1.syncClientesTango; } });
var tangoSaldos_1 = require("./triggers/tangoSaldos");
Object.defineProperty(exports, "syncSaldosTango", { enumerable: true, get: function () { return tangoSaldos_1.syncSaldosTango; } });
var tangoConsultas_1 = require("./triggers/tangoConsultas");
Object.defineProperty(exports, "onConsultaRespondida", { enumerable: true, get: function () { return tangoConsultas_1.onConsultaRespondida; } });
var tangoOutbox_1 = require("./triggers/tangoOutbox");
Object.defineProperty(exports, "onProduccionPalletCreado", { enumerable: true, get: function () { return tangoOutbox_1.onProduccionPalletCreado; } });
Object.defineProperty(exports, "onVentaCamionCreada", { enumerable: true, get: function () { return tangoOutbox_1.onVentaCamionCreada; } });
Object.defineProperty(exports, "onVentaCamionFacturada", { enumerable: true, get: function () { return tangoOutbox_1.onVentaCamionFacturada; } });
Object.defineProperty(exports, "onVentaVentanillaCreada", { enumerable: true, get: function () { return tangoOutbox_1.onVentaVentanillaCreada; } });
Object.defineProperty(exports, "onVentaVentanillaFacturada", { enumerable: true, get: function () { return tangoOutbox_1.onVentaVentanillaFacturada; } });
Object.defineProperty(exports, "onAnulacionEmitida", { enumerable: true, get: function () { return tangoOutbox_1.onAnulacionEmitida; } });
Object.defineProperty(exports, "onRemitoCargaCreado", { enumerable: true, get: function () { return tangoOutbox_1.onRemitoCargaCreado; } });
Object.defineProperty(exports, "onDescargaCamionCreada", { enumerable: true, get: function () { return tangoOutbox_1.onDescargaCamionCreada; } });
Object.defineProperty(exports, "onCobranzaCreada", { enumerable: true, get: function () { return tangoOutbox_1.onCobranzaCreada; } });
Object.defineProperty(exports, "onOutboxConfirmado", { enumerable: true, get: function () { return tangoOutbox_1.onOutboxConfirmado; } });
var tangoWorker_1 = require("./triggers/tangoWorker");
Object.defineProperty(exports, "onOutboxPendiente", { enumerable: true, get: function () { return tangoWorker_1.onOutboxPendiente; } });
Object.defineProperty(exports, "barridoOutboxTango", { enumerable: true, get: function () { return tangoWorker_1.barridoOutboxTango; } });
var tangoPrecios_1 = require("./triggers/tangoPrecios");
Object.defineProperty(exports, "syncPreciosTango", { enumerable: true, get: function () { return tangoPrecios_1.syncPreciosTango; } });
Object.defineProperty(exports, "sincronizarPreciosTangoAhora", { enumerable: true, get: function () { return tangoPrecios_1.sincronizarPreciosTangoAhora; } });
var tangoConnectSync_1 = require("./triggers/tangoConnectSync");
Object.defineProperty(exports, "syncClientesTangoConnect", { enumerable: true, get: function () { return tangoConnectSync_1.syncClientesTangoConnect; } });
Object.defineProperty(exports, "syncSaldosTangoConnect", { enumerable: true, get: function () { return tangoConnectSync_1.syncSaldosTangoConnect; } });
Object.defineProperty(exports, "sincronizarClientesTangoAhora", { enumerable: true, get: function () { return tangoConnectSync_1.sincronizarClientesTangoAhora; } });
Object.defineProperty(exports, "sincronizarSaldosTangoAhora", { enumerable: true, get: function () { return tangoConnectSync_1.sincronizarSaldosTangoAhora; } });
Object.defineProperty(exports, "onConsultaSaldoPendiente", { enumerable: true, get: function () { return tangoConnectSync_1.onConsultaSaldoPendiente; } });
var tangoAltas_1 = require("./triggers/tangoAltas");
Object.defineProperty(exports, "altasClientesTango", { enumerable: true, get: function () { return tangoAltas_1.altasClientesTango; } });
Object.defineProperty(exports, "procesarAltasTangoAhora", { enumerable: true, get: function () { return tangoAltas_1.procesarAltasTangoAhora; } });
var tangoDepositos_1 = require("./triggers/tangoDepositos");
Object.defineProperty(exports, "syncDepositosTango", { enumerable: true, get: function () { return tangoDepositos_1.syncDepositosTango; } });
Object.defineProperty(exports, "sincronizarDepositosTangoAhora", { enumerable: true, get: function () { return tangoDepositos_1.sincronizarDepositosTangoAhora; } });
var turnosVentanilla_1 = require("./triggers/turnosVentanilla");
Object.defineProperty(exports, "publicarTurnosVentanilla", { enumerable: true, get: function () { return turnosVentanilla_1.publicarTurnosVentanilla; } });
var rollups_1 = require("./triggers/rollups");
Object.defineProperty(exports, "onOrderRollup", { enumerable: true, get: function () { return rollups_1.onOrderRollup; } });
var produccionAuth_1 = require("./triggers/produccionAuth");
Object.defineProperty(exports, "resetPinProduccion", { enumerable: true, get: function () { return produccionAuth_1.resetPinProduccion; } });
// ── Facturación electrónica ARCA ─────────────────────────────────────────────
// Requieren los secrets ARCA_CERT_PEM y ARCA_KEY_PEM (creados 2026-09-01) y el
// documento config/arca. Que estén desplegadas NO significa que emitan: el
// interruptor real es `config/arca.habilitado`, que arranca en false.
// Ver docs/arca/FACTURACION_ELECTRONICA.md.
var arcaFacturacion_1 = require("./triggers/arcaFacturacion");
Object.defineProperty(exports, "onVentaContadoFacturar", { enumerable: true, get: function () { return arcaFacturacion_1.onVentaContadoFacturar; } });
Object.defineProperty(exports, "onVentaVentanillaContadoFacturar", { enumerable: true, get: function () { return arcaFacturacion_1.onVentaVentanillaContadoFacturar; } });
Object.defineProperty(exports, "reconciliarFacturasArca", { enumerable: true, get: function () { return arcaFacturacion_1.reconciliarFacturasArca; } });
// Anulación de facturas de ventanilla con nota de crédito (2026-09-09): el
// cajero pide, un usuario con `autorizaAnulaciones` aprueba, el server emite.
var anulacionesVentanilla_1 = require("./triggers/anulacionesVentanilla");
Object.defineProperty(exports, "onAnulacionSolicitada", { enumerable: true, get: function () { return anulacionesVentanilla_1.onAnulacionSolicitada; } });
Object.defineProperty(exports, "onAnulacionResuelta", { enumerable: true, get: function () { return anulacionesVentanilla_1.onAnulacionResuelta; } });
// Aviso de vencimiento del padrón de IIBB. No declara los secrets de ARCA, así
// que se puede desplegar suelta.
var padronIIBB_1 = require("./triggers/padronIIBB");
Object.defineProperty(exports, "avisarPadronIIBB", { enumerable: true, get: function () { return padronIIBB_1.avisarPadronIIBB; } });
// Envío por mail de un comprobante generado en la app (factura, remito, composición) al cliente (2026-09-10).
var enviarComprobante_1 = require("./triggers/enviarComprobante");
Object.defineProperty(exports, "enviarComprobantePorMail", { enumerable: true, get: function () { return enviarComprobante_1.enviarComprobantePorMail; } });
// COT de ARBA del remito de carga (2026-09-10): requiere el secret ARBA_CIT y
// config/cot; el interruptor es config/cot.habilitado. Ver docs/arba/COT.md.
var cotArba_1 = require("./triggers/cotArba");
Object.defineProperty(exports, "onRemitoCargaCotSolicitado", { enumerable: true, get: function () { return cotArba_1.onRemitoCargaCotSolicitado; } });
Object.defineProperty(exports, "presentarCotRemito", { enumerable: true, get: function () { return cotArba_1.presentarCotRemito; } });
//# sourceMappingURL=index.js.map