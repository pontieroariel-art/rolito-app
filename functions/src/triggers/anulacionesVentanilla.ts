/**
 * Anulación de facturas con nota de crédito (2026-09-09; camión desde el
 * 2026-09-11).
 *
 * Dos triggers sobre `anulacionesVentanilla/{ventaId}` (la colección conserva
 * el nombre; `coleccion` dice si la venta es de ventanilla o del camión):
 *   - creada por el cajero → se marca la venta como "anulación pendiente" y se
 *     avisa por push a los usuarios con permiso para autorizar
 *     (`users.autorizaAnulaciones`). Server-side porque caja no puede leer el
 *     directorio de usuarios ni disparar push a otros.
 *   - aprobada / rechazada por un autorizante → se emite la NC en ARCA (o se
 *     refleja el rechazo) y se le avisa al cajero que la pidió (y al chofer,
 *     si la factura es del camión).
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
  coleccionDeAnulacion, emitirNotaCreditoDeAnulacion, registrarErrorPrevio, reflejarRechazoEnVenta, transicionAnulacion,
  type AnulacionVentanilla,
} from '../services/arca/anulacionVentanilla'
import { enviarPushAUsuarios } from '../services/push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })

const pesos = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Texto de la push a los autorizantes. Pura. */
export function avisoSolicitud(a: AnulacionVentanilla, venta: { clienteNombre?: unknown; total?: unknown; choferNombre?: unknown } | undefined): { titulo: string; cuerpo: string } {
  const cliente = String(venta?.clienteNombre ?? 'cliente')
  const total = Number(venta?.total ?? 0)
  const camion = coleccionDeAnulacion(a) === 'ventasCamion'
  return {
    titulo: camion ? 'Anulación de factura del camión por autorizar' : 'Anulación de factura por autorizar',
    cuerpo: `${cliente} · ${pesos(total)}${camion && venta?.choferNombre ? ` · chofer ${String(venta.choferNombre)}` : ''} · ${a.motivo}${a.nota ? ` · ${a.nota}` : ''} (pidió ${a.solicitadoPor?.nombre ?? 'caja'})`,
  }
}

/** A dónde vuelve el que pidió: la ventanilla o la liquidación del chofer. */
const urlDelSolicitante = (a: AnulacionVentanilla) => (coleccionDeAnulacion(a) === 'ventasCamion' ? '/caja/liquidaciones' : '/caja/ventanilla')

async function avisarAutorizantes(a: AnulacionVentanilla, ventaId: string): Promise<void> {
  const db = getFirestore()
  const [autorizantes, venta] = await Promise.all([
    db.collection('users').where('autorizaAnulaciones', '==', true).where('estado', '==', 'activo').get(),
    db.doc(`${coleccionDeAnulacion(a)}/${ventaId}`).get(),
  ])
  const { titulo, cuerpo } = avisoSolicitud(a, venta.data())
  await enviarPushAUsuarios(autorizantes.docs, { titulo, cuerpo, url: '/anulaciones' }, claves())
}

async function avisarUsuario(uid: string | undefined, titulo: string, cuerpo: string, url: string): Promise<void> {
  if (!uid) return
  const db = getFirestore()
  const doc = await db.doc(`users/${uid}`).get()
  if (!doc.exists) return
  await enviarPushAUsuarios([doc], { titulo, cuerpo, url }, claves())
}

/** Al que pidió y, si es del camión, también al chofer (lo ve en Mis ventas). */
async function avisarInteresados(a: AnulacionVentanilla, titulo: string, cuerpo: string): Promise<void> {
  try { await avisarUsuario(a.solicitadoPor?.uid, titulo, cuerpo, urlDelSolicitante(a)) } catch (e) { console.error(`[anulaciones] push al cajero falló: ${(e as Error).message}`) }
  const choferId = (a as { choferId?: string }).choferId
  if (coleccionDeAnulacion(a) === 'ventasCamion' && choferId && choferId !== a.solicitadoPor?.uid) {
    try { await avisarUsuario(choferId, titulo, cuerpo, '/chofer/ventas') } catch (e) { console.error(`[anulaciones] push al chofer falló: ${(e as Error).message}`) }
  }
}

export const onAnulacionSolicitada = onDocumentCreated(
  { document: 'anulacionesVentanilla/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const a = event.data?.data() as AnulacionVentanilla | undefined
    if (!a || a.estado !== 'pendiente') return
    const ventaId = event.params.ventaId
    const db = getFirestore()
    await db.doc(`${coleccionDeAnulacion(a)}/${ventaId}`).set(
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
    const coleccion = coleccionDeAnulacion(despues)

    if (transicion === 'resolicitar') {
      await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'pendiente', solicitudId: ventaId } }, { merge: true })
      try { await avisarAutorizantes(despues, ventaId) } catch (e) { console.error(`[anulaciones] push falló: ${(e as Error).message}`) }
      return
    }

    if (transicion === 'rechazar') {
      await reflejarRechazoEnVenta(db, ventaId, coleccion)
      await avisarInteresados(
        despues,
        'Anulación rechazada',
        `${despues.resueltaPor?.nombre ?? 'Quien autoriza'} no aprobó la anulación${despues.notaResolucion ? `: ${despues.notaResolucion}` : ''}. La factura sigue vigente.`,
      )
      return
    }

    // 'emitir'
    // Antes de tocar ARCA, reflejar que ya no está pendiente (la venta no se
    // anula hasta tener el CAE de la NC).
    await db.doc(`${coleccion}/${ventaId}`).set({ anulacion: { estado: 'aprobada', solicitudId: ventaId } }, { merge: true })
    let registro = null
    try {
      registro = await emitirNotaCreditoDeAnulacion(db, ventaId)
    } catch (e) {
      const motivo = (e as Error).message
      console.error(`[anulaciones] no se pudo emitir la NC de ${ventaId}: ${motivo}`)
      await registrarErrorPrevio(db, ventaId, motivo, coleccion).catch(() => { /* el log ya quedó */ })
      return
    }
    if (registro?.estado === 'emitida') {
      await avisarInteresados(
        despues,
        'Factura anulada',
        `Salió la nota de crédito ${String(registro.puntoVenta).padStart(5, '0')}-${String(registro.numero).padStart(8, '0')}. ${coleccion === 'ventasCamion' ? 'La venta ya no cuenta en la liquidación; si el cliente se quedó con la mercadería, registrá la venta correcta.' : 'Ya podés hacer la factura correcta.'}`,
      )
    }
  },
)
