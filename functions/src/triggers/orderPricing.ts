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

// Tope de cantidad por línea de producto en un pedido self-service. Las
// reglas de Firestore no pueden validar esto (no iteran arrays), y sin cota
// un cliente puede mandar una cantidad absurda desde la consola del
// navegador — no roba nada (el precio ya se valida aparte), pero genera un
// pedido imposible de cumplir que igual entra al kanban de logística.
const MAX_QTY_POR_ITEM = 500

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

  let products = (order.products ?? []) as OrderProduct[]
  if (products.length === 0) return

  const clientId = order.clientId as string | undefined
  if (!clientId || clientId === 'externo') return

  // Clampear cantidades primero — independiente de tener lista de precios
  // asignada, a diferencia de la validación de precio de abajo.
  let cambiado = false
  products = products.map((p) => {
    if (p.quantity > MAX_QTY_POR_ITEM) {
      cambiado = true
      return { ...p, quantity: MAX_QTY_POR_ITEM }
    }
    return p
  })

  const db = getFirestore()

  // Fuente autoritativa: los precios de Tango que la sync dejó en la ficha del
  // cliente (users.preciosTango.redonhielo — los pedidos de la app son de la
  // operación oficial; ver services/tango/precios.ts). Las listas propias de
  // la app se eliminaron el 2026-09-03.
  const userSnap = await db.doc(`users/${clientId}`).get()
  const user = userSnap.data()
  const preciosTango = (user?.preciosTango as { redonhielo?: Record<string, number> } | undefined)?.redonhielo
  // Sin precios de Tango no hay fuente autoritativa; el cliente sin lista
  // tampoco envía precios (los "confirma el administrador"), así que no hay
  // qué validar de precio — pero el clamp de cantidad de arriba ya corre igual.
  if (!preciosTango || Object.keys(preciosTango).length === 0) {
    if (cambiado) {
      await snap.ref.update({ products, preciosRevalidados: true })
      console.warn(`[validarPreciosPedido] cantidad clampeada en pedido ${event.params.orderId} (cliente ${clientId}, sin precios de Tango)`)
    }
    return
  }

  let invalido = false
  const corregidos = products.map((p) => {
    const autoritativo = p.productoId ? preciosTango[p.productoId] : undefined
    if (typeof autoritativo !== 'number') {
      // Sin productoId reconocido no hay con qué validar el precio: no se
      // puede confiar en lo que mandó el cliente. Antes esto se dejaba pasar
      // tal cual, permitiendo mandar cualquier price sin productoId. En vez
      // de rechazar el pedido entero (rompería el flujo de confirmación
      // manual), se neutraliza el precio a 0 — nunca puede quedar un precio
      // manipulado por el cliente — y se marca para revisión humana.
      cambiado = true
      invalido = true
      return { ...p, price: 0 }
    }
    if (autoritativo !== p.price) {
      cambiado = true
      return { ...p, price: autoritativo }
    }
    return p
  })

  if (cambiado) {
    await snap.ref.update({
      products: corregidos,
      preciosRevalidados: true,
      ...(invalido ? { preciosInvalidos: true } : {}),
    })
    console.warn(`[validarPreciosPedido] precios corregidos en pedido ${event.params.orderId} (cliente ${clientId})${invalido ? ' — incluye producto sin productoId reconocido' : ''}`)
  }
})
