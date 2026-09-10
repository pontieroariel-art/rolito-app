import { useEffect, useState } from 'react'
import { subscribeCotConfig } from '@/services/cotConfigService'
import { COT_DEFAULTS } from '@/utils/cot'
import type { CotConfig } from '@/types'

/** config/cot en vivo (COT de ARBA), con defaults hasta que llegue el doc. */
export function useCotConfig(): { cfg: CotConfig; cargado: boolean } {
  const [cfg, setCfg] = useState<CotConfig>(COT_DEFAULTS)
  const [cargado, setCargado] = useState(false)
  useEffect(() => subscribeCotConfig((c) => { setCfg(c); setCargado(true) }), [])
  return { cfg, cargado }
}
