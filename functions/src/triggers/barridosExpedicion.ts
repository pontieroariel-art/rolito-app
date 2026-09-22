/**
 * Barridos del circuito de expedición (2026-09-18). Dos cosas que se arreglan
 * solas y que, si no, quedan colgadas para siempre:
 *
 *  1. **Borradores de carga vencidos.** El borrador es la hoja de trabajo que
 *     caja arma la tarde anterior; si el camión no sale, nadie lo acepta y nadie
 *     lo borra. Pasado `venceEn` (fin del día siguiente al viaje previsto) se
 *     marca `vencido` para que no aparezca en la tablet del muelle como carga
 *     pendiente de un viaje que ya no va a existir.
 *
 *  2. **Descargas sin numerar.** El número lo asigna el servidor
 *     (`onDescargaCamionCreada`), pero un trigger puede fallar o rebotar por
 *     cuota. Una descarga sin código deja al chofer sin nada que escribir en el
 *     sobre de la plata, así que se numeran acá y se avisa a la oficina: si pasa
 *     seguido, el trigger tiene un problema y alguien lo tiene que mirar.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'
import { numerarDescarga } from './tangoOutbox'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

/** Margen antes de dar por perdida la numeración: el trigger tarda segundos, no minutos. */
const MINUTOS_SIN_NUMERAR = 10

export const barridoBorradoresVencidos = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const db = getFirestore()
    const vencidos = await db.collection('borradoresCarga')
      .where('estado', '==', 'pendiente')
      .where('venceEn', '<', Timestamp.now())
      .limit(200).get()
    if (vencidos.empty) return
    // Un batch alcanza: son pocos por día y el tope de Firestore es 500.
    const batch = db.batch()
    vencidos.docs.forEach((d) => batch.update(d.ref, { estado: 'vencido' }))
    await batch.commit()
    console.log(`[borradores] ${vencidos.size} borradores vencidos`)
  },
)

export const barridoDescargasSinNumerar = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'America/Argentina/Buenos_Aires', secrets: [vapidPublicKey, vapidPrivateKey] },
  async () => {
    const db = getFirestore()
    const corte = Timestamp.fromMillis(Date.now() - MINUTOS_SIN_NUMERAR * 60 * 1000)
    // Sin índice compuesto: se filtra por fecha (que ya está indexada) y se
    // descartan en memoria las que sí tienen código. Son pocas descargas por día.
    // Acotado a las últimas 24 h (auditoría 2026-09-22: antes leía las 100
    // últimas descargas cada media hora, ~4.800 lecturas/día, para un caso
    // que el trigger ya resuelve casi siempre).
    const desde = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)
    const recientes = await db.collection('descargasCamion')
      .where('fecha', '>', desde)
      .where('fecha', '<', corte)
      .orderBy('fecha', 'desc')
      .limit(100).get()
    const sinNumero = recientes.docs.filter((d) => !d.data().codigo)
    if (sinNumero.length === 0) return

    const reparadas: string[] = []
    for (const d of sinNumero) {
      const r = await numerarDescarga(d.id, String(d.data().plantaId ?? 'torcuato')).catch((e) => {
        console.error('[descargas] no se pudo numerar en el barrido', d.id, e)
        return null
      })
      if (r) reparadas.push(r.codigo)
    }
    if (reparadas.length === 0) return
    console.warn(`[descargas] numeradas en el barrido: ${reparadas.join(', ')}`)

    try {
      const destinatarios = await db.collection('users')
        .where('estado', '==', 'activo')
        .where('rol', 'in', ['facturacion', 'super_admin']).get()
      await enviarPushAUsuarios(
        destinatarios.docs,
        {
          titulo: 'Descargas sin numerar reparadas',
          cuerpo: `${reparadas.length} descarga(s) quedaron sin número al contarse y se numeraron ahora (${reparadas.join(', ')}). `
            + 'Si vuelve a pasar, el trigger que las numera está fallando.',
          url: '/caja/liquidaciones',
        },
        { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() },
      )
    } catch (e) {
      console.error('[descargas] push del barrido falló', e)
    }
  },
)
