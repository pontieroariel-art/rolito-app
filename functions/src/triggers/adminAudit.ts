import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'
import { tplAdminAccionAltoRiesgo, tplAdminResumenDiario } from '../templates'

const TZ = 'America/Argentina/Buenos_Aires'

async function adminEmails(): Promise<string[]> {
  try {
    const snap = await getFirestore().doc('configuracion/notificaciones').get()
    return (snap.data()?.emails ?? []) as string[]
  } catch {
    return []
  }
}

// Alerta instantánea — cambio de rol, alta/baja de personal (riesgo='alto'
// en historialAdminService.ts). Ver plan de migración del Backoffice, Fase 4.
export const onHistorialAdminAltoRiesgo = onDocumentCreated(
  { document: 'historialAdmin/{eventoId}', secrets: [resendApiKey] },
  async (event) => {
    const data = event.data?.data()
    if (!data || data.riesgo !== 'alto') return

    const emails = await adminEmails()
    if (emails.length === 0) return

    const actor = data.actor as { nombre?: string; rol?: string } | undefined
    await sendEmail(
      emails,
      `Backoffice: ${data.accion ?? 'cambio'} — ${data.coleccion ?? ''}`,
      tplAdminAccionAltoRiesgo({
        actorNombre: actor?.nombre ?? 'Alguien',
        actorRol:    actor?.rol ?? '',
        coleccion:   (data.coleccion ?? '') as string,
        accion:      (data.accion ?? '') as string,
        detalle:     (data.detalle ?? null) as string | null,
      }, APP_URL),
    )
  },
)

// Resumen diario — todo lo de riesgo='rutina' del día anterior (Flota,
// Modelos, Catálogos de service, Técnicos, Pañol). Corre después de
// generarPedidosRecurrentes (6am ART) para no competir por cuota.
export const enviarResumenAdminDiario = onSchedule(
  { schedule: '0 7 * * *', timeZone: TZ, secrets: [resendApiKey] },
  async () => {
    const db = getFirestore()

    // Rango [ayer 00:00, hoy 00:00) visto desde Argentina.
    const hoyPartes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
    const hoyInicio = new Date(`${hoyPartes}T00:00:00-03:00`)
    const ayerInicio = new Date(hoyInicio)
    ayerInicio.setDate(ayerInicio.getDate() - 1)

    const snap = await db.collection('historialAdmin')
      .where('riesgo', '==', 'rutina')
      .where('fecha', '>=', Timestamp.fromDate(ayerInicio))
      .where('fecha', '<', Timestamp.fromDate(hoyInicio))
      .orderBy('fecha', 'asc')
      .get()

    if (snap.empty) {
      console.log('[enviarResumenAdminDiario] sin cambios de rutina ayer, no se manda mail')
      return
    }

    const emails = await adminEmails()
    if (emails.length === 0) return

    const eventos = snap.docs.map((d) => {
      const data = d.data()
      const actor = data.actor as { nombre?: string } | undefined
      return {
        actorNombre: actor?.nombre ?? 'Alguien',
        coleccion:   (data.coleccion ?? '') as string,
        accion:      (data.accion ?? '') as string,
        detalle:     (data.detalle ?? null) as string | null,
      }
    })

    await sendEmail(
      emails,
      `Backoffice: resumen diario (${eventos.length} cambio${eventos.length !== 1 ? 's' : ''})`,
      tplAdminResumenDiario(eventos, APP_URL),
    )
  },
)
