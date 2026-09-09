import { useEffect, useState } from 'react'
import type { Liquidacion } from '@/types'
import { getLiquidacionesDeChofer, subscribeLiquidacion } from '@/services/liquidacionService'
import { addDaysStr } from '@/utils/helpers'

// La rendición de hoy (en vivo) y las de los últimos días de la persona
// logueada (chofer o supervisor: su identidad de depósito es su uid).
// Lecturas por id determinístico {fecha}_{uid}: sin índices, y las reglas
// dejan al chofer leer la suya aunque todavía no exista (2026-09-09).
export function useMisLiquidaciones(uid: string | undefined, hoy: string, diasAtras = 7): { hoyLiq: Liquidacion | null; anteriores: Liquidacion[] } {
  const [hoyLiq, setHoyLiq] = useState<Liquidacion | null>(null)
  const [anteriores, setAnteriores] = useState<Liquidacion[]>([])

  useEffect(() => {
    if (!uid) return
    const off = subscribeLiquidacion(hoy, uid, setHoyLiq)
    const fechas = Array.from({ length: diasAtras }, (_, i) => addDaysStr(hoy, -(i + 1)))
    let vivo = true
    getLiquidacionesDeChofer(uid, fechas).then((ls) => { if (vivo) setAnteriores(ls.sort((a, b) => b.fecha.localeCompare(a.fecha))) }).catch(() => { /* sin señal: queda vacío */ })
    return () => { vivo = false; off() }
  }, [uid, hoy, diasAtras])

  return { hoyLiq, anteriores }
}
