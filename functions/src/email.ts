import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'

// Salida de mails de la app (2026-09-17): SMTP de Microsoft 365 de Redonhielo
// (casilla técnica WebMail@redonhielo.com.ar, 10.000 destinatarios/día, 30
// mails/minuto; decisión de Ariel: ya tienen la licencia) como proveedor
// principal, y Resend (100 mails/día en el plan gratuito, que se agotó el
// 14/09) como respaldo. El proveedor se elige por `configuracion/
// notificaciones.proveedorMail` ('smtp' | 'resend'); sin ese campo, SMTP si
// hay contraseña cargada y si no Resend. Host, puerto, usuario y remitentes
// van en functions/.env (no son secretos); la contraseña de la casilla es el
// secret SMTP_PASSWORD (`firebase functions:secrets:set SMTP_PASSWORD`).
// OJO: Microsoft apaga el SMTP con contraseña a fines de diciembre de 2026;
// antes de eso hay que pasar `porSmtp` a OAuth (XOAUTH2 con una app de Entra).

export const resendApiKey = defineSecret('RESEND_API_KEY')
export const smtpPassword = defineSecret('SMTP_PASSWORD')
/** Secrets que declara TODA function que manda mails (`secrets: MAIL_SECRETS`). */
export const MAIL_SECRETS = [smtpPassword, resendApiKey]

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Rolito <onboarding@resend.dev>'
export const APP_URL    = process.env.APP_URL    ?? 'https://rolito-app.web.app'
/**
 * Adónde van las respuestas de los clientes cuando el mail no lleva un
 * `replyTo` propio (los automáticos): la casilla técnica no la lee nadie, así
 * que van a Facturación. Los envíos manuales ya llevan el mail del operador.
 */
export const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || undefined
const SMTP_HOST = process.env.SMTP_HOST ?? 'smtp.office365.com'
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_USER = process.env.SMTP_USER ?? 'WebMail@redonhielo.com.ar'

export type ProveedorMail = 'smtp' | 'resend'

export interface AdjuntoMail { filename: string; content: Buffer }

export interface Mail {
  to:           string | string[]
  subject:      string
  html:         string
  cc?:          string
  replyTo?:     string
  attachments?: AdjuntoMail[]
}

export interface ResultadoMail {
  proveedor: ProveedorMail | 'ninguno'
  /** Id que devuelve el proveedor (messageId de SMTP o id de Resend). */
  id?:       string
  error?:    string
}

interface ConfigNotificaciones {
  modoTest?:      boolean
  testEmail?:     string
  proveedorMail?: ProveedorMail
}

/** `.value()` de un secret no cargado revienta en el emulador: lo tratamos como vacío. */
const valorSecreto = (s: { value(): string }): string => {
  try { return s.value() ?? '' } catch { return '' }
}

const leerConfig = async (): Promise<ConfigNotificaciones> => {
  try {
    const snap = await getFirestore().doc('configuracion/notificaciones').get()
    return (snap.data() ?? {}) as ConfigNotificaciones
  } catch {
    return {} // sin config: destino real, proveedor por defecto
  }
}

const elegirProveedor = (cfg: ConfigNotificaciones): ProveedorMail | 'ninguno' => {
  const smtp = valorSecreto(smtpPassword)
  const resend = valorSecreto(resendApiKey)
  if (cfg.proveedorMail === 'resend') return resend ? 'resend' : smtp ? 'smtp' : 'ninguno'
  if (cfg.proveedorMail === 'smtp')   return smtp ? 'smtp' : resend ? 'resend' : 'ninguno'
  return smtp ? 'smtp' : resend ? 'resend' : 'ninguno'
}

const porSmtp = async (mail: Mail): Promise<string | undefined> => {
  // Import diferido (2026-09-12): la librería solo se carga cuando se manda un mail.
  const nodemailer = await import('nodemailer')
  const transporte = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465, // 587 = STARTTLS obligatorio (Microsoft 365, Hostinger)
    auth: { user: SMTP_USER, pass: valorSecreto(smtpPassword) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  try {
    const info = await transporte.sendMail({
      from: FROM_EMAIL,
      to: mail.to,
      ...(mail.cc ? { cc: mail.cc } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      subject: mail.subject,
      html: mail.html,
      ...(mail.attachments?.length
        ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: 'application/pdf' })) }
        : {}),
    })
    return info.messageId
  } finally {
    transporte.close()
  }
}

const porResend = async (mail: Mail): Promise<string | undefined> => {
  const { Resend } = await import('resend')
  const resend = new Resend(valorSecreto(resendApiKey))
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: mail.to,
    ...(mail.cc ? { cc: mail.cc } : {}),
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    subject: mail.subject,
    html: mail.html,
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
  })
  if (error) throw new Error(String(error.message ?? error))
  return data?.id
}

/**
 * Manda un mail por el proveedor configurado, respetando el modo test
 * (`configuracion/notificaciones.modoTest` + `testEmail`: todo se desvía a la
 * casilla de prueba con el destino original en el asunto). Nunca lanza: el
 * error vuelve en `resultado.error` para que el que llama decida.
 */
export const enviarMail = async (mail: Mail): Promise<ResultadoMail> => {
  const cfg = await leerConfig()
  let envio: Mail = { ...mail, replyTo: mail.replyTo ?? REPLY_TO_EMAIL }
  if (cfg.modoTest === true && cfg.testEmail) {
    const destinos = [mail.to].flat().join(', ')
    console.log(`[MODO TEST] Email interceptado → para: ${destinos} → redirigido a: ${cfg.testEmail} | Asunto: ${mail.subject}`)
    envio = { ...envio, to: cfg.testEmail, cc: undefined, subject: `[TEST → ${destinos}] ${mail.subject}` }
  }
  const proveedor = elegirProveedor(cfg)
  if (proveedor === 'ninguno') {
    console.warn('Ni SMTP_PASSWORD ni RESEND_API_KEY configurados — email omitido:', mail.subject)
    return { proveedor, error: 'El envío de mails no está configurado' }
  }
  try {
    const id = proveedor === 'smtp' ? await porSmtp(envio) : await porResend(envio)
    return { proveedor, ...(id ? { id } : {}) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`Error enviando email por ${proveedor}:`, error)
    return { proveedor, error }
  }
}

/** Aviso simple sin adjuntos (pedidos, usuarios, alertas): loguea el error y sigue. */
export const sendEmail = async (
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> => {
  await enviarMail({ to, subject, html })
}
