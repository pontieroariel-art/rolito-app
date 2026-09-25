import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'

// Salida de mails de la app (2026-09-24): Resend Pro con el dominio
// rolito.com.ar verificado (DKIM + return-path en el DNS de Hostinger) como
// proveedor principal, y el SMTP de Microsoft 365 de Redonhielo (casilla
// técnica WebMail@redonhielo.com.ar) como respaldo. Antes era al revés
// (2026-09-17) y Microsoft restringió la casilla dos veces en tres días por
// "patrones de envío anómalos": cien comprobantes por día con PDF, a
// destinatarios distintos, desde una casilla de PERSONA con contraseña, se
// parece a una cuenta tomada. Y el mail figuraba "enviado" aunque Microsoft
// lo frenara después de aceptarlo. Con correo transaccional de verdad el
// proveedor avisa por webhook lo que pasó con cada mail (`resendWebhook`) y
// el estado real queda en `mailsSalientes`.
// El proveedor se elige por `configuracion/notificaciones.proveedorMail`
// ('resend' | 'smtp'); sin ese campo, Resend si hay clave. Remitentes, host y
// usuario van en functions/.env (no son secretos); la clave de Resend y la
// contraseña de la casilla son secrets.
// OJO: Microsoft apaga el SMTP con contraseña a fines de diciembre de 2026;
// si el respaldo se quiere mantener hay que pasar `porSmtp` a OAuth.

export const resendApiKey = defineSecret('RESEND_API_KEY')
export const smtpPassword = defineSecret('SMTP_PASSWORD')
/** Secrets que declara TODA function que manda mails (`secrets: MAIL_SECRETS`). */
export const MAIL_SECRETS = [smtpPassword, resendApiKey]

export const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Rolito <onboarding@resend.dev>'
/**
 * Remitente para Resend: tiene que ser del dominio verificado ahí
 * (rolito.com.ar). El de SMTP (FROM_EMAIL) tiene que ser la casilla que se
 * autentica en Microsoft, así que no pueden ser el mismo.
 */
export const RESEND_FROM = process.env.RESEND_FROM ?? FROM_EMAIL
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

/**
 * Qué documento de la app tiene que enterarse de lo que pasó con el mail
 * (`campo` es la ruta del campo a escribir, con puntos: 'entrega' en
 * enviosComprobantes, 'envioMail.entrega' en la venta).
 */
export interface ReferenciaMail { coleccion: string; id: string; campo: string }

export interface Mail {
  to:           string | string[]
  subject:      string
  html:         string
  cc?:          string
  replyTo?:     string
  attachments?: AdjuntoMail[]
  /** Para el listado de mails: un comprobante al cliente o un aviso interno. */
  tipo?:        'comprobante' | 'aviso'
  referencias?: ReferenciaMail[]
}

/** Lo que el proveedor contó de un mail después de aceptarlo (por webhook). */
export type EstadoEntregaMail = 'entregado' | 'rebotado' | 'queja' | 'demorado'

export interface ResultadoMail {
  /** Con el que SALIÓ (puede no ser el primero que se intentó). */
  proveedor: ProveedorMail | 'ninguno'
  /** Id que devuelve el proveedor (messageId de SMTP o id de Resend). */
  id?:       string
  error?:    string
  /** Salió por el respaldo porque el primero falló; `errorPrimero` dice por qué. */
  respaldo?:      ProveedorMail
  errorPrimero?:  string
}

/**
 * Avisos internos a la oficina, cada uno con su lista de destinatarios en
 * `configuracion/notificaciones.avisos.<tipo>` (2026-09-17, pedido de Ariel:
 * "que se manden a donde deberían ir", no todo a su Gmail). Un tipo sin lista
 * propia cae en la lista general `emails`. Se editan en Ajustes generales.
 */
export type TipoAviso = 'nuevoPedido' | 'nuevoCliente' | 'backoffice' | 'padronIIBB' | 'rendicionesPendientes'

interface ConfigNotificaciones {
  modoTest?:      boolean
  testEmail?:     string
  proveedorMail?: ProveedorMail
  emails?:        string[]
  avisos?:        Partial<Record<TipoAviso, string[]>>
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

/** Destinatarios de un aviso interno: su lista propia o, si no tiene, la general. */
export const destinatariosAviso = async (tipo: TipoAviso): Promise<string[]> => {
  const cfg = await leerConfig()
  const propia = cfg.avisos?.[tipo]
  const lista = Array.isArray(propia) && propia.length ? propia : cfg.emails ?? []
  return lista.filter((e): e is string => typeof e === 'string' && e.includes('@'))
}

/**
 * En qué orden se intenta mandar. El primero es el elegido en la config; el
 * segundo queda de RESPALDO (2026-09-20).
 *
 * Hasta hoy había uno solo: si fallaba, el mail se perdía con un console.error
 * que nadie mira. El 19/09 Microsoft restringió la casilla
 * WebMail@redonhielo.com.ar por "patrones de envío anómalos" —cien y pico de
 * comprobantes por día a destinatarios distintos, desde una casilla de
 * persona, se parece a una cuenta tomada— y podríamos haber estado dos días
 * sin entregar un solo comprobante sin enterarnos.
 */
const ordenProveedores = (cfg: ConfigNotificaciones): ProveedorMail[] => {
  const disponibles: ProveedorMail[] = []
  if (valorSecreto(smtpPassword)) disponibles.push('smtp')
  if (valorSecreto(resendApiKey)) disponibles.push('resend')
  const preferido = cfg.proveedorMail ?? 'resend'
  if (!disponibles.includes(preferido)) return disponibles
  return [preferido, ...disponibles.filter((p) => p !== preferido)]
}

/**
 * Avisa UNA vez por día que el proveedor de siempre se cayó (2026-09-20).
 *
 * Va a `historialAdmin` con riesgo alto, que ya dispara mail instantáneo al
 * super_admin y sale en el panel de control: no hay que inventar un canal
 * nuevo. Una vez por día porque en un día de reparto esto se dispararía cien
 * veces, y cien avisos iguales no son un aviso, son ruido que se aprende a
 * ignorar. El `create` sobre un id con la fecha es el candado: el segundo
 * mail del día ya encuentra el doc y no escribe nada.
 */
async function avisarProveedorCaido(caido: ProveedorMail, uso: ProveedorMail, motivo: string): Promise<void> {
  const db = getFirestore()
  const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)   // día argentino
  try {
    await db.collection('avisosMailCaido').doc(`${caido}_${dia}`).create({ motivo, uso, en: new Date() })
  } catch {
    return   // ya se avisó hoy
  }
  try {
    await db.collection('historialAdmin').add({
      coleccion: 'configuracion',
      docId:     'notificaciones',
      accion:    'mail-proveedor-caido',
      detalle:   `El envío por ${caido} está fallando; los mails salen por ${uso}. Motivo: ${motivo}`,
      riesgo:    'alto',
      actor:     { uid: 'sistema', nombre: 'Sistema', rol: 'super_admin' },
      fecha:     new Date(),
    })
  } catch (e) {
    console.error('[mail] no se pudo registrar el aviso de proveedor caído:', (e as Error).message)
  }
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
    from: RESEND_FROM,
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
 * Id del registro en `mailsSalientes`: proveedor + id del proveedor, así el
 * webhook de Resend encuentra el doc sin consultar (el id de Resend es un
 * uuid; el messageId de SMTP trae <> y @, que se limpian).
 */
export const idMailSaliente = (proveedor: ProveedorMail, id: string): string =>
  `${proveedor}_${id.replace(/[^A-Za-z0-9_.-]/g, '')}`.slice(0, 200)

/**
 * Deja constancia de cada mail que salió, en `mailsSalientes` (2026-09-24):
 * a quién, qué, por dónde y, cuando el proveedor avise, qué pasó
 * (`entrega`). Es lo que mira la pantalla "Mails enviados" de facturación y
 * el tile del panel. Nunca hace fallar el envío: el mail ya salió.
 */
async function registrarMailSaliente(mail: Mail, r: ResultadoMail): Promise<void> {
  if (r.proveedor === 'ninguno') return
  try {
    const db = getFirestore()
    const ref = r.id ? db.collection('mailsSalientes').doc(idMailSaliente(r.proveedor, r.id)) : db.collection('mailsSalientes').doc()
    await ref.set({
      proveedor: r.proveedor,
      ...(r.id ? { mailId: r.id } : {}),
      para:      [mail.to].flat().map((t) => String(t)).slice(0, 10),
      asunto:    mail.subject.slice(0, 200),
      tipo:      mail.tipo ?? 'aviso',
      adjuntos:  mail.attachments?.length ?? 0,
      estado:    'aceptado',
      fecha:     FieldValue.serverTimestamp(),
      ...(r.respaldo ? { respaldo: r.respaldo, errorPrimero: r.errorPrimero ?? '' } : {}),
      ...(mail.referencias?.length ? { referencias: mail.referencias } : {}),
    })
  } catch (e) {
    console.error('[mail] no se pudo registrar el mail saliente:', (e as Error).message)
  }
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
  const orden = ordenProveedores(cfg)
  const principal = orden[0]
  if (!principal) {
    console.warn('Ni SMTP_PASSWORD ni RESEND_API_KEY configurados — email omitido:', mail.subject)
    return { proveedor: 'ninguno', error: 'El envío de mails no está configurado' }
  }

  let errorPrimero = ''
  for (const proveedor of orden) {
    try {
      const id = proveedor === 'smtp' ? await porSmtp(envio) : await porResend(envio)
      if (errorPrimero) {
        // Que se vea en los logs y en el registro del envío: el mail salió,
        // pero el proveedor de siempre está caído y alguien tiene que mirarlo.
        console.warn(`[mail] ${principal} falló y salió por ${proveedor}. Motivo: ${errorPrimero}`)
        await avisarProveedorCaido(principal, proveedor, errorPrimero)
        const r: ResultadoMail = { proveedor, ...(id ? { id } : {}), respaldo: proveedor, errorPrimero }
        await registrarMailSaliente(mail, r)
        return r
      }
      const r: ResultadoMail = { proveedor, ...(id ? { id } : {}) }
      await registrarMailSaliente(mail, r)
      return r
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`Error enviando email por ${proveedor}:`, error)
      if (!errorPrimero) errorPrimero = `${proveedor}: ${error}`
      else return { proveedor, error: `${errorPrimero} · ${proveedor}: ${error}` }
    }
  }
  // Un solo proveedor configurado y falló.
  return { proveedor: principal, error: errorPrimero }
}

/** Aviso simple sin adjuntos (pedidos, usuarios, alertas): loguea el error y sigue. */
export const sendEmail = async (
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> => {
  await enviarMail({ to, subject, html })
}
