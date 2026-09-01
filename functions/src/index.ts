import { initializeApp } from 'firebase-admin/app'
initializeApp()

// Nota: cambio trivial para forzar un hash de fuente distinto y que
// `firebase deploy --only functions` no salte el redeploy de las 12
// functions que quedaron en una revisión de Cloud Run vieja tras el
// "Quota exceeded for total allowable CPU per project per region" del
// 2026-08-16 (firebase-tools marca el hash como "ya deployado" apenas se
// actualiza la config, aunque el rollout de la revisión haya fallado
// después por la cuota).

export { onUserRegistered, onUserApproved, onClienteCreadoPorStaff } from './triggers/users'
export { onOrderCreated, onOrderConfirmado, onOrderEnCamino } from './triggers/orders'
export { deleteAuthUsers }                     from './triggers/cleanup'
export { sendPush }                            from './triggers/push'
export { notifyCerca, notifyReprogramado }     from './triggers/clientNotify'
export { validarPreciosPedido }                from './triggers/orderPricing'
export { mirrorDriverLocation }                from './triggers/location'
export { orsDirections }                       from './triggers/routing'
export { generarPedidosRecurrentes }           from './triggers/recurrentes'
export { onTicketCerrado, onStockBajo, onTicketCreado } from './triggers/heladeras'
export { avisarComodatosPorVencer }             from './triggers/comodatos'
export { backupAuthUsers }                     from './triggers/authBackup'
export { onHistorialAdminAltoRiesgo, enviarResumenAdminDiario } from './triggers/adminAudit'
export { syncClientesTango }                    from './triggers/tangoSync'
export { syncSaldosTango }                      from './triggers/tangoSaldos'
export { onConsultaRespondida }                 from './triggers/tangoConsultas'
export { onProduccionPalletCreado, onVentaCamionCreada, onCobranzaCreada, onOutboxConfirmado } from './triggers/tangoOutbox'
export { publicarTurnosVentanilla } from './triggers/turnosVentanilla'
export { onOrderRollup } from './triggers/rollups'
export { resetPinProduccion } from './triggers/produccionAuth'

// ── Facturación electrónica ARCA ─────────────────────────────────────────────
// A PROPÓSITO todavía sin exportar. Estas funciones declaran los secrets
// ARCA_CERT_PEM y ARCA_KEY_PEM, y `firebase deploy --only functions` FALLA
// ENTERO si un secret declarado no existe — bloquearía también el deploy de
// funciones que no tienen nada que ver.
//
// Para habilitarlas:
//   1. firebase functions:secrets:set ARCA_CERT_PEM   (pegar el .crt completo)
//   2. firebase functions:secrets:set ARCA_KEY_PEM    (pegar la .key completa)
//   3. Crear config/arca en Firestore (ver services/arca/configuracion.ts;
//      arranca con habilitado: false y se enciende cuando esté probado).
//   4. Descomentar la línea de abajo, compilar y desplegar.
//
// Ver docs/arca/FACTURACION_ELECTRONICA.md.
// export { onVentaContadoFacturar, reconciliarFacturasArca } from './triggers/arcaFacturacion'
