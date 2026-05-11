import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { onUserRegistered, onUserApproved } from './triggers/users'
export { onOrderCreated,   onOrderEnCamino } from './triggers/orders'
