import { useEffect, useState } from 'react'
import type { CierreMercaderia, Liquidacion, RemitoCarga } from '@/types'
import { subscribeLiquidacionDeViaje } from '@/services/liquidacionService'
import { subscribeCierreMercaderia } from '@/services/cierreMercaderiaService'
import { subscribeRemitosCargaChoferHoy } from '@/services/remitoCargaService'
import { estadoDelViaje, type EstadoLiquidacion } from '@/utils/estadoLiquidacion'

/**
 * Las dos mitades del viaje de hoy, para el chofer (2026-09-18).
 *
 * Solo lectura: el chofer no completa nada en todo el circuito. Lo único que
 * gana es saber en qué está su viaje — si muelle ya contó la descarga y si caja
 * ya liquidó su plata — sin tener que preguntarle a nadie.
 */
export function useMiViajeHoy(uid: string | undefined): {
  viaje:      RemitoCarga | null
  plata:      Liquidacion | null
  mercaderia: CierreMercaderia | null
  estado:     EstadoLiquidacion
} {
  const [viaje, setViaje] = useState<RemitoCarga | null>(null)
  const [plata, setPlata] = useState<Liquidacion | null>(null)
  const [mercaderia, setMercaderia] = useState<CierreMercaderia | null>(null)

  useEffect(() => {
    if (!uid) { setViaje(null); return }
    // El último remito del día es el viaje en curso (vienen ordenados por número
    // descendente): con doble viaje, el que importa es el de ahora.
    return subscribeRemitosCargaChoferHoy(uid, (rs) => setViaje(rs[0] ?? null))
  }, [uid])

  useEffect(() => {
    if (!viaje) { setPlata(null); setMercaderia(null); return }
    const offPlata = subscribeLiquidacionDeViaje(viaje.id, setPlata)
    const offMercaderia = subscribeCierreMercaderia(viaje.id, setMercaderia)
    return () => { offPlata(); offMercaderia() }
  }, [viaje])

  return { viaje, plata, mercaderia, estado: estadoDelViaje(plata, mercaderia) }
}
