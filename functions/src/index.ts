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
export { onProduccionPalletCreado, onVentaCamionCreada, onVentaCamionFacturada, onVentaVentanillaCreada, onVentaVentanillaFacturada, onRemitoCargaCreado, onDescargaCamionCreada, onCobranzaCreada, onOutboxConfirmado } from './triggers/tangoOutbox'
export { publicarTurnosVentanilla } from './triggers/turnosVentanilla'
export { onOrderRollup } from './triggers/rollups'
export { resetPinProduccion } from './triggers/produccionAuth'

// ── Facturación electrónica ARCA ─────────────────────────────────────────────
// Requieren los secrets ARCA_CERT_PEM y ARCA_KEY_PEM (creados 2026-09-01) y el
// documento config/arca. Que estén desplegadas NO significa que emitan: el
// interruptor real es `config/arca.habilitado`, que arranca en false.
// Ver docs/arca/FACTURACION_ELECTRONICA.md.
export { onVentaContadoFacturar, onVentaVentanillaContadoFacturar, reconciliarFacturasArca } from './triggers/arcaFacturacion'
// Aviso de vencimiento del padrón de IIBB. No declara los secrets de ARCA, así
// que se puede desplegar suelta.
export { avisarPadronIIBB } from './triggers/padronIIBB'
