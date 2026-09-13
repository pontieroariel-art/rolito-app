import { useEffect, useState } from 'react'
import { subscribeUmbralFaltantes } from '@/services/faltantesConfigService'
import { UMBRAL_FALTANTES_DEFAULT, type UmbralFaltantes } from '@/utils/faltantes'

/** Umbral de faltante grave (config/liquidacion), con default hasta que llegue el doc. */
export function useUmbralFaltantes(): UmbralFaltantes {
  const [umbral, setUmbral] = useState<UmbralFaltantes>(UMBRAL_FALTANTES_DEFAULT)
  useEffect(() => subscribeUmbralFaltantes(setUmbral), [])
  return umbral
}
