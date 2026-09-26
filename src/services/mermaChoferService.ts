import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { DescargaCamion, Order, PlantaId, RemitoCarga, VentaCamion } from '../types'
import { productosFabricaTopeados } from '../utils/entregaFabrica'
import type { ViajeParaMerma } from '../utils/mermaChofer'

// Datos del reporte de merma y faltantes por chofer (2026-09-26). Consulta
// PUNTUAL (getDocs), como Tiempos del muelle: se pide al elegir el rango y no
// queda escuchando. Los viajes salen de los remitos del rango; sus ventas,
// descargas y entregas de fábrica se traen por remitoId (de a 30, el tope de `in`).

export const MAX_DIAS_MERMA = 62

const rango = (desde: string, hasta: string): [Timestamp, Timestamp] => [
  Timestamp.fromDate(new Date(`${desde}T00:00:00`)),
  Timestamp.fromDate(new Date(new Date(`${hasta}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)),
]

const deA = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

async function porRemito<T>(col: string, campo: string, ids: string[]): Promise<T[]> {
  const partes = await Promise.all(deA(ids, 30).map((grupo) => getDocs(query(collection(db, col), where(campo, 'in', grupo)))))
  return partes.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as T))
}

export async function getViajesParaMerma(planta: PlantaId | 'todas', desde: string, hasta: string): Promise<ViajeParaMerma[]> {
  const [d, h] = rango(desde, hasta)
  const plantas: PlantaId[] = planta === 'todas' ? ['torcuato', 'merlo'] : [planta]
  const remitos = (await Promise.all(plantas.map((p) => getDocs(query(
    collection(db, 'remitosCarga'),
    where('plantaId', '==', p),
    where('fecha', '>=', d),
    where('fecha', '<', h),
  ))))).flatMap((s) => s.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RemitoCarga))
  if (!remitos.length) return []

  const ids = remitos.map((r) => r.id)
  const [ventas, descargas, pedidos] = await Promise.all([
    porRemito<VentaCamion>('ventasCamion', 'remitoId', ids),
    porRemito<DescargaCamion>('descargasCamion', 'remitoId', ids),
    porRemito<Order>('orders', 'entregaFabrica.remitoId', ids),
  ])
  return remitos.map((remito) => ({
    remito,
    ventas: ventas.filter((v) => v.remitoId === remito.id),
    descargas: descargas.filter((x) => x.remitoId === remito.id),
    // Topeado a lo pedido, como en la liquidación (auditoría del chofer, C4).
    entregasFabrica: pedidos
      .filter((o) => o.entregaFabrica?.remitoId === remito.id)
      .map((o) => ({ productos: productosFabricaTopeados(o.products, o.entregaFabrica?.productos).productos })),
  }))
}
