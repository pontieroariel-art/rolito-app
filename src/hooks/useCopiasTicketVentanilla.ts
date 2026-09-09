import { useEffect, useState } from 'react'
import { normalizarCopiasPorPlanta, subscribeCopiasTicket, type CopiasTicketPorPlanta } from '@/services/ventanillaConfigService'

/** Copias del comprobante de turno por planta (config/ventanilla), con el default hasta que llegue el doc. */
export function useCopiasTicketVentanilla(): CopiasTicketPorPlanta {
  const [cfg, setCfg] = useState<CopiasTicketPorPlanta>(() => normalizarCopiasPorPlanta(null))
  useEffect(() => subscribeCopiasTicket(setCfg), [])
  return cfg
}
