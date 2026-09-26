// Resumen de ventas por producto de producción, por planta y por día
// (2026-09-25): rollupsVentasProducto/{YYYY-MM-DD}. Lo lee el panel del
// encargado de producción para comparar producido contra vendido.
//
// Recalcula (no incrementa) el día leyendo sus ventas, igual que rollupsPedidos:
// una anulación o una venta cargada tarde quedan bien la próxima pasada. Cada
// 15 minutos rehace HOY y AYER; los días más viejos no cambian (una anulación
// de un día cerrado se ve la próxima vez que se corra el backfill).
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { mapaVentaAProduccion, sumarVendido, type VentaMinima } from '../services/ventasProducto'

const OFFSET_ARG_MS = 3 * 60 * 60 * 1000
export function diaArgDe(fecha: Date): string {
  return new Date(fecha.getTime() - OFFSET_ARG_MS).toISOString().slice(0, 10)
}
function rangoDiaArg(fechaStr: string): [Timestamp, Timestamp] {
  const inicio = new Date(`${fechaStr}T00:00:00.000-03:00`)
  return [Timestamp.fromDate(inicio), Timestamp.fromDate(new Date(inicio.getTime() + 86_400_000))]
}

type ConfigTango = {
  articulos?: Record<string, string>
  sql?: { stock?: { tipos?: Record<string, { articulos?: Record<string, string> }> } }
}

/** Rehace el resumen de un día (YYYY-MM-DD, hora argentina). Exportada para el backfill. */
export async function recalcularVentasProducto(fechaStr: string): Promise<void> {
  const db = getFirestore()
  const cfg = ((await db.doc('config/tango').get()).data() ?? {}) as ConfigTango
  const produccion = Object.entries(cfg.sql?.stock?.tipos ?? {})
    .filter(([clave]) => clave.startsWith('produccion_'))
    .map(([, t]) => t.articulos ?? {})
  const mapa = mapaVentaAProduccion(cfg.articulos ?? {}, produccion)

  const [desde, hasta] = rangoDiaArg(fechaStr)
  const [camion, ventanilla] = await Promise.all([
    db.collection('ventasCamion').where('fecha', '>=', desde).where('fecha', '<', hasta).get(),
    db.collection('ventasVentanilla').where('fecha', '>=', desde).where('fecha', '<', hasta).get(),
  ])

  // La venta del camión no dice de qué planta salió: la dice el remito de carga del viaje.
  const remitoIds = [...new Set(camion.docs.map((d) => d.get('remitoId') as string | undefined).filter((x): x is string => !!x))]
  const plantaDeRemito = new Map<string, string>()
  for (let i = 0; i < remitoIds.length; i += 300) {
    const refs = remitoIds.slice(i, i + 300).map((id) => db.collection('remitosCarga').doc(id))
    for (const snap of await db.getAll(...refs)) {
      const planta = snap.get('plantaId') as string | undefined
      if (snap.exists && planta) plantaDeRemito.set(snap.id, planta)
    }
  }

  const ventas: VentaMinima[] = [
    ...camion.docs.map((d) => d.data() as VentaMinima),
    ...ventanilla.docs.map((d) => d.data() as VentaMinima),
  ]
  const porPlanta = sumarVendido(ventas, mapa, (v) =>
    v.plantaId ?? (v.remitoId ? plantaDeRemito.get(v.remitoId) ?? null : null))

  await db.doc(`rollupsVentasProducto/${fechaStr}`).set({
    fecha: fechaStr,
    porPlanta,
    ventas: ventas.length,
    actualizadoEn: FieldValue.serverTimestamp(),
  })
}

export const rollupVentasProducto = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const ahora = new Date()
    const hoy = diaArgDe(ahora)
    const ayer = diaArgDe(new Date(ahora.getTime() - 86_400_000))
    await recalcularVentasProducto(hoy)
    await recalcularVentasProducto(ayer)
  },
)
