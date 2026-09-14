/**
 * Avisos del faltante de mercadería a autorizar (2026-09-13, paso 7 del control
 * de fugas en expedición).
 *
 *   - onDesvioSolicitado: caja pide que alguien mire un faltante de la descarga
 *     → push a quienes tienen el permiso (mismo padrón que las anulaciones:
 *     users.autorizaAnulaciones). Caja no puede leer el directorio de usuarios,
 *     así que la push tiene que salir del server.
 *   - onDesvioResuelto: aprobado o rechazado → push a quien lo pidió, con la
 *     nota. Si fue rechazado la nota dice qué hacer, y es lo que el cajero
 *     necesita leer para seguir.
 *
 * No hay efecto sobre el stock ni sobre la liquidación: esto solo habilita el
 * camino limpio del cierre. Si nadie contesta, caja cierra con desvío observado.
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')
const claves = () => ({ vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })

interface Desvio {
  fecha?: unknown
  choferNombre?: unknown
  depositoTango?: unknown
  bolsasFaltantes?: unknown
  productos?: Array<{ nombre?: unknown; faltan?: unknown }>
  motivo?: unknown
  nota?: unknown
  estado?: unknown
  solicitadoPor?: { uid?: unknown; nombre?: unknown }
  resueltaPor?: { nombre?: unknown } | null
  notaResolucion?: unknown
}

/** Texto de la push a los autorizantes. Pura. */
export function avisoDesvio(d: Desvio): { titulo: string; cuerpo: string } {
  const productos = (d.productos ?? []).map((p) => `${String(p.nombre ?? '')} -${Number(p.faltan ?? 0)}`).join(', ')
  return {
    titulo: `Faltan ${Number(d.bolsasFaltantes ?? 0)} bolsas: ${String(d.choferNombre ?? 'un repartidor')}`,
    cuerpo: `${d.depositoTango ? `Depósito ${String(d.depositoTango)} · ` : ''}día ${String(d.fecha ?? '')}`
      + `${productos ? ` · ${productos}` : ''} · lo pidió ${String(d.solicitadoPor?.nombre ?? 'caja')}`
      + `${d.nota ? ` · ${String(d.nota)}` : ''}. Caja espera para cerrar.`,
  }
}

/** Texto de la push a quien pidió, ya resuelto. Pura. */
export function avisoResolucion(d: Desvio): { titulo: string; cuerpo: string } {
  const aprobada = d.estado === 'aprobada'
  const quien = String(d.resueltaPor?.nombre ?? 'el autorizante')
  return {
    titulo: aprobada
      ? `Faltante autorizado: ${String(d.choferNombre ?? '')}`
      : `Faltante RECHAZADO: ${String(d.choferNombre ?? '')}`,
    cuerpo: aprobada
      ? `${quien} autorizó el cierre con ${Number(d.bolsasFaltantes ?? 0)} bolsas de menos${d.notaResolucion ? ` · ${String(d.notaResolucion)}` : ''}.`
      : `${quien}: ${String(d.notaResolucion ?? 'hay que revisarlo antes de cerrar')}`,
  }
}

export const onDesvioSolicitado = onDocumentCreated(
  { document: 'desviosDescarga/{desvioId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const d = event.data?.data() as Desvio | undefined
    if (!d || d.estado !== 'pendiente') return
    try {
      const db = getFirestore()
      const autorizantes = await db.collection('users')
        .where('autorizaAnulaciones', '==', true)
        .where('estado', '==', 'activo')
        .get()
      await enviarPushAUsuarios(autorizantes.docs, { ...avisoDesvio(d), url: '/anulaciones' }, claves())
    } catch (e) {
      console.error(`[desvios] push a autorizantes falló: ${(e as Error).message}`)
    }
  },
)

export const onDesvioResuelto = onDocumentUpdated(
  { document: 'desviosDescarga/{desvioId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const antes   = event.data?.before.data() as Desvio | undefined
    const despues = event.data?.after.data() as Desvio | undefined
    if (!despues || antes?.estado !== 'pendiente') return
    if (despues.estado !== 'aprobada' && despues.estado !== 'rechazada') return
    const uid = String(despues.solicitadoPor?.uid ?? '')
    if (!uid) return
    try {
      const quien = await getFirestore().doc(`users/${uid}`).get()
      if (!quien.exists) return
      await enviarPushAUsuarios([quien], { ...avisoResolucion(despues), url: '/caja/liquidaciones' }, claves())
    } catch (e) {
      console.error(`[desvios] push al cajero falló: ${(e as Error).message}`)
    }
  },
)
