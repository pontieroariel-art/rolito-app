import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import { enviarPushAUsuarios } from '../services/push'
import { idMailSaliente, type EstadoEntregaMail, type ReferenciaMail } from '../email'

// Webhook de Resend (2026-09-24): el proveedor cuenta qué pasó con cada mail
// después de aceptarlo —se entregó, rebotó, el destinatario lo marcó como
// spam, está demorado— y acá se anota en `mailsSalientes/{resend_<id>}` y en
// el documento de la app que lo mandó (`referencias`: el registro de
// enviosComprobantes y la venta). Hasta hoy "enviado" quería decir "el
// proveedor lo aceptó", y con la casilla de Microsoft restringida eso no
// decía nada: los comprobantes se frenaban después y nadie se enteraba.
//
// Un rebote o una queja avisan por push a facturación y al super_admin, que
// son quienes corrigen el mail del cliente en Tango y reenvían.
//
// Seguridad: Resend firma cada aviso con Svix (headers svix-id,
// svix-timestamp y svix-signature; HMAC-SHA256 de `${id}.${timestamp}.${body}`
// con el secret base64 que sigue al prefijo `whsec_`). Sin firma válida o con
// más de cinco minutos de diferencia, 401. El secret es RESEND_WEBHOOK_SECRET
// (`firebase functions:secrets:set RESEND_WEBHOOK_SECRET`, se copia de la
// pantalla del webhook en resend.com). Endpoint a registrar allá:
// https://us-central1-rolito-app.cloudfunctions.net/resendWebhook

const webhookSecret  = defineSecret('RESEND_WEBHOOK_SECRET')
const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

const TOLERANCIA_SEG = 5 * 60

interface EventoResend {
  type?:       string
  created_at?: string
  data?: {
    email_id?: string
    to?:       string[] | string
    subject?:  string
    bounce?:   { message?: string; type?: string; subType?: string }
    failed?:   { reason?: string }
  }
}

/** Verificación de la firma Svix, sin dependencias (el SDK de Resend 4 no la trae). */
export function firmaValida(secret: string, svixId: string, svixTimestamp: string, svixSignature: string, cuerpo: Buffer, ahoraSeg = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false
  const ts = Number(svixTimestamp)
  if (!Number.isFinite(ts) || Math.abs(ahoraSeg - ts) > TOLERANCIA_SEG) return false
  const clave = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const esperada = createHmac('sha256', clave).update(Buffer.concat([Buffer.from(`${svixId}.${svixTimestamp}.`), cuerpo])).digest()
  for (const parte of svixSignature.split(' ')) {
    const [version, firma] = parte.split(',')
    if (version !== 'v1' || !firma) continue
    const recibida = Buffer.from(firma, 'base64')
    if (recibida.length === esperada.length && timingSafeEqual(recibida, esperada)) return true
  }
  return false
}

/** Qué estado de la app corresponde a cada evento; `null` = no interesa (sent, opened, clicked). */
export function estadoDeEvento(tipo: string | undefined): EstadoEntregaMail | null {
  switch (tipo) {
    case 'email.delivered':        return 'entregado'
    case 'email.bounced':          return 'rebotado'
    case 'email.failed':           return 'rebotado'
    case 'email.complained':       return 'queja'
    case 'email.delivery_delayed': return 'demorado'
    default:                       return null
  }
}

/** Un evento nuevo no pisa uno más definitivo (un "demorado" que llega después del rebote). */
const RANGO: Record<string, number> = { aceptado: 0, demorado: 1, entregado: 2, queja: 3, rebotado: 3 }
export const pisaEstado = (actual: string | undefined, nuevo: EstadoEntregaMail): boolean =>
  (RANGO[nuevo] ?? 0) >= (RANGO[actual ?? 'aceptado'] ?? 0)

const detalleDe = (e: EventoResend, estado: EstadoEntregaMail): string => {
  const d = e.data
  if (estado === 'rebotado') {
    const b = d?.bounce
    const partes = [b?.type, b?.subType, b?.message, d?.failed?.reason].filter((x): x is string => typeof x === 'string' && x.length > 0)
    return partes.join(' · ').slice(0, 300) || 'El servidor del destinatario rechazó el mail'
  }
  if (estado === 'queja') return 'El destinatario lo marcó como correo no deseado'
  if (estado === 'demorado') return 'El servidor del destinatario todavía no lo aceptó; se reintenta'
  return ''
}

export const resendWebhook = onRequest(
  { secrets: [webhookSecret, vapidPublicKey, vapidPrivateKey], invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return }
    const h = (n: string) => String(req.headers[n] ?? '')
    const cuerpo: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
    if (!firmaValida(webhookSecret.value(), h('svix-id'), h('svix-timestamp'), h('svix-signature'), cuerpo)) {
      res.status(401).send('firma inválida')
      return
    }

    const evento = (req.body ?? {}) as EventoResend
    const estado = estadoDeEvento(evento.type)
    const emailId = evento.data?.email_id
    if (!estado || !emailId) { res.status(200).json({ ok: true, ignorado: evento.type ?? 'sin tipo' }); return }

    const db = getFirestore()
    const ref = db.collection('mailsSalientes').doc(idMailSaliente('resend', emailId))
    const svixId = h('svix-id')
    const detalle = detalleDe(evento, estado)
    const entrega = { estado, detalle, en: FieldValue.serverTimestamp(), evento: evento.type, svixId }

    try {
      const snap = await ref.get()
      const actual = snap.data()
      if (actual?.entrega?.svixId === svixId) { res.status(200).json({ ok: true, repetido: true }); return }
      if (actual && !pisaEstado(actual.estado, estado)) { res.status(200).json({ ok: true, conservado: actual.estado }); return }
      const para = [evento.data?.to ?? []].flat().map(String)
      await ref.set({
        // Si el registro no existía (el envío no lo pudo escribir), queda uno mínimo con lo que dice el proveedor.
        ...(actual ? {} : { proveedor: 'resend', mailId: emailId, para, asunto: String(evento.data?.subject ?? '').slice(0, 200), tipo: 'aviso', fecha: FieldValue.serverTimestamp() }),
        estado,
        entrega,
      }, { merge: true })

      const referencias = (actual?.referencias ?? []) as ReferenciaMail[]
      await Promise.all(referencias.map(async (r) => {
        try {
          await db.doc(`${r.coleccion}/${r.id}`).update({ [r.campo]: { estado, detalle, en: FieldValue.serverTimestamp() } })
        } catch (e) {
          console.warn(`[resendWebhook] no se pudo anotar ${r.coleccion}/${r.id}.${r.campo}: ${(e as Error).message}`)
        }
      }))

      if (estado === 'rebotado' || estado === 'queja') {
        try {
          const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
          const asunto = String(actual?.asunto ?? evento.data?.subject ?? '')
          await enviarPushAUsuarios(destinatarios.docs, {
            titulo: estado === 'rebotado' ? `Mail rebotado: ${(actual?.para ?? para).join(', ')}` : `Mail marcado como spam: ${(actual?.para ?? para).join(', ')}`,
            cuerpo: `${asunto}${detalle ? ` · ${detalle}` : ''}`.slice(0, 200),
            url: '/admin/mails',
          }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
        } catch (e) {
          console.error(`[resendWebhook] push a facturación falló: ${(e as Error).message}`)
        }
      }
      res.status(200).json({ ok: true, estado })
    } catch (err) {
      console.error('[resendWebhook] error:', err)
      res.status(500).json({ ok: false, reason: err instanceof Error ? err.message : String(err) })
    }
  },
)
