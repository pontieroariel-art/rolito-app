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
