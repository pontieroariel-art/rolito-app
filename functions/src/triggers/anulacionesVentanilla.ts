/**
 * Anulación de facturas de ventanilla con nota de crédito (2026-09-09).
 *
 * Dos triggers sobre `anulacionesVentanilla/{ventaId}`:
 *   - creada por el cajero → se marca la venta como "anulación pendiente" y se
 *     avisa por push a los usuarios con permiso para autorizar
 *     (`users.autorizaAnulaciones`). Server-side porque caja no puede leer el
 *     directorio de usuarios ni disparar push a otros.
 *   - aprobada / rechazada por un autorizante → se emite la NC en ARCA (o se
 *     refleja el rechazo) y se le avisa al cajero que la pidió.
 *
 * Los errores de emisión NO se relanzan (igual que en la facturación): un
 * reintento del trigger no arregla una causa permanente; la reconciliación
 * horaria de `reconciliarFacturasArca` es la que reintenta con criterio.
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'

import { arcaCert, arcaKey } from '../services/arca/puertoFirebase'
import {
  emitirNotaCreditoDeAnulacion, registrarErrorPrevio, reflejarRechazoEnVenta, transicionAnulacion,
  type AnulacionVentanilla,
} from '../services/arca/anulacionVentanilla'
import { enviarPushAUsuarios } from '../services/push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })

const pesos = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Texto de la push a los autorizantes. Pura. */
export function avisoSolicitud(a: AnulacionVentanilla, venta: { clienteNombre?: unknown; total?: unknown } | undefined): { titulo: string; cuerpo: string } {
  const cliente = String(venta?.clienteNombre ?? 'cliente')
  const total = Number(venta?.total ?? 0)
  return {
    titulo: 'Anulación de factura por autorizar',
    cuerpo: `${cliente} · ${pesos(total)} · ${a.motivo}${a.nota ? ` · ${a.nota}` : ''} (pidió ${a.solicitadoPor?.nombre ?? 'caja'})`,
  }
}

async function avisarAutorizantes(a: AnulacionVentanilla, ventaId: string): Promise<void> {
  const db = getFirestore()
  const [autorizantes, venta] = await Promise.all([
    db.collection('users').where('autorizaAnulaciones', '==', true).where('estado', '==', 'activo').get(),
    db.doc(`ventasVentanilla/${ventaId}`).get(),
  ])
  const { titulo, cuerpo } = avisoSolicitud(a, venta.data())
  await enviarPushAUsuarios(autorizantes.docs, { titulo, cuerpo, url: '/anulaciones' }, claves())
}

async function avisarCajero(uid: string, titulo: string, cuerpo: string): Promise<void> {
  const db = getFirestore()
  const doc = await db.doc(`users/${uid}`).get()
  if (!doc.exists) return
  await enviarPushAUsuarios([doc], { titulo, cuerpo, url: '/caja/ventanilla' }, claves())
}

export const onAnulacionSolicitada = onDocumentCreated(
  { document: 'anulacionesVentanilla/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const a = event.data?.data() as AnulacionVentanilla | undefined
    if (!a || a.estado !== 'pendiente') return
    const ventaId = event.params.ventaId
    const db = getFirestore()
    await db.doc(`ventasVentanilla/${ventaId}`).set(
      { anulacion: { estado: 'pendiente', solicitudId: ventaId } },
      { merge: true },
    )
    try { await avisarAutorizantes(a, ventaId) } catch (e) { console.error(`[anulaciones] push a autorizantes falló: ${(e as Error).message}`) }
  },
)

export const onAnulacionResuelta = onDocumentUpdated(
  { document: 'anulacionesVentanilla/{ventaId}', secrets: [arcaCert, arcaKey, vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes = event.data?.before.data() as AnulacionVentanilla | undefined
    const despues = event.data?.after.data() as AnulacionVentanilla | undefined
    const ventaId = event.params.ventaId
    const db = getFirestore()
    const transicion = transicionAnulacion(antes, despues)
    if (!transicion || !despues) return

    if (transicion === 'resolicitar') {
      await db.doc(`ventasVentanilla/${ventaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: ventaId } }, { merge: true })
      try { await avisarAutorizantes(despues, ventaId) } catch (e) { console.error(`[anulaciones] push falló: ${(e as Error).message}`) }
      return
    }

    if (transicion === 'rechazar') {
      await reflejarRechazoEnVenta(db, ventaId)
      try {
        await avisarCajero(
          despues.solicitadoPor.uid,
          'Anulación rechazada',
          `${despues.resueltaPor?.nombre ?? 'Quien autoriza'} no aprobó la anulación${despues.notaResolucion ? `: ${despues.notaResolucion}` : ''}. La factura sigue vigente.`,
        )
      } catch (e) { console.error(`[anulaciones] push al cajero falló: ${(e as Error).message}`) }
      return
    }

    // 'emitir'
    // Antes de tocar ARCA, reflejar que ya no está pendiente (la venta no se
    // anula hasta tener el CAE de la NC).
    await db.doc(`ventasVentanilla/${ventaId}`).set({ anulacion: { estado: 'aprobada', solicitudId: ventaId } }, { merge: true })
    let registro = null
    try {
      registro = await emitirNotaCreditoDeAnulacion(db, ventaId)
    } catch (e) {
      const motivo = (e as Error).message
      console.error(`[anulaciones] no se pudo emitir la NC de ${ventaId}: ${motivo}`)
      await registrarErrorPrevio(db, ventaId, motivo).catch(() => { /* el log ya quedó */ })
      return
    }
    if (registro?.estado === 'emitida') {
      try {
        await avisarCajero(
          despues.solicitadoPor.uid,
          'Factura anulada',
          `Salió la nota de crédito ${String(registro.puntoVenta).padStart(5, '0')}-${String(registro.numero).padStart(8, '0')}. Ya podés hacer la factura correcta.`,
        )
      } catch (e) { console.error(`[anulaciones] push al cajero falló: ${(e as Error).message}`) }
    }
  },
)
