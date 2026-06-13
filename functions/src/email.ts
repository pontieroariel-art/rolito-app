import { Resend } from 'resend'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'

export const resendApiKey = defineSecret('RESEND_API_KEY')

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Rolito <onboarding@resend.dev>'
export const APP_URL    = process.env.APP_URL    ?? 'https://rolito-app.web.app'

export const sendEmail = async (
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> => {
  const apiKey = resendApiKey.value()
  if (!apiKey) {
    console.warn('RESEND_API_KEY no configurada — email omitido:', subject)
    return
  }
  const resend = new Resend(apiKey)

  // Modo test: redirige todos los emails a la dirección de prueba
  let recipient = to
  try {
    const db = getFirestore()
    const configSnap = await db.doc('configuracion/notificaciones').get()
    const config = configSnap.data()
    if (config?.modoTest === true && config?.testEmail) {
      const destinos = Array.isArray(to) ? to.join(', ') : to
      console.log(`[MODO TEST] Email interceptado → para: ${destinos} → redirigido a: ${config.testEmail} | Asunto: ${subject}`)
      recipient = config.testEmail as string
      subject   = `[TEST → ${destinos}] ${subject}`
    }
  } catch {
    // Si falla la lectura de config, enviamos al destino real
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to:   recipient,
      subject,
      html,
    })
    if (error) console.error('Resend error:', error)
  } catch (err) {
    console.error('Error enviando email:', err)
  }
}
