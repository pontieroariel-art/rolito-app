import { useMutation } from '@tanstack/react-query'
import { notifyCerca, notifyReprogramado } from '../services/notificationService'

// El resto de las notificaciones por email (registro, aprobación, pedido
// recibido/confirmado/en-camino, nuevo pedido al admin) las envían triggers de
// Firestore server-side (functions/src/triggers), no el cliente.

export const useNotifyCerca = () =>
  useMutation({ mutationFn: notifyCerca })

export const useNotifyReprogramado = () =>
  useMutation({ mutationFn: notifyReprogramado })
