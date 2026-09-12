import { useCallback } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { subscribeRemitosCargaDelDia } from '@/services/remitoCargaService'
import { subscribeVentanillaDelDia } from '@/services/ventaVentanillaService'
import type { PlantaId, RemitoCarga, VentaVentanilla } from '@/types'

// Streams del día de una planta compartidos entre pantallas (2026-09-12,
// auditoría de performance): muelle, TV, seguridad, ventanilla, remitos de
// carga y liquidaciones abrían cada uno su propia suscripción a los mismos
// remitos de carga y ventas de mostrador. Con la key por planta + día, una
// sola suscripción viva por navegador, con keep-alive al cambiar de pantalla.

const VACIO_REMITOS: RemitoCarga[] = []
const VACIO_VENTAS: VentaVentanilla[] = []

export function useRemitosCargaDelDia(plantaId: PlantaId, fecha: Date): RemitoCarga[] {
  const dia = fecha.getTime()
  const subscribe = useCallback((cb: (r: RemitoCarga[]) => void) => subscribeRemitosCargaDelDia(plantaId, new Date(dia), cb), [plantaId, dia])
  return useSharedSubscription<RemitoCarga[]>(`remitosCarga:${plantaId}:${dia}`, subscribe, VACIO_REMITOS).data
}

export function useVentanillaDelDia(plantaId: PlantaId, fecha: Date): VentaVentanilla[] {
  const dia = fecha.getTime()
  const subscribe = useCallback((cb: (v: VentaVentanilla[]) => void) => subscribeVentanillaDelDia(plantaId, new Date(dia), cb), [plantaId, dia])
  return useSharedSubscription<VentaVentanilla[]>(`ventanilla:${plantaId}:${dia}`, subscribe, VACIO_VENTAS).data
}
