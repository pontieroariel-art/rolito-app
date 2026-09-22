/**
 * Marca el recibo que no cuadra y avisa a facturación y al super_admin
 * (auditoría 2026-09-22). La parte que importa —no mandarlo a Tango ni
 * descontar el saldo— está en onCobranzaCreada (tangoOutbox.ts), que corre la
 * misma cuenta pura antes de encolar.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'
import { avisoDescuadre, controlarRecibo } from '../services/cobranzasControl'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

export const onCobranzaControl = onDocumentCreated(
  { document: 'cobranzas/{cobranzaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const c = event.data?.data()
    if (!c) return
    // Las cobranzas simples viejas (sin imputaciones ni a cuenta) no viajan a Tango: no se controlan.
    if (!Array.isArray(c.imputaciones) || (c.imputaciones.length === 0 && !(Number(c.aCuenta) > 0))) return
    const descuadre = controlarRecibo(c)
    if (!descuadre) return
    const db = getFirestore()
    console.error(`[cobranzasControl] cobranzas/${event.params.cobranzaId} no cuadra: ${descuadre.motivos.join(' ')}`)
    await db.doc(`cobranzas/${event.params.cobranzaId}`).set({ control: { descuadre: { ...descuadre, en: FieldValue.serverTimestamp() } } }, { merge: true })
    try {
      const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
      await enviarPushAUsuarios(
        destinatarios.docs,
        { ...avisoDescuadre(c as never, descuadre), url: '/tesoreria' },
        { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() },
      )
    } catch (e) {
      console.error(`[cobranzasControl] push a la oficina falló: ${(e as Error).message}`)
    }
  },
)
