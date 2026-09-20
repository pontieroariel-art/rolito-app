/**
 * Anulación de un recibo de cobranza con autorización (2026-09-15, pedido de
 * Ariel: "un botón de anulación en la rendición y que autoricen los autorizados").
 *
 * Tres funciones sobre `anulacionesCobranza/{cobranzaId}`:
 *   - creada por el que cobró → se marca la cobranza como "anulación pendiente"
 *     (`cobranzas.anulacion`, que el cliente no puede escribir) y se avisa por
 *     push a los usuarios con `autorizaAnulaciones`.
 *   - aprobada / rechazada → se marca la cobranza anulada (o el rechazo) y se
 *     le avisa al que cobró, con "Hacer el recibo correcto". Si el recibo ya
 *     estaba en Tango, push a facturación para anularlo allá a mano.
 *   - cada hora, `reconciliarRecibosAnulados` confirma los que el lector de
 *     comprobantes ya ve anulados en Tango (GVA12.ESTADO 'ANU').
 *
 * Lógica pura y tests en services/anulacionCobranza.ts.
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'
import {
  avisoAnularEnTango, avisoSolicitudRecibo, marcaAnulada, motivoLegible, reciboAnuladoEnIndice, transicionRecibo,
  urlDelCobrador, urlReemitirRecibo, type AnulacionCobranzaDoc,
} from '../services/anulacionCobranza'
import { confirmarRecibosAnulados } from '../services/anuladosEnTango'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')
const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })

async function avisarUsuario(uid: unknown, titulo: string, cuerpo: string, url: string): Promise<void> {
  if (typeof uid !== 'string' || !uid) return
  const db = getFirestore()
  const doc = await db.doc(`users/${uid}`).get()
  if (!doc.exists) return
  await enviarPushAUsuarios([doc], { titulo, cuerpo, url }, claves())
}

async function avisarAutorizantes(a: AnulacionCobranzaDoc): Promise<void> {
  const db = getFirestore()
  const autorizantes = await db.collection('users').where('autorizaAnulaciones', '==', true).where('estado', '==', 'activo').get()
  const { titulo, cuerpo } = avisoSolicitudRecibo(a)
  await enviarPushAUsuarios(autorizantes.docs, { titulo, cuerpo, url: '/anulaciones' }, claves())
}

export const onAnulacionReciboSolicitada = onDocumentCreated(
  { document: 'anulacionesCobranza/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const a = event.data?.data() as AnulacionCobranzaDoc | undefined
    if (!a || a.estado !== 'pendiente') return
    const cobranzaId = event.params.cobranzaId
    await getFirestore().doc(`cobranzas/${cobranzaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: cobranzaId } }, { merge: true })
    try { await avisarAutorizantes(a) } catch (e) { console.error(`[anulacionRecibo] push a autorizantes falló: ${(e as Error).message}`) }
  },
)

export const onAnulacionReciboResuelta = onDocumentUpdated(
  { document: 'anulacionesCobranza/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes = event.data?.before.data() as AnulacionCobranzaDoc | undefined
    const despues = event.data?.after.data() as AnulacionCobranzaDoc | undefined
    const cobranzaId = event.params.cobranzaId
    const transicion = transicionRecibo(antes, despues)
    if (!transicion || !despues) return
    const db = getFirestore()
    const cobranza = db.doc(`cobranzas/${cobranzaId}`)

    if (transicion === 'resolicitar') {
      await cobranza.set({ anulacion: { estado: 'pendiente', solicitudId: cobranzaId } }, { merge: true })
      try { await avisarAutorizantes(despues) } catch (e) { console.error(`[anulacionRecibo] push falló: ${(e as Error).message}`) }
      return
    }

    if (transicion === 'rechazar') {
      await cobranza.set({ anulacion: { estado: 'rechazada', solicitudId: cobranzaId } }, { merge: true })
      try {
        await avisarUsuario(despues.solicitadoPor?.uid, 'Anulación de recibo rechazada',
          `${String(despues.resueltaPor?.nombre ?? 'Quien autoriza')} no aprobó anular el recibo ${String(despues.numeroRecibo ?? '')}${despues.notaResolucion ? `: ${String(despues.notaResolucion)}` : ''}. El recibo sigue vigente.`,
          urlDelCobrador(despues))
      } catch (e) { console.error(`[anulacionRecibo] push al cobrador falló: ${(e as Error).message}`) }
      return
    }

    // 'anular': la cobranza deja de contar en todos lados. El doc de la cobranza
    // es inmutable para el cliente; acá escribe el Admin SDK (misma vía que el
    // write-back de Tango). Reemplaza el mapa entero, no lo mezcla.
    const marca = marcaAnulada(despues, cobranzaId, FieldValue.serverTimestamp())
    await cobranza.update({ anulacion: marca })
    const enTango = typeof despues.reciboTango === 'string' && despues.reciboTango.trim() !== ''
    await event.data!.after.ref.set({ tango: { estado: enTango ? 'pendiente_oficina' : 'no_aplica' } }, { merge: true })

    try {
      await avisarUsuario(despues.solicitadoPor?.uid, 'Recibo anulado',
        `Se anuló el recibo ${String(despues.numeroRecibo ?? '')} de ${String(despues.clienteNombre ?? '')} (${motivoLegible(despues.motivo)}). Ya no cuenta en tu rendición. Tocá para hacer el recibo correcto.`,
        urlReemitirRecibo(despues, cobranzaId))
    } catch (e) { console.error(`[anulacionRecibo] push al cobrador falló: ${(e as Error).message}`) }

    if (enTango) {
      try {
        const oficina = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
        const { titulo, cuerpo } = avisoAnularEnTango(despues)
        await enviarPushAUsuarios(oficina.docs, { titulo, cuerpo, url: '/admin/comprobantes' }, claves())
      } catch (e) { console.error(`[anulacionRecibo] push a facturación falló: ${(e as Error).message}`) }
    }
  },
)

/**
 * Cada hora: los recibos anulados en la app que la oficina tenía que anular en
 * Tango pasan a 'confirmado' cuando el lector de comprobantes los ve con ESTADO
 * 'ANU' en el índice del cliente (`tangoComprobantes/{empresa}_{codigo}`).
 */
export const reconciliarRecibosAnulados = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const { pendientes, confirmados } = await confirmarRecibosAnulados(getFirestore())
    console.log(`[recibos] anulados pendientes en Tango: ${pendientes}, confirmados ahora: ${confirmados}`)
  },
)
