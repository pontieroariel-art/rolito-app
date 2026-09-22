/**
 * Marca la venta cuyo total no cuadra con sus renglones y avisa a facturación
 * y al super_admin (auditoría 2026-09-22). Las reglas no pueden sumar el
 * array; esto es la red del lado servidor. No corrige la venta: la deja
 * marcada (`control.totalDistinto`) para que se vea al liquidar.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { enviarPushAUsuarios } from '../services/push'
import { avisoTotalDistinto, controlarTotal } from '../services/ventasControl'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

async function controlar(coleccion: 'ventasCamion' | 'ventasVentanilla', id: string, venta: Record<string, unknown>) {
  const distinto = controlarTotal(venta as { items?: unknown; total?: unknown })
  if (!distinto) return
  const db = getFirestore()
  console.warn(`[ventasControl] ${coleccion}/${id}: total ${distinto.declarado} vs renglones ${distinto.esperado}`)
  await db.doc(`${coleccion}/${id}`).set({ control: { totalDistinto: { ...distinto, en: FieldValue.serverTimestamp() } } }, { merge: true })
  try {
    const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
    await enviarPushAUsuarios(
      destinatarios.docs,
      { ...avisoTotalDistinto(coleccion, venta as never, distinto), url: coleccion === 'ventasCamion' ? '/caja/liquidaciones' : '/tesoreria/ventas' },
      { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() },
    )
  } catch (e) {
    console.error(`[ventasControl] push a la oficina falló: ${(e as Error).message}`)
  }
}

export const onVentaCamionControl = onDocumentCreated(
  { document: 'ventasCamion/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const venta = event.data?.data()
    if (!venta) return
    await controlar('ventasCamion', event.params.ventaId, venta)
  },
)

export const onVentaVentanillaControl = onDocumentCreated(
  { document: 'ventasVentanilla/{ventaId}', secrets: [vapidPublicKey, vapidPrivateKey] },
  async (event) => {
    const venta = event.data?.data()
    if (!venta) return
    await controlar('ventasVentanilla', event.params.ventaId, venta)
  },
)
