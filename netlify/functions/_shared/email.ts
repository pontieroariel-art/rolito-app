import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'onboarding@resend.dev'
export const APP_URL    = process.env.APP_URL    ?? 'https://rolito-app.netlify.app'

export const sendEmail = async (
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> => {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY no configurada — email omitido:', subject)
    return
  }
  const { error } = await resend.emails.send({
    from: `Rolito <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  })
  if (error) console.error('Resend error:', error)
}
