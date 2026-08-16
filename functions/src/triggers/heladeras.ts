import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplTicketCerrado, tplStockBajo } from '../templates'

async function getClientEmail(clientId: string | undefined): Promise<string | undefined> {
  if (!clientId) return undefined
  try {
    const snap = await getFirestore().doc(`users/${clientId}`).get()
    return snap.data()?.email as string | undefined
  } catch { return undefined }
}

// Ticket de service cerrado → email al cliente. El técnico/chofer que hace
// el trabajo en campo no está en condiciones de avisar (cierra el encargado
// desde Consulta de service, a veces horas después), por eso es un trigger
// server-side y no un push client-initiated como el resto del módulo.
export const onTicketCerrado = onDocumentUpdated({ document: 'ticketsServicio/{ticketId}', secrets: [resendApiKey] }, async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined
  const after  = event.data?.after.data()  as Record<string, unknown> | undefined
  if (!before || !after) return
  if (before.estado === 'cerrado' || after.estado !== 'cerrado') return

  const email = await getClientEmail(after.clientId as string | undefined)
  if (!email) return

  const clientName = (after.clientName || '') as string
  const nombre = clientName.split(' ')[0] || 'Cliente'

  await sendEmail(
    email,
    'Tu service fue completado - Rolito',
    tplTicketCerrado(
      nombre,
      (after.heladeraCodigo || '') as string,
      (after.motivoNombre || '') as string,
      after.trabajoRealizado as string | undefined,
      APP_URL,
    ),
  )
})

// Cruce por debajo del stock mínimo → email a los encargados de heladeras.
// La transacción que descuenta stock (registrarEntrega) no tiene forma de
// saber si ESE movimiento cruzó el mínimo sin leer el doc post-escritura, así
// que se resuelve acá con el before/after real de Firestore. `avisoStockBajoEnviado`
// evita reenviar en cada movimiento mientras el stock sigue bajo, pero se
// resetea apenas se repone por encima del mínimo para poder re-disparar en un
// futuro cruce (a diferencia de avisoCercaEnviado, que es one-shot por pedido).
export const onStockBajo = onDocumentUpdated({ document: 'panolArticulos/{articuloId}', secrets: [resendApiKey] }, async (event) => {
  const before = event.data?.before.data() as Record<string, unknown> | undefined
  const after  = event.data?.after.data()  as Record<string, unknown> | undefined
  if (!before || !after) return

  const stockActual = after.stockActual as number
  const stockMinimo = after.stockMinimo as number
  const stockAntes  = before.stockActual as number
  const minimoAntes = before.stockMinimo as number

  // Se repuso por encima del mínimo: rearma el aviso para el próximo cruce.
  if (stockActual >= stockMinimo) {
    if (after.avisoStockBajoEnviado === true) await event.data!.after.ref.update({ avisoStockBajoEnviado: false })
    return
  }

  const yaEstabaBajo = stockAntes < minimoAntes
  const yaAvisado     = after.avisoStockBajoEnviado === true
  if (yaEstabaBajo || yaAvisado) return

  await event.data!.after.ref.update({ avisoStockBajoEnviado: true })

  let encargadosEmails: string[] = []
  try {
    const snap = await getFirestore().collection('users')
      .where('rol', '==', 'heladeras_encargado').where('estado', '==', 'activo').get()
    encargadosEmails = snap.docs.map((d) => d.data().email as string).filter(Boolean)
  } catch { /* sin encargados configurados */ }
  if (encargadosEmails.length === 0) return

  await sendEmail(
    encargadosEmails,
    `Stock bajo: ${(after.nombre || '') as string} - Rolito`,
    tplStockBajo({ nombre: (after.nombre || '') as string, stockActual, stockMinimo }, APP_URL),
  )
})
