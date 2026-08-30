import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'

// ── Rollups de pedidos ────────────────────────────────────────────────────────
// Los tableros de gerencia calculaban sus KPIs (total del mes, tendencia de la
// semana, top de clientes) sobre subscribeAllOrders, que trae los pedidos de 30
// días con un limit(500): en temporada alta eso se supera y los números salían
// incompletos SIN avisar (auditoría 2026-08-29, hallazgo A1/H5). Este trigger
// mantiene un agregado diario en `rollupsPedidos/{YYYY-MM-DD}` que los tableros
// leen en vez de escanear todos los pedidos, y un `ultimoPedidoAt` por cliente
// para detectar clientes fríos sin depender de esa ventana.

const db = () => getFirestore()

// Argentina es UTC-3 fijo (sin horario de verano). El día de un pedido se toma
// en esa zona para que coincida con lo que ve el navegador del usuario (mismo
// criterio que rangoDiaArt en turnosVentanilla).
const OFFSET_ARG_MS = 3 * 60 * 60 * 1000
function diaArg(ts: Timestamp): string {
  return new Date(ts.toMillis() - OFFSET_ARG_MS).toISOString().slice(0, 10)
}
function rangoDiaArg(fechaStr: string): [Timestamp, Timestamp] {
  const inicio = new Date(`${fechaStr}T00:00:00.000-03:00`)
  const fin    = new Date(inicio.getTime() + 24 * 60 * 60 * 1000)
  return [Timestamp.fromDate(inicio), Timestamp.fromDate(fin)]
}

type ProductoPedido = { quantity?: number }
type PedidoRollup = { status?: string; clientId?: string; clientName?: string; products?: ProductoPedido[] }

const ESTADOS = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado'] as const

// Recalcula (no incrementa) el rollup de un día leyendo sus pedidos. Recontar es
// robusto ante cualquier cambio —alta, cambio de estado/productos, baja, o un
// pedido que se mueve de fecha— sin la fragilidad de ajustar contadores a mano.
async function recalcularDia(fechaStr: string): Promise<void> {
  const [desde, hasta] = rangoDiaArg(fechaStr)
  const snap = await db().collection('orders')
    .where('date', '>=', desde)
    .where('date', '<', hasta)
    .get()

  const porEstado: Record<string, number> = { pendiente: 0, confirmado: 0, en_camino: 0, entregado: 0, cancelado: 0 }
  const porCliente: Record<string, { nombre: string; bolsas: number; pedidos: number }> = {}
  let total = 0
  let bolsas = 0
  let bolsasEntregadas = 0

  for (const doc of snap.docs) {
    const o = doc.data() as PedidoRollup
    const estado = o.status && ESTADOS.includes(o.status as typeof ESTADOS[number]) ? o.status : 'pendiente'
    porEstado[estado]++
    if (estado === 'cancelado') continue
    total++
    const q = (o.products ?? []).reduce((s, p) => s + (p.quantity ?? 0), 0)
    bolsas += q
    if (estado === 'entregado') bolsasEntregadas += q
    if (o.clientId) {
      const c = porCliente[o.clientId] ?? (porCliente[o.clientId] = { nombre: o.clientName ?? '', bolsas: 0, pedidos: 0 })
      c.bolsas += q
      c.pedidos++
    }
  }

  await db().doc(`rollupsPedidos/${fechaStr}`).set({
    fecha: fechaStr, total, bolsas, bolsasEntregadas, porEstado, porCliente,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

// ultimoPedidoAt del cliente: monotónico (solo avanza). Sirve para "clientes
// fríos" (sin pedir hace N días) sin recorrer todos los pedidos. Se deja algo
// optimista a propósito: no retrocede ante una baja, y un cliente frío de más
// nunca es peor que uno de menos.
async function tocarUltimoPedido(clientId: string, date: Timestamp): Promise<void> {
  const ref = db().doc(`users/${clientId}`)
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const actual = snap.data()?.ultimoPedidoAt as Timestamp | undefined
    if (actual && actual.toMillis() >= date.toMillis()) return
    tx.update(ref, { ultimoPedidoAt: date })
  })
}

export const onOrderRollup = onDocumentWritten('orders/{orderId}', async (event) => {
  const before = event.data?.before?.data() as (PedidoRollup & { date?: Timestamp }) | undefined
  const after  = event.data?.after?.data()  as (PedidoRollup & { date?: Timestamp }) | undefined

  // Recalcular todos los días tocados (before y after pueden diferir si el
  // pedido cambió de fecha; en una baja solo hay before).
  const dias = new Set<string>()
  if (before?.date) dias.add(diaArg(before.date))
  if (after?.date)  dias.add(diaArg(after.date))
  for (const dia of dias) await recalcularDia(dia)

  const vigente = after ?? before
  if (after && vigente?.clientId && vigente.date) {
    await tocarUltimoPedido(vigente.clientId, vigente.date)
  }
})
