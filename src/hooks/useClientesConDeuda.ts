import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { subscribeClientesConDeuda } from '@/services/saldosTangoService'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { armarFilasDeuda, type FilaDeuda } from '@/utils/listaClientesDeuda'
import type { Cobranza, SaldoTango } from '@/types'

/**
 * La agenda del día del supervisor: los clientes que deben (cache `saldosTango`),
 * con su zona (cruzada con `clientesIndex`) y marcados los que ya se cobraron hoy
 * (sus cobranzas del día). Antes del 2026-09-13 la suscripción a saldos estaba
 * copiada en las dos pantallas que se fusionaron.
 *
 * Las tres fuentes ya se usaban en el módulo: `clientesIndex` es la suscripción
 * compartida del buscador (no suma lectura) y las cobranzas del día son las
 * mismas que muestra el inicio.
 */
export function useClientesConDeuda() {
  const { user } = useAuth()
  const fecha = useFechaDelDia()
  const alertas = useAlertasMora()
  const { clientes } = useClientesIndex()
  const [saldos, setSaldos] = useState<SaldoTango[]>([])
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => subscribeClientesConDeuda((s) => { setSaldos(s); setCargando(false) }), [])

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, setCobranzasHoy)
  }, [user, fecha])

  const filas: FilaDeuda[] = useMemo(
    () => armarFilasDeuda(saldos, clientes, cobranzasHoy, alertas),
    [saldos, clientes, cobranzasHoy, alertas],
  )

  return { filas, cargando, sinSaldos: !cargando && saldos.length === 0 }
}
