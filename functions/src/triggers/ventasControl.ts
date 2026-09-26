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
import { avisoPrecioDistinto, avisoTotalDistinto, controlarPrecios, controlarTotal } from '../services/ventasControl'

const vapidPublicKey  = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')

async function avisarOficina(aviso: { titulo: string; cuerpo: string }, url: string) {
  try {
    const db = getFirestore()
    const destinatarios = await db.collection('users').where('estado', '==', 'activo').where('rol', 'in', ['facturacion', 'super_admin']).get()
    await enviarPushAUsuarios(destinatarios.docs, { ...aviso, url }, { vapidPublicKey: vapidPublicKey.value(), vapidPrivateKey: vapidPrivateKey.value() })
  } catch (e) {
    console.error(`[ventasControl] push a la oficina falló: ${(e as Error).message}`)
  }
}

/**
 * Precio de cada renglón contra la lista del cliente (2026-09-26, auditoría del
 * chofer, C5): el precio unitario lo pone el teléfono. Solo en el camión y solo
 * en lo que se cobra (los cambios van aparte y en $0). Empresa por canal: promo
 * es Rolito, contado es Redonhielo. No corrige la venta: la marca y avisa.
 */
async function controlarPrecio(id: string, venta: Record<string, unknown>) {
  if (typeof venta.clienteId !== 'string' || !venta.clienteId) return
  const db = getFirestore()
  const cliente = (await db.doc(`users/${venta.clienteId}`).get()).data()
  const empresa = venta.canal === 'promo' ? 'rolito' : 'redonhielo'
  const precios = (cliente?.preciosTango as Record<string, Record<string, unknown>> | undefined)?.[empresa]
  const distintos = controlarPrecios(venta.items, precios)
  if (!distintos.length) return
  console.warn(`[ventasControl] ventasCamion/${id}: ${distintos.length} renglón(es) con precio distinto de la lista`)
  await db.doc(`ventasCamion/${id}`).set({ control: { precioDistinto: { renglones: distintos, en: FieldValue.serverTimestamp() } } }, { merge: true })
  await avisarOficina(avisoPrecioDistinto(venta as never, distintos), '/caja/liquidaciones')
}

async function controlar(coleccion: 'ventasCamion' | 'ventasVentanilla', id: string, venta: Record<string, unknown>) {
  if (coleccion === 'ventasCamion') {
    try { await controlarPrecio(id, venta) } catch (e) { console.error(`[ventasControl] control de precio falló: ${(e as Error).message}`) }
  }
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
