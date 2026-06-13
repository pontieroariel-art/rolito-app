import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplRegistroPendiente, tplCuentaAprobada } from '../templates'

export const onUserRegistered = onDocumentCreated({ document: 'users/{uid}', secrets: [resendApiKey] }, async (event) => {
  const data = event.data?.data()
  if (!data) return
  if (data.rol !== 'cliente' || data.estado !== 'pendiente') return

  const nombre = (data.nombreContacto || data.nombre || 'Cliente') as string
  const email  = data.email as string | undefined
  if (!email) return

  await sendEmail(email, 'Tu cuenta en Rolito está siendo verificada', tplRegistroPendiente(nombre))
})

export const onUserApproved = onDocumentUpdated({ document: 'users/{uid}', secrets: [resendApiKey] }, async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()
  if (!before || !after) return
  if (before.estado !== 'pendiente' || after.estado !== 'activo') return
  if (after.rol !== 'cliente') return

  const nombre = (after.nombreContacto || after.nombre || 'Cliente') as string
  const email  = after.email as string | undefined
  if (!email) return

  await sendEmail(email, '¡Tu cuenta en Rolito fue aprobada!', tplCuentaAprobada(nombre, APP_URL))
})
