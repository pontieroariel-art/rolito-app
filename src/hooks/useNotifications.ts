import { useMutation } from '@tanstack/react-query'
import {
  notifyAprobado,
  notifyPedidoRecibido,
  notifyEnCamino,
  notifyAdminNuevoPedido,
  notifyCerca,
  notifyReprogramado,
} from '../services/notificationService'

export const useNotifyAprobado = () =>
  useMutation({
    mutationFn: ({ email, nombre }: { email: string; nombre: string }) =>
      notifyAprobado(email, nombre),
  })

export const useNotifyPedidoRecibido = () =>
  useMutation({ mutationFn: notifyPedidoRecibido })

export const useNotifyEnCamino = () =>
  useMutation({ mutationFn: notifyEnCamino })

export const useNotifyAdminNuevoPedido = () =>
  useMutation({ mutationFn: notifyAdminNuevoPedido })

export const useNotifyCerca = () =>
  useMutation({ mutationFn: notifyCerca })

export const useNotifyReprogramado = () =>
  useMutation({ mutationFn: notifyReprogramado })
