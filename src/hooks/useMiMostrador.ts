import { useEffect, useMemo, useState } from 'react'
import type { Cobranza, Liquidacion, VentaVentanilla } from '@/types'
import { subscribeCobranzasDeUsuarioEnRango } from '@/services/cobranzaService'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { calcularMostrador, type MostradorCalculado } from '@/utils/rendicionMostrador'
import { addDaysStr } from '@/utils/helpers'

// Lo que un usuario de caja tiene en su caja hoy (2026-09-09): sus ventas de
// ventanilla (las pasa la pantalla, que ya tiene el stream de la planta o el
// suyo propio), sus cobranzas de mostrador y las liquidaciones de repartidores
// que cerró (el efectivo que recibió entra a su caja). `dia` es yyyy-MM-dd.
//
// Rendición de fondos (2026-09-14): con `diasLiquidaciones` las liquidaciones
// se miran varios días para atrás (una cerrada a última hora se rinde en el
// turno siguiente) y se entregan crudas, filtradas solo por quién las cerró:
// cuáles quedan por rendir lo decide `utils/turnoCaja.liquidacionesPorRendir`.
export interface MiMostrador {
  ventas: VentaVentanilla[]
  cobranzas: Cobranza[]
  cobranzasPendientes: number   // sin confirmar por el servidor (offline)
  liquidacionesRecibidas: Liquidacion[]
  calc: MostradorCalculado
}

export function useMiMostrador(uid: string | undefined, dia: string, ventas: VentaVentanilla[], opts: { diasLiquidaciones?: number } = {}): MiMostrador {
  const diasLiquidaciones = opts.diasLiquidaciones ?? 1
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [cobranzasPendientes, setPendientes] = useState(0)
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])

  useEffect(() => {
    if (!uid) return
    const desde = new Date(`${dia}T00:00:00`)
    const hasta = new Date(`${addDaysStr(dia, 1)}T00:00:00`)
    const offC = subscribeCobranzasDeUsuarioEnRango(uid, desde, hasta, setCobranzas, setPendientes)
    const offL = subscribeLiquidacionesEnRango(addDaysStr(dia, 1 - diasLiquidaciones), addDaysStr(dia, 1), (ls) => setLiquidaciones(ls.filter((l) => l.cerradaPor?.uid === uid)))
    return () => { offC(); offL() }
  }, [uid, dia, diasLiquidaciones])

  const calc = useMemo(() => calcularMostrador(ventas, cobranzas, liquidaciones), [ventas, cobranzas, liquidaciones])
  return { ventas, cobranzas, cobranzasPendientes, liquidacionesRecibidas: liquidaciones, calc }
}
