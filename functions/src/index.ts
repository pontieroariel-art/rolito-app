import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
initializeApp()

// Cuota de CPU de Cloud Run (2026-09-14): la región tiene 20 vCPU en total y
// Google no deja pedir más desde la consola. Cada function gen2 ocupaba 1 vCPU
// entera mientras tenía una instancia viva (incluso ociosa ~15 min): con 71
// functions, un lunes a pleno llegaba a 20 instancias y toda function fría
// rebotaba con "quota exceeded". A 0,25 vCPU entran 80 instancias en la misma
// cuota. Con CPU fraccionaria Cloud Run exige concurrencia 1; las doce
// functions de 512 MiB (syncs de Tango, mail) van a 0,5 en su propia definición.
// Va ANTES de los exports: los módulos de triggers se cargan después y toman
// estos valores como default.
setGlobalOptions({ cpu: 0.25, concurrency: 1 })

// Nota: cambio trivial para forzar un hash de fuente distinto y que
// `firebase deploy --only functions` no salte el redeploy de las 12
// functions que quedaron en una revisión de Cloud Run vieja tras el
// "Quota exceeded for total allowable CPU per project per region" del
// 2026-08-16 (firebase-tools marca el hash como "ya deployado" apenas se
// actualiza la config, aunque el rollout de la revisión haya fallado
// después por la cuota).

export { onUserRegistered, onUserApproved, onClienteCreadoPorStaff } from './triggers/users'
// Rol/estado/planta/permisos en el token (custom claims): las reglas no leen users/{uid} (2026-09-12).
export { onUserClaims } from './triggers/claims'
// Índice liviano de clientes para los buscadores (clientesIndex/{uid}, 2026-09-10).
export { onClienteIndexado } from './triggers/clientesIndex'
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
export { onPedidoSupervisorCreado, onVisitaSupervisorCreada } from './triggers/supervisor'
export { backupAuthUsers }                     from './triggers/authBackup'
export { onHistorialAdminAltoRiesgo, enviarResumenAdminDiario } from './triggers/adminAudit'
export { syncClientesTango }                    from './triggers/tangoSync'
export { syncSaldosTango }                      from './triggers/tangoSaldos'
export { onConsultaRespondida }                 from './triggers/tangoConsultas'
export { onProduccionPalletCreado, onVentaCamionCreada, onVentaCamionFacturada, onVentaVentanillaCreada, onVentaVentanillaFacturada, onAnulacionEmitida, onRemitoCargaCreado, onDescargaCamionCreada, onLiquidacionCerrada, onCobranzaCreada, onOutboxConfirmado } from './triggers/tangoOutbox'
export { onOutboxPendiente, barridoOutboxTango }  from './triggers/tangoWorker'
export { syncPreciosTango, sincronizarPreciosTangoAhora } from './triggers/tangoPrecios'
export { syncClientesTangoConnect, syncSaldosTangoConnect, sincronizarClientesTangoAhora, sincronizarSaldosTangoAhora, onConsultaSaldoPendiente } from './triggers/tangoConnectSync'
export { altasClientesTango, procesarAltasTangoAhora } from './triggers/tangoAltas'
export { syncDepositosTango, sincronizarDepositosTangoAhora } from './triggers/tangoDepositos'
export { publicarTurnosVentanilla } from './triggers/turnosVentanilla'
// Estado público del muelle (2026-09-15): dársenas ocupadas, para que el chofer que
// volvió elija entre las libres sin leer remitos ajenos ni la ventanilla.
export { publicarMuelleEstadoRemito, publicarMuelleEstadoDescarga, publicarMuelleEstadoVentanilla } from './triggers/muelleEstado'
export { onOrderRollup } from './triggers/rollups'
export { resetPinProduccion } from './triggers/produccionAuth'
// "Ver como usuario" (2026-09-10): custom token de solo lectura para el super_admin.
export { crearTokenImpersonacion } from './triggers/impersonacion'
// El mail del staff es inventado, así que el "olvidé mi contraseña" lo hace el
// super_admin a mano (2026-09-20).
export { resetearPasswordStaff } from './triggers/staffPassword'

// ── Facturación electrónica ARCA ─────────────────────────────────────────────
// Requieren los secrets ARCA_CERT_PEM y ARCA_KEY_PEM (creados 2026-09-01) y el
// documento config/arca. Que estén desplegadas NO significa que emitan: el
// interruptor real es `config/arca.habilitado`, que arranca en false.
// Ver docs/arca/FACTURACION_ELECTRONICA.md.
export { onVentaContadoFacturar, onVentaVentanillaContadoFacturar, reconciliarFacturasArca } from './triggers/arcaFacturacion'
// Anulación de facturas de ventanilla con nota de crédito (2026-09-09): el
// cajero pide, un usuario con `autorizaAnulaciones` aprueba, el server emite.
export { onAnulacionSolicitada, onAnulacionResuelta } from './triggers/anulacionesVentanilla'
// Remito de cta. cte. anulado por el chofer sin autorización (2026-09-11): aviso a
// facturación para anularlo en Tango y confirmación por el lector de comprobantes.
export { onVentaCamionAnulada, onVentaVentanillaAnulada, reconciliarRemitosAnulados } from './triggers/ventasAnuladas'
export { onDescargaContada } from './triggers/descargaRevision'
// Anulación de un recibo de cobranza con autorización (2026-09-15): el que cobró
// pide, un autorizante aprueba, el server marca la cobranza y avisa; la oficina
// lo anula en Tango y la reconciliación horaria lo confirma.
export { onAnulacionReciboSolicitada, onAnulacionReciboResuelta, reconciliarRecibosAnulados } from './triggers/anulacionesCobranza'
export { onDesvioSolicitado, onDesvioResuelto } from './triggers/desviosDescarga'
// "Preguntar a Tango ahora" desde Comprobantes de clientes (2026-09-20): corre
// la misma reconciliación que el barrido horario, sin esperarlo.
export { verificarAnuladosEnTango } from './triggers/anuladosEnTango'
export { onDescargaRectificada } from './triggers/descargaRectificada'
// Aviso de vencimiento del padrón de IIBB. No declara los secrets de ARCA, así
// que se puede desplegar suelta.
export { avisarPadronIIBB } from './triggers/padronIIBB'

// Envío por mail de un comprobante generado en la app (factura, remito, composición) al cliente (2026-09-10).
export { enviarComprobantePorMail } from './triggers/enviarComprobante'

// COT de ARBA del remito de carga (2026-09-10): requiere el secret ARBA_CIT y
// config/cot; el interruptor es config/cot.habilitado. Ver docs/arba/COT.md.
export { onRemitoCargaCotSolicitado, presentarCotRemito } from './triggers/cotArba'
