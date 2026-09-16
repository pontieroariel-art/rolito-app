import { useEffect, useMemo, useState } from 'react'
import { subscribeVentasCamionDelDia } from '@/services/ventaCamionService'
import { subscribeVentanillaDelDia } from '@/services/ventaVentanillaService'
import { subscribeCobranzasDelDia } from '@/services/cobranzaService'
import { subscribeRemitosCargaDelDia } from '@/services/remitoCargaService'
import { subscribeDescargasDelDia } from '@/services/descargaCamionService'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { useSesionesDelDia } from '@/hooks/useCajaSesion'
import { useSobresDelDia } from '@/hooks/useSobres'
import { addDaysStr } from '@/utils/helpers'
import { resumenLive, type ResumenLive } from '@/utils/tesoreriaLive'
import type { Cobranza, DescargaCamion, Liquidacion, RemitoCarga, Rendicion, VentaCamion, VentaVentanilla } from '@/types'

// Los docs de UN día para los dos tableros en vivo (Ventas y Tesorería,
// 2026-09-16): un stream acotado por colección y planta, sin índices nuevos,
// y el resumen puro de `resumenLive` recalculado a medida que llegan. Las dos
// pantallas leen exactamente lo mismo, así dicen los mismos números.
export interface LiveDelDia {
  resumen: ResumenLive
  cobranzas: Cobranza[]
  /** Último doc recibido (para el "en vivo · hh:mm:ss" del encabezado). */
  ultimoCambio: Date | null
}

export function useLiveDelDia(dia: string): LiveDelDia {
  const [ventasCamion, setVentasCamion] = useState<VentaCamion[]>([])
  const [vvT, setVvT] = useState<VentaVentanilla[]>([])
  const [vvM, setVvM] = useState<VentaVentanilla[]>([])
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [remT, setRemT] = useState<RemitoCarga[]>([])
  const [remM, setRemM] = useState<RemitoCarga[]>([])
  const [descT, setDescT] = useState<DescargaCamion[]>([])
  const [descM, setDescM] = useState<DescargaCamion[]>([])
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [ultimoCambio, setUltimoCambio] = useState<Date | null>(null)
  const sesT = useSesionesDelDia('torcuato', dia)
  const sesM = useSesionesDelDia('merlo', dia)
  const sobT = useSobresDelDia('torcuato', dia)
  const sobM = useSobresDelDia('merlo', dia)

  useEffect(() => {
    const fecha = new Date(`${dia}T12:00:00`)
    const manana = addDaysStr(dia, 1)
    const tick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setUltimoCambio(new Date()) }
    const offs = [
      subscribeVentasCamionDelDia(fecha, tick(setVentasCamion)),
      subscribeVentanillaDelDia('torcuato', fecha, tick(setVvT)),
      subscribeVentanillaDelDia('merlo', fecha, tick(setVvM)),
      subscribeCobranzasDelDia(fecha, tick(setCobranzas)),
      subscribeRemitosCargaDelDia('torcuato', fecha, tick(setRemT)),
      subscribeRemitosCargaDelDia('merlo', fecha, tick(setRemM)),
      subscribeDescargasDelDia('torcuato', fecha, tick(setDescT)),
      subscribeDescargasDelDia('merlo', fecha, tick(setDescM)),
      subscribeLiquidacionesEnRango(dia, manana, tick(setLiquidaciones)),
      subscribeRendicionesEnRango(dia, manana, tick(setRendiciones)),
    ]
    return () => offs.forEach((off) => off())
  }, [dia])

  const resumen = useMemo(
    () => resumenLive({
      ventasCamion, ventasVentanilla: [...vvT, ...vvM], cobranzas, remitos: [...remT, ...remM], descargas: [...descT, ...descM],
      liquidaciones, rendiciones, sesiones: [...sesT.sesiones, ...sesM.sesiones], sobres: [...sobT.sobres, ...sobM.sobres],
    }),
    [ventasCamion, vvT, vvM, cobranzas, remT, remM, descT, descM, liquidaciones, rendiciones, sesT.sesiones, sesM.sesiones, sobT.sobres, sobM.sobres],
  )
  return { resumen, cobranzas, ultimoCambio }
}
