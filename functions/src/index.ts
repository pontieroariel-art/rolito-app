import { initializeApp } from 'firebase-admin/app'
initializeApp()

export { onUserRegistered, onUserApproved, onClienteCreadoPorStaff } from './triggers/users'
export { onOrderCreated, onOrderConfirmado, onOrderEnCamino } from './triggers/orders'
export { deleteAuthUsers }                     from './triggers/cleanup'
export { sendPush }                            from './triggers/push'
export { notifyCerca, notifyReprogramado }     from './triggers/clientNotify'
export { validarPreciosPedido }                from './triggers/orderPricing'
export { mirrorDriverLocation }                from './triggers/location'
export { orsDirections }                       from './triggers/routing'
export { generarPedidosRecurrentes }           from './triggers/recurrentes'
