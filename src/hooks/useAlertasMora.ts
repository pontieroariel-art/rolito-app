import { useEffect, useState } from 'react'
import { subscribeAlertasMora } from '@/services/moraConfigService'
import { ALERTAS_MORA_DEFAULT, type AlertasMoraConfig } from '@/utils/mora'

/** Umbrales de mora (config/cobranzas), con defaults hasta que llegue el doc. */
export function useAlertasMora(): AlertasMoraConfig {
  const [cfg, setCfg] = useState<AlertasMoraConfig>(ALERTAS_MORA_DEFAULT)
  useEffect(() => subscribeAlertasMora(setCfg), [])
  return cfg
}
