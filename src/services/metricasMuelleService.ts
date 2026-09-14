import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { DescargaCamion, PlantaId, RemitoCarga, VentaVentanilla } from '../types'

// Datos para el panel de tiempos del muelle (2026-09-13). Es una consulta
// PUNTUAL (getDocs, no un stream): se pide al elegir el rango y no queda
// escuchando — un mes son unos miles de documentos y no tiene sentido
// mantenerlos suscriptos mientras alguien mira el reporte.
//
// Las tres colecciones ya tienen índice por plantaId + fecha.

/** Tope de días por consulta: sin esto, un rango de un año baja decenas de miles de docs. */
export const MAX_DIAS_RANGO = 62

/** yyyy-MM-dd + 1 día. */
const diaSiguiente = (dia: string): string => {
  const d = new Date(`${dia}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

const rango = (desde: string, hasta: string): [Timestamp, Timestamp] => [
  Timestamp.fromDate(new Date(`${desde}T00:00:00`)),
  // `hasta` inclusive: se corta al inicio del día siguiente.
  Timestamp.fromDate(new Date(new Date(`${hasta}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)),
]

async function traer<T>(col: string, plantaId: PlantaId, desde: string, hasta: string): Promise<T[]> {
  const [d, h] = rango(desde, hasta)
  const snap = await getDocs(query(
    collection(db, col),
    where('plantaId', '==', plantaId),
    where('fecha', '>=', d),
    where('fecha', '<', h),
  ))
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T)
}

export interface DatosTiemposMuelle {
  remitos:     RemitoCarga[]
  descargas:   DescargaCamion[]
  ventanillas: VentaVentanilla[]
}

export async function getTiemposMuelle(
  plantaId: PlantaId,
  desde: string,
  hasta: string,
): Promise<DatosTiemposMuelle> {
  const [remitos, descargas, ventanillas] = await Promise.all([
    traer<RemitoCarga>('remitosCarga', plantaId, desde, hasta),
    // Un día más de descargas: el camión que vuelve pasada la medianoche se
    // cuenta al día siguiente y su remito es del día anterior. Sin esto, esas
    // esperas —las más largas, justamente— no se medirían nunca.
    traer<DescargaCamion>('descargasCamion', plantaId, desde, diaSiguiente(hasta)),
    traer<VentaVentanilla>('ventasVentanilla', plantaId, desde, hasta),
  ])
  return { remitos, descargas, ventanillas }
}
