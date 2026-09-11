import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { assertNoImpersonado } from '../authz'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { Resend } from 'resend'
import { FROM_EMAIL, resendApiKey } from '../email'
import { assertRateLimit } from '../rateLimit'
import { tplComprobanteEnviado, type ComprobanteMail } from '../templates'

// Envío por mail de un comprobante que la app generó (factura, remito,
// composición de saldos, recibo) al cliente (2026-09-10, pedido de Ariel: "lo
// que más usan es el mail"). Un mailto: no puede adjuntar archivos, así que el
// PDF viaja en base64 a esta función y sale por Resend con el adjunto. Queda
// registrado en enviosComprobantes (quién, a quién, qué y cuándo).
//
// Quién puede: staff que cobra o gestiona (mismos roles que leen saldosTango).
// El destinatario lo elige el operador en pantalla (viene precargado con el
// mail de Tango del cliente): se valida el formato y se lo registra.
//
// Envío en bloque (2026-09-10, facturación): un solo mail con VARIOS PDF
// (facturas y remitos elegidos de la ficha del cliente) viaja en `adjuntos`;
// `pdfBase64`/`nombreArchivo` quedan para el envío de uno solo. `comprobantes`
// lista lo que va adentro para el registro en enviosComprobantes.

const ROLES = new Set([
  'super_admin', 'gerente_general', 'gerente_comercial', 'comercial', 'logistica',
  'facturacion', 'tesoreria', 'supervisor', 'caja', 'chofer',
])
const MAX_PDF_BYTES = 4 * 1024 * 1024
/** Tope de un envío en bloque: cantidad de PDF y bytes en total (Resend acepta hasta 40 MB por mail). */
const MAX_ADJUNTOS = 40
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Adjunto { nombreArchivo: string; pdfBase64: string }
interface ComprobanteRef { tipo: string; numero: string; empresa?: string }

interface Entrada {
  para:          string
  asunto:        string
  mensaje?:      string
  /** Un solo PDF (envío individual). */
  nombreArchivo?: string
  pdfBase64?:    string
  /** Varios PDF en el mismo mail (envío en bloque); si viene, se ignora pdfBase64. */
  adjuntos?:     Adjunto[]
  comprobante:   ComprobanteRef
  /** Todos los comprobantes del bloque (para el registro); en el individual es [comprobante]. */
  comprobantes?: ComprobanteRef[]
  clienteUid?:   string
  clienteNombre: string
  conCopia?:     boolean
  /** Tarjeta del mail: título legible y filas ya formateadas (fecha, importe, remitos…). */
  presentacion?: ComprobanteMail
  /**
   * Venta de la app a la que pertenece el comprobante (2026-09-11, envío
   * automático al cliente): el server deja constancia en `envioMail` del doc
   * (las reglas no dejan al chofer escribir la venta) y, si es automático,
   * no la manda dos veces aunque dos pestañas lo intenten.
   */
  venta?:        { coleccion: 'ventasCamion' | 'ventasVentanilla'; id: string }
  automatico?:   boolean
}

const COLECCIONES_VENTA = new Set(['ventasCamion', 'ventasVentanilla'])

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const nombrePdf = (v: unknown) => texto(v, 120).replace(/[^\w.-]+/g, '-') || 'comprobante.pdf'
const comprobanteRef = (c: Partial<ComprobanteRef> | undefined): ComprobanteRef =>
  ({ tipo: texto(c?.tipo, 20), numero: texto(c?.numero, 40), ...(c?.empresa ? { empresa: texto(c.empresa, 20) } : {}) })

/** Decodifica y valida un PDF en base64 (firma %PDF, tamaño). */
function decodificarPdf(pdfBase64: unknown, que: string): Buffer {
  const b64 = String(pdfBase64 ?? '')
  if (!b64 || b64.length > MAX_PDF_BYTES * 1.4) throw new HttpsError('invalid-argument', `${que}: el PDF falta o es demasiado grande`)
  const pdf = Buffer.from(b64, 'base64')
  if (pdf.length < 100 || pdf.subarray(0, 4).toString() !== '%PDF') throw new HttpsError('invalid-argument', `${que}: el adjunto no es un PDF`)
  return pdf
}


export const enviarComprobantePorMail = onCall({ secrets: [resendApiKey], memory: '512MiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Requiere autenticación')

  assertNoImpersonado(request)
  const uid = request.auth.uid
  const db = getFirestore()
  const perfil = (await db.doc(`users/${uid}`).get()).data()
  const rol = (perfil?.rol ?? '') as string
  const rolesExtra = ((perfil?.rolesExtra ?? []) as { rol?: string }[]).map((r) => r?.rol ?? '')
  if (perfil?.estado !== 'activo' || (!ROLES.has(rol) && !rolesExtra.some((r) => ROLES.has(r)))) {
    throw new HttpsError('permission-denied', 'No autorizado')
  }
  await assertRateLimit(uid, 'enviarComprobantePorMail', 60, 3600)

  const d = (request.data ?? {}) as Partial<Entrada>
  const para = texto(d.para, 120).toLowerCase()
  if (!EMAIL_RE.test(para)) throw new HttpsError('invalid-argument', 'El mail del destinatario no es válido')
  const asunto = texto(d.asunto, 150)
  if (!asunto) throw new HttpsError('invalid-argument', 'Falta el asunto')

  // Venta de la app: constancia en el doc e idempotencia del envío automático.
  const automatico = d.automatico === true
  let ventaRef: FirebaseFirestore.DocumentReference | null = null
  if (d.venta && COLECCIONES_VENTA.has(String(d.venta.coleccion)) && texto(d.venta.id, 80)) {
    ventaRef = db.doc(`${d.venta.coleccion}/${texto(d.venta.id, 80)}`)
    const venta = (await ventaRef.get()).data()
    if (!venta) throw new HttpsError('not-found', 'La venta no existe')
    // El automático lo manda el propio vendedor (chofer o cajero); el manual, cualquier rol autorizado.
    if (automatico && venta.choferId !== uid && venta.cajaId !== uid) throw new HttpsError('permission-denied', 'La venta no es tuya')
    if (automatico && venta.envioMail?.estado === 'enviado') return { ok: true, para: String(venta.envioMail.para ?? para), yaEnviado: true }
  }
  // Adjuntos: la lista del envío en bloque o el PDF único del envío individual.
  const adjuntos: { filename: string; content: Buffer }[] = []
  if (Array.isArray(d.adjuntos) && d.adjuntos.length) {
    if (d.adjuntos.length > MAX_ADJUNTOS) throw new HttpsError('invalid-argument', `Se pueden mandar hasta ${MAX_ADJUNTOS} comprobantes por mail`)
    // Antes de decodificar nada: el total en base64 ya dice si el lote pasa.
    const totalB64 = d.adjuntos.reduce((s, a) => s + String(a?.pdfBase64 ?? '').length, 0)
    if (totalB64 > MAX_TOTAL_BYTES * 1.4) throw new HttpsError('invalid-argument', 'Los PDF pesan demasiado para un solo mail: mandalos en dos tandas')
    const usados = new Set<string>()
    for (const [i, a] of d.adjuntos.entries()) {
      let filename = nombrePdf(a?.nombreArchivo)
      // Dos PDF con el mismo nombre en un mail se pisan en el cliente de correo.
      if (usados.has(filename)) filename = filename.replace(/\.pdf$/i, '') + `-${i + 1}.pdf`
      usados.add(filename)
      adjuntos.push({ filename, content: decodificarPdf(a?.pdfBase64, filename) })
    }
    const total = adjuntos.reduce((s, a) => s + a.content.length, 0)
    if (total > MAX_TOTAL_BYTES) throw new HttpsError('invalid-argument', 'Los PDF pesan demasiado para un solo mail: mandalos en dos tandas')
  } else {
    const filename = nombrePdf(d.nombreArchivo)
    adjuntos.push({ filename, content: decodificarPdf(d.pdfBase64, filename) })
  }
  const nombreArchivo = adjuntos[0].filename
  const comprobante = comprobanteRef(d.comprobante)
  const comprobantes = (Array.isArray(d.comprobantes) ? d.comprobantes : []).slice(0, MAX_ADJUNTOS).map(comprobanteRef).filter((c) => c.tipo || c.numero)
  const clienteNombre = texto(d.clienteNombre, 120) || 'cliente'
  const mensaje = texto(d.mensaje, 2000)
  const presentacion: ComprobanteMail = {
    titulo: texto(d.presentacion?.titulo, 80) || `${comprobante.tipo} ${comprobante.numero}`.trim(),
    ...(d.presentacion?.emoji ? { emoji: texto(d.presentacion.emoji, 4) } : {}),
    filas: (Array.isArray(d.presentacion?.filas) ? d.presentacion!.filas : []).slice(0, 8)
      .map((f) => ({ label: texto(f?.label, 30), value: texto(f?.value, 200) })).filter((f) => f.label && f.value),
    ...(adjuntos.length > 1 ? { adjuntos: adjuntos.map((a) => a.filename) } : {}),
  }
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
    html: tplComprobanteEnviado(clienteNombre, presentacion, mensaje, remitente),
    attachments: adjuntos,
  })
  const registro = {
    para, asunto, comprobante, clienteNombre, nombreArchivo, bytes: adjuntos.reduce((s, a) => s + a.content.length, 0),
    ...(adjuntos.length > 1 ? { adjuntos: adjuntos.map((a) => a.filename), cantidad: adjuntos.length } : {}),
    ...(comprobantes.length ? { comprobantes } : {}),
    ...(d.clienteUid ? { clienteUid: texto(d.clienteUid, 60) } : {}),
    enviadoPor: { uid, nombre: remitente },
    enviadoEn: FieldValue.serverTimestamp(),
    estado: error ? 'error' : 'enviado',
    ...(error ? { error: String(error.message ?? error) } : {}),
    ...(data?.id ? { resendId: data.id } : {}),
  }
  await db.collection('enviosComprobantes').add(registro)
  if (ventaRef) {
    await ventaRef.set({
      envioMail: {
        estado: error ? 'error' : 'enviado', para, automatico, enviadoEn: FieldValue.serverTimestamp(),
        ...(error ? { error: String(error.message ?? error).slice(0, 200) } : {}),
        ...(data?.id ? { resendId: data.id } : {}),
      },
    }, { merge: true }).catch((e) => console.warn('enviarComprobantePorMail: no se pudo anotar envioMail en la venta', e))
  }
  if (error) {
    console.error('Resend error (comprobante):', error)
    throw new HttpsError('internal', 'No se pudo enviar el mail. Probá de nuevo en un rato.')
  }
  return { ok: true, para }
})
