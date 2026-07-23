import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplRegistroPendiente, tplCuentaAprobada, tplAdminNuevoCliente } from '../templates'

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

// Alta de cliente hecha por staff desde /usuarios (CrearClienteModal) — se
// distingue del autorregistro público porque solo esos documentos traen
// `creadoPor`. Avisa a la lista de staff (configuracion/notificaciones) quién
// lo creó, ya que el alta rápida ya no pasa por aprobación previa.
export const onClienteCreadoPorStaff = onDocumentCreated({ document: 'users/{uid}', secrets: [resendApiKey] }, async (event) => {
  const data = event.data?.data()
  if (!data) return
  if (data.rol !== 'cliente' || !data.creadoPor) return

  let adminEmails: string[] = []
  try {
    const snap = await getFirestore().doc('configuracion/notificaciones').get()
    adminEmails = (snap.data()?.emails ?? []) as string[]
  } catch { /* sin config */ }
  if (adminEmails.length === 0) return

  const creadoPor = data.creadoPor as { nombre?: string; rol?: string }
  await sendEmail(
    adminEmails,
    `Nuevo cliente: ${data.razonSocial ?? ''}`,
    tplAdminNuevoCliente({
      razonSocial:     (data.razonSocial ?? '') as string,
      cuit:            (data.cuit ?? '') as string,
      address:         (data.address ?? '') as string,
      creadoPorNombre: creadoPor.nombre ?? 'Staff',
      creadoPorRol:    creadoPor.rol ?? '',
    }),
  )
})
