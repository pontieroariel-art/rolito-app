import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { useSharedSubscription } from '@/hooks/useSharedSubscription'
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
 *
 * Los saldos (docs pesados, con `comprobantes[]`) van por suscripción
 * COMPARTIDA con keep-alive (2026-09-14): ir de la agenda a la ficha y volver
 * no vuelve a bajar la lista entera. Sin `limit`: esconder un deudor sería
 * un cambio funcional.
 */
const SIN_SALDOS: SaldoTango[] = []

export function useClientesConDeuda() {
  const { user } = useAuth()
  const uid = user?.uid
  const fecha = useFechaDelDia()
  const alertas = useAlertasMora()
  const { clientes } = useClientesIndex()
  const { data: saldos, loading: cargando } = useSharedSubscription<SaldoTango[]>(
    'saldosTango:deuda', subscribeClientesConDeuda, SIN_SALDOS, { keepAliveMs: 5 * 60_000 },
  )
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])

  // Depende del uid y no del perfil entero: AuthContext lo actualiza en vivo y
  // cada cambio del doc resuscribía las cobranzas del día.
  useEffect(() => {
    if (!uid) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    return subscribeCobranzasChoferEnRango(uid, desde, hasta, setCobranzasHoy)
  }, [uid, fecha])

  const filas: FilaDeuda[] = useMemo(
    () => armarFilasDeuda(saldos, clientes, cobranzasHoy, alertas),
    [saldos, clientes, cobranzasHoy, alertas],
  )

  return { filas, cargando, sinSaldos: !cargando && saldos.length === 0 }
}
