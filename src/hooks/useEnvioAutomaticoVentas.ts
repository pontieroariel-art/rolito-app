import { useEffect, useRef, useState } from 'react'
import { useOnline } from './useOnline'
import { subscribeVentasRecientesChofer } from '@/services/ventaCamionService'
import { procesarEnviosAutomaticos } from '@/services/envioAutomaticoVentasService'
import type { VentaCamion } from '@/types'

// Manda solo el comprobante al mail del cliente por cada venta reciente del
// chofer que todavía no salió (services/envioAutomaticoVentasService). Se
// dispara cada vez que cambian las ventas (nueva venta, llegó el CAE) o vuelve
// la señal; las pasadas se encadenan para no superponerse. Devuelve un contador
// de envíos hechos en esta sesión, por si la pantalla quiere refrescar chips.
export function useEnvioAutomaticoVentas(ventas: VentaCamion[] | null): number {
  const online = useOnline()
  const cola = useRef(Promise.resolve())
  const [enviadas, setEnviadas] = useState(0)
  useEffect(() => {
    if (!ventas || !ventas.length || !online) return
    cola.current = cola.current
      .then(() => procesarEnviosAutomaticos(ventas, { online: true }))
      .then((n) => { if (n > 0) setEnviadas((x) => x + n) })
      .catch(() => undefined)
  }, [ventas, online])
  return enviadas
}

/** Ventas recientes del chofer (las 50 últimas), para el hub: alimenta el envío automático. */
export function useVentasRecientesChofer(uid: string | null | undefined): VentaCamion[] | null {
  const [ventas, setVentas] = useState<VentaCamion[] | null>(null)
  useEffect(() => {
    if (!uid) { setVentas(null); return }
    return subscribeVentasRecientesChofer(uid, setVentas)
  }, [uid])
  return ventas
}
