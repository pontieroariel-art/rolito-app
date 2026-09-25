import { useEffect, useMemo, useState } from 'react'
import { PLANTAS, type CajaSesion, type PlantaId, type Sobre } from '@/types'
import { custodiaDePlanta, type CustodiaPlanta } from '@/utils/sobres'
import { subscribeConfigTesoreria, type ConfigTesoreria, HORAS_AVISO_SOBRE_DEFAULT } from '@/services/tesoreriaConfigService'
import { useSesionesDelDia } from './useCajaSesion'
import { useSobresDelDia, useSobresPendientes } from './useSobres'

// Custodia en un vistazo para tesorería (rendición de fondos, 2026-09-14):
// dónde está la plata de cada planta AHORA. Cinco streams acotados (los sobres
// y las sesiones del día de cada planta, más los sobres pendientes de
// cualquier fecha: uno de ayer sin recibir tiene que seguir apareciendo) y la
// cuenta pura de `custodiaDePlanta`. Lo comparten la Recepción y el tablero
// en vivo, así los dos dicen el mismo número.

export interface CustodiaTesoreria {
  porPlanta:  Record<PlantaId, CustodiaPlanta>
  /** Sobres de ventanilla sin recibir, de todas las fechas, el más viejo primero. */
  pendientes: Sobre[]
  config:     ConfigTesoreria
  /** Reloj de la pantalla (cada minuto): para la antigüedad de los sobres. */
  ahora:      number
  loading:    boolean
  error:      boolean
}

const PLANTA_IDS = Object.keys(PLANTAS) as PlantaId[]

export function useCustodiaTesoreria(fecha: string): CustodiaTesoreria {
  const sobT = useSobresDelDia('torcuato', fecha)
  const sobM = useSobresDelDia('merlo', fecha)
  const sesT = useSesionesDelDia('torcuato', fecha)
  const sesM = useSesionesDelDia('merlo', fecha)
  const pend = useSobresPendientes(undefined, 'tesoreria')

  const [config, setConfig] = useState<ConfigTesoreria>({ horasAvisoSobre: HORAS_AVISO_SOBRE_DEFAULT })
  useEffect(() => subscribeConfigTesoreria(setConfig), [])

  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const porPlanta = useMemo(() => {
    const delDia: Record<PlantaId, Sobre[]> = { torcuato: sobT.sobres, merlo: sobM.sobres }
    const sesiones: Record<PlantaId, CajaSesion[]> = { torcuato: sesT.sesiones, merlo: sesM.sesiones }
    const out = {} as Record<PlantaId, CustodiaPlanta>
    for (const p of PLANTA_IDS) {
      // Los pendientes de otro día no están en el stream del día: se suman sin repetir.
      const ids = new Set(delDia[p].map((s) => s.id))
      const sobres = [...delDia[p], ...pend.sobres.filter((s) => s.plantaId === p && !ids.has(s.id))]
      out[p] = custodiaDePlanta(p, fecha, sesiones[p], sobres, ahora)
    }
    return out
  }, [sobT.sobres, sobM.sobres, sesT.sesiones, sesM.sesiones, pend.sobres, fecha, ahora])

  return {
    porPlanta,
    pendientes: pend.sobres,
    config,
    ahora,
    loading: sobT.loading || sobM.loading || sesT.loading || sesM.loading || pend.loading,
    error:   sobT.error || sobM.error || sesT.error || sesM.error || pend.error,
  }
}

/** La custodia de una planta o la suma de todas (selector "Todas" de la Recepción). */
export function custodiaTotal(porPlanta: Record<PlantaId, CustodiaPlanta>, plantaId: PlantaId | 'todas'): CustodiaPlanta {
  if (plantaId !== 'todas') return porPlanta[plantaId]
  const partes = PLANTA_IDS.map((p) => porPlanta[p])
  const suma = (f: (c: CustodiaPlanta) => number) => Math.round(partes.reduce((s, c) => s + f(c), 0) * 100) / 100
  return {
    cajasAbiertas:    partes.flatMap((c) => c.cajasAbiertas),
    enCamino:         partes.flatMap((c) => c.enCamino),
    porRecibirEnCaja: partes.flatMap((c) => c.porRecibirEnCaja),
    recibidosHoy:     partes.flatMap((c) => c.recibidosHoy),
    anticipos:        partes.flatMap((c) => c.anticipos),
    totales: {
      enCamino:         suma((c) => c.totales.enCamino),
      porRecibirEnCaja: suma((c) => c.totales.porRecibirEnCaja),
      recibidoHoy:      suma((c) => c.totales.recibidoHoy),
      tieneQueLlegar:   suma((c) => c.totales.tieneQueLlegar),
      falta:            suma((c) => c.totales.falta),
    },
  }
}
