import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { useDiaActual } from './useDiaActual'
import { addDaysStr } from '@/utils/helpers'
import {
  contarEstadoBackoffice, subscribeConfigArca, subscribeConfigTangoEstado,
  type ConfigArcaEstado, type ConfigTangoEstado, type ConteosBackoffice,
} from '@/services/backofficeEstadoService'
import { subscribeAnulacionesPendientes } from '@/services/anulacionService'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { subscribeEntregasPorConfirmar } from '@/services/entregaTesoreriaService'
import { subscribeRollupsEnRango } from '@/services/rollupService'
import { subscribeCotConfig } from '@/services/cotConfigService'
import { getHistorialAdmin, type HistorialAdminEvento } from '@/services/historialAdminService'
import { normalizarCotConfig } from '@/utils/cot'
import type { AnulacionVentanilla, CotConfig, EntregaTesoreria, Rendicion, RollupPedidosDia } from '@/types'

// Estado del panel de control del super_admin (2026-09-10). Dos fuentes:
//  - contadores (getCountFromServer) que se refrescan al montar, cada 60 s con
//    la pestaña visible y con el botón Actualizar;
//  - streams acotados en tiempo real (anulaciones pendientes, rendiciones de
//    7 días, entregas por confirmar, rollup de hoy, config de Tango/ARCA/COT),
//    compartidos con useSharedSubscription para que ir y volver de /admin no
//    rearme nada.

const REFRESCO_MS = 60_000
const DIAS_RENDICIONES = 7

const CONFIG_TANGO_VACIA: ConfigTangoEstado = {
  bridgeLastSeen: null, clientes: null, precios: null, saldos: null, altas: null,
  comprobantes: { ultima: null, ok: null, error: null }, enabled: null,
}

export interface EstadoBackoffice {
  conteos:      ConteosBackoffice | null
  anulaciones:  AnulacionVentanilla[]
  rendiciones:  Rendicion[]
  entregas:     EntregaTesoreria[]
  rollupHoy:    RollupPedidosDia | null
  configTango:  ConfigTangoEstado
  configArca:   ConfigArcaEstado
  configCot:    CotConfig
  historial:    HistorialAdminEvento[]
  hoy:          string
}

export function useEstadoBackoffice() {
  const hoy = useDiaActual()
  const desdeRendiciones = addDaysStr(hoy, -DIAS_RENDICIONES)
  const hastaRendiciones = addDaysStr(hoy, 1)

  const [conteos, setConteos] = useState<ConteosBackoffice | null>(null)
  const [historial, setHistorial] = useState<HistorialAdminEvento[]>([])
  const [ultimoRefresco, setUltimoRefresco] = useState<Date | null>(null)
  const [refrescando, setRefrescando] = useState(false)

  const refrescar = useCallback(async () => {
    setRefrescando(true)
    try {
      const [c, h] = await Promise.all([contarEstadoBackoffice(), getHistorialAdmin(8).catch(() => [] as HistorialAdminEvento[])])
      setConteos(c)
      setHistorial(h)
      setUltimoRefresco(new Date())
    } finally {
      setRefrescando(false)
    }
  }, [])

  useEffect(() => {
    void refrescar()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void refrescar() }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [refrescar])

  const anulaciones = useSharedSubscription<AnulacionVentanilla[]>('backoffice:anulaciones', subscribeAnulacionesPendientes, [])
  const rendiciones = useSharedSubscription<Rendicion[]>(
    `backoffice:rendiciones:${desdeRendiciones}:${hastaRendiciones}`,
    (cb) => subscribeRendicionesEnRango(desdeRendiciones, hastaRendiciones, cb),
    [],
  )
  const entregas  = useSharedSubscription<EntregaTesoreria[]>('backoffice:entregas', subscribeEntregasPorConfirmar, [])
  const rollups   = useSharedSubscription<RollupPedidosDia[]>(`backoffice:rollup:${hoy}`, (cb) => subscribeRollupsEnRango(hoy, hoy, cb), [])
  const configTango = useSharedSubscription<ConfigTangoEstado>('backoffice:config/tango', subscribeConfigTangoEstado, CONFIG_TANGO_VACIA)
  const configArca  = useSharedSubscription<ConfigArcaEstado>('backoffice:config/arca', subscribeConfigArca, { habilitado: null })
  const configCot   = useSharedSubscription<CotConfig>('backoffice:config/cot', (cb) => subscribeCotConfig(cb), normalizarCotConfig(null))

  const estado = useMemo<EstadoBackoffice>(() => ({
    conteos,
    anulaciones: anulaciones.data,
    rendiciones: rendiciones.data,
    entregas:    entregas.data,
    rollupHoy:   rollups.data.find((r) => r.fecha === hoy) ?? null,
    configTango: configTango.data,
    configArca:  configArca.data,
    configCot:   configCot.data,
    historial,
    hoy,
  }), [conteos, anulaciones.data, rendiciones.data, entregas.data, rollups.data, configTango.data, configArca.data, configCot.data, historial, hoy])

  return { estado, loading: conteos === null, refrescando, ultimoRefresco, refrescar }
}
