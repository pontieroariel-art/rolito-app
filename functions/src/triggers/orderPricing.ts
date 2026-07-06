import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'

interface OrderProduct {
  name:       string
  quantity:   number
  productoId?: string
  price?:     number
}

// Marcadores que identifican un pedido creado por staff/sistema (no por el
// cliente). El cliente NO puede setearlos (bloqueados en firestore.rules), así
// que su AUSENCIA identifica de forma confiable a un pedido self-service.
const STAFF_MARKERS = ['origenPdf', 'origenManual', 'origenRecurrente']

// Revalida, del lado servidor, los precios de un pedido creado por el cliente
// contra su lista de precios asignada (+ precios custom). Neutraliza cualquier
// manipulación de precios enviada desde el navegador: como las reglas no pueden
// iterar el array `products`, esta es la única capa que la cierra.
//
// Comportamiento: si un precio no coincide con el autoritativo, se CORRIGE (no
// se rechaza el pedido) y se marca `preciosRevalidados: true` para auditoría.
// Corregir en vez de rechazar también arregla el caso legítimo del cliente con
// una lista de precios desactualizada en el navegador.
//
// Los pedidos de staff (manual/PDF/recurrente) se dejan intactos: sus precios
// son deliberados (acuerdos, cotizaciones especiales).
export const validarPreciosPedido = onDocumentCreated('orders/{orderId}', async (event) => {
  const snap = event.data
  if (!snap) return
  const order = snap.data() as Record<string, unknown>

  if (STAFF_MARKERS.some((m) => order[m])) return

  const products = (order.products ?? []) as OrderProduct[]
  if (products.length === 0) return

  const clientId = order.clientId as string | undefined
  if (!clientId || clientId === 'externo') return

  const db = getFirestore()

  const userSnap = await db.doc(`users/${clientId}`).get()
  const user = userSnap.data()
  const listaId = user?.listaPreciosId as string | undefined
  const preciosCustom = (user?.preciosCustom ?? {}) as Record<string, number>
  // Sin lista asignada no hay fuente autoritativa; el cliente sin lista tampoco
  // envía precios (los "confirma el administrador"), así que no hay qué validar.
  if (!listaId) return

  const listaSnap = await db.doc(`listas-precios/${listaId}`).get()
  const items = (listaSnap.data()?.items ?? []) as { productoId: string; precio: number }[]
  const precioDeLista: Record<string, number> = {}
  for (const it of items) precioDeLista[it.productoId] = it.precio

  let cambiado = false
  const corregidos = products.map((p) => {
    if (!p.productoId) return p
    const autoritativo = preciosCustom[p.productoId] ?? precioDeLista[p.productoId]
    if (typeof autoritativo === 'number' && autoritativo !== p.price) {
      cambiado = true
      return { ...p, price: autoritativo }
    }
    return p
  })

  if (cambiado) {
    await snap.ref.update({ products: corregidos, preciosRevalidados: true })
    console.warn(`[validarPreciosPedido] precios corregidos en pedido ${event.params.orderId} (cliente ${clientId})`)
  }
})
