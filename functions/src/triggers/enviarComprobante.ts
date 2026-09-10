import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { Resend } from 'resend'
import { FROM_EMAIL, resendApiKey } from '../email'
import { assertRateLimit } from '../rateLimit'

// Envío por mail de un comprobante que la app generó (factura, remito,
// composición de saldos, recibo) al cliente (2026-09-10, pedido de Ariel: "lo
// que más usan es el mail"). Un mailto: no puede adjuntar archivos, así que el
// PDF viaja en base64 a esta función y sale por Resend con el adjunto. Queda
// registrado en enviosComprobantes (quién, a quién, qué y cuándo).
//
// Quién puede: staff que cobra o gestiona (mismos roles que leen saldosTango).
// El destinatario lo elige el operador en pantalla (viene precargado con el
// mail de Tango del cliente): se valida el formato y se lo registra.

const ROLES = new Set([
  'super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica',
  'facturacion', 'tesoreria', 'supervisor', 'caja', 'chofer',
])
const MAX_PDF_BYTES = 4 * 1024 * 1024
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Entrada {
  para:          string
  asunto:        string
  mensaje?:      string
  nombreArchivo: string
  pdfBase64:     string
  comprobante:   { tipo: string; numero: string; empresa?: string }
  clienteUid?:   string
  clienteNombre: string
  conCopia?:     boolean
}

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

function armarHtml(mensaje: string, clienteNombre: string, comprobante: string): string {
  const parrafos = mensaje.split(/\n+/).filter(Boolean).map((p) => `<p style="margin:0 0 12px">${p.replace(/</g, '&lt;')}</p>`).join('')
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
    <p style="margin:0 0 12px">Hola ${clienteNombre.replace(/</g, '&lt;')},</p>
    ${parrafos || `<p style="margin:0 0 12px">Te enviamos adjunto el comprobante ${comprobante.replace(/</g, '&lt;')}.</p>`}
    <p style="margin:16px 0 0;color:#666;font-size:13px">Rolito · Redonhielo S.A. — este mail se generó desde la app.</p>
  </div>`
}

export const enviarComprobantePorMail = onCall({ secrets: [resendApiKey], memory: '512MiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')
  const uid = request.auth.uid
  const db = getFirestore()
  const perfil = (await db.doc(`users/${uid}`).get()).data()
  const rol = (perfil?.rol ?? '') as string
  const rolesExtra = ((perfil?.rolesExtra ?? []) as { rol?: string }[]).map((r) => r?.rol ?? '')
  if (perfil?.estado !== 'activo' || (!ROLES.has(rol) && !rolesExtra.some((r) => ROLES.has(r)))) {
    throw new HttpsError('permission-denied', 'No autorizado')
  }
  await assertRateLimit(uid, 'enviarComprobantePorMail', 30, 3600)

  const d = (request.data ?? {}) as Partial<Entrada>
  const para = texto(d.para, 120).toLowerCase()
  if (!EMAIL_RE.test(para)) throw new HttpsError('invalid-argument', 'El mail del destinatario no es válido')
  const asunto = texto(d.asunto, 150)
  if (!asunto) throw new HttpsError('invalid-argument', 'Falta el asunto')
  const nombreArchivo = texto(d.nombreArchivo, 120).replace(/[^\w.-]+/g, '-') || 'comprobante.pdf'
  const pdfBase64 = String(d.pdfBase64 ?? '')
  if (!pdfBase64 || pdfBase64.length > MAX_PDF_BYTES * 1.4) throw new HttpsError('invalid-argument', 'El PDF falta o es demasiado grande')
  const pdf = Buffer.from(pdfBase64, 'base64')
  if (pdf.length < 100 || pdf.subarray(0, 4).toString() !== '%PDF') throw new HttpsError('invalid-argument', 'El adjunto no es un PDF')
  const comprobante = { tipo: texto(d.comprobante?.tipo, 20), numero: texto(d.comprobante?.numero, 40), ...(d.comprobante?.empresa ? { empresa: texto(d.comprobante.empresa, 20) } : {}) }
  const clienteNombre = texto(d.clienteNombre, 120) || 'cliente'
  const mensaje = texto(d.mensaje, 2000)
  const remitente = (perfil?.nombre as string | undefined)?.trim() || 'Rolito'
  const emailOperador = (perfil?.email as string | undefined) ?? ''
  const conCopia = d.conCopia === true && EMAIL_RE.test(emailOperador) && !emailOperador.endsWith('.internal') && !emailOperador.endsWith('@rolito.app')

  const apiKey = resendApiKey.value()
  if (!apiKey) throw new HttpsError('failed-precondition', 'El envío de mails no está configurado')
  const resend = new Resend(apiKey)

  // Modo test (configuracion/notificaciones): mismo desvío que el resto de los mails.
  let destino = para
  let subject = asunto
  try {
    const cfg = (await db.doc('configuracion/notificaciones').get()).data()
    if (cfg?.modoTest === true && cfg?.testEmail) { destino = cfg.testEmail as string; subject = `[TEST → ${para}] ${asunto}` }
  } catch { /* sin config: destino real */ }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: destino,
    ...(conCopia ? { cc: emailOperador } : {}),
    ...(EMAIL_RE.test(emailOperador) && !emailOperador.endsWith('.internal') && !emailOperador.endsWith('@rolito.app') ? { replyTo: emailOperador } : {}),
    subject,
    html: armarHtml(mensaje, clienteNombre, `${comprobante.tipo} ${comprobante.numero}`.trim()),
    attachments: [{ filename: nombreArchivo, content: pdf }],
  })
  const registro = {
    para, asunto, comprobante, clienteNombre, nombreArchivo, bytes: pdf.length,
    ...(d.clienteUid ? { clienteUid: texto(d.clienteUid, 60) } : {}),
    enviadoPor: { uid, nombre: remitente },
    enviadoEn: FieldValue.serverTimestamp(),
    estado: error ? 'error' : 'enviado',
    ...(error ? { error: String(error.message ?? error) } : {}),
    ...(data?.id ? { resendId: data.id } : {}),
  }
  await db.collection('enviosComprobantes').add(registro)
  if (error) {
    console.error('Resend error (comprobante):', error)
    throw new HttpsError('internal', 'No se pudo enviar el mail. Probá de nuevo en un rato.')
  }
  return { ok: true, para }
})
