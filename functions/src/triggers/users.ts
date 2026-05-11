import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { sendEmail, APP_URL } from '../email'
import {
  tplRegistroPendiente,
  tplCuentaAprobada,
} from '../templates'

// Dispara cuando se crea un documento en users/{uid}
// Solo notifica a clientes con estado 'pendiente'
export const onUserRegistered = onDocumentCreated('users/{uid}', async (event) => {
  const data = event.data?.data()
  if (!data) return
  if (data.rol !== 'cliente' || data.estado !== 'pendiente') return

  const nombre = (data.nombreContacto || data.nombre || 'Cliente') as string
  const email  = data.email as string
  if (!email) return

  await sendEmail(
    email,
    'Tu cuenta en Rolito está siendo verificada',
    tplRegistroPendiente(nombre),
  )
})

// Dispara cuando se actualiza un documento en users/{uid}
// Solo notifica cuando el estado cambia de 'pendiente' a 'activo'
export const onUserApproved = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.estado !== 'pendiente' || after.estado !== 'activo') return
  if (after.rol !== 'cliente') return

  const nombre = (after.nombreContacto || after.nombre || 'Cliente') as string
  const email  = after.email as string
  if (!email) return

  await sendEmail(
    email,
    '¡Tu cuenta en Rolito fue aprobada!',
    tplCuentaAprobada(nombre, APP_URL),
  )
})
