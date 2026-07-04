import { initializeApp } from 'firebase-admin/app'
initializeApp()

export { onUserRegistered, onUserApproved }    from './triggers/users'
export { onOrderCreated, onOrderConfirmado, onOrderEnCamino } from './triggers/orders'
export { deleteAuthUsers }                     from './triggers/cleanup'
export { sendPush }                            from './triggers/push'
export { notifyCerca, notifyReprogramado }     from './triggers/clientNotify'
