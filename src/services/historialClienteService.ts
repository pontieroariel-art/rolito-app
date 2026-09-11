import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import type { Cobranza, VentaCamion, VentaVentanilla } from '@/types'

// Últimos movimientos de UN cliente para la ficha del supervisor: ventas del
// camión, ventas de mostrador y cobranzas (los pedidos van por
// subscribeClientOrders). Lecturas puntuales del ÚLTIMO AÑO (pedido de los
// supervisores, 2026-09-08), con un tope de seguridad por colección; requieren
// los índices clienteId + fecha DESC (firestore.indexes.json).

const TOPE = 600
const DIAS = 365

export interface HistorialCliente {
  ventasCamion:     VentaCamion[]
  ventasVentanilla: VentaVentanilla[]
  cobranzas:        Cobranza[]
}

async function ultimos<T>(coleccion: string, clienteId: string): Promise<T[]> {
  const desde = new Date(); desde.setDate(desde.getDate() - DIAS); desde.setHours(0, 0, 0, 0)
  const snap = await getDocs(query(collection(db, coleccion), where('clienteId', '==', clienteId), where('fecha', '>=', Timestamp.fromDate(desde)), orderBy('fecha', 'desc'), limit(TOPE)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)
}

export async function getHistorialCliente(clienteId: string): Promise<HistorialCliente> {
  const [ventasCamion, ventasVentanilla, cobranzas] = await Promise.all([
    ultimos<VentaCamion>('ventasCamion', clienteId),
    ultimos<VentaVentanilla>('ventasVentanilla', clienteId),
    ultimos<Cobranza>('cobranzas', clienteId),
  ])
  return { ventasCamion, ventasVentanilla, cobranzas }
}

/**
 * Solo las ventas hechas con la app (camión y ventanilla) de un cliente, para
 * Comprobantes de clientes (facturación anula ventas de días ya cerrados,
 * 2026-09-11). Sin cobranzas: no hacen falta y facturación no las mira ahí.
 */
export async function getVentasCliente(clienteId: string): Promise<Pick<HistorialCliente, 'ventasCamion' | 'ventasVentanilla'>> {
  const [ventasCamion, ventasVentanilla] = await Promise.all([
    ultimos<VentaCamion>('ventasCamion', clienteId),
    ultimos<VentaVentanilla>('ventasVentanilla', clienteId),
  ])
  return { ventasCamion, ventasVentanilla }
}
