import { useSharedSubscription } from '@/hooks/useSharedSubscription'
import { subscribeRemitosCargaChoferHoy } from '@/services/remitoCargaService'
import { subscribeVentasRecientesChofer } from '@/services/ventaCamionService'
import { subscribeDespachosForAyudante, subscribeDespachosForDriver } from '@/services/despachoService'
import type { Despacho, RemitoCarga, VentaCamion } from '@/types'
import { useDiaActual } from '@/hooks/useDiaActual'

// Suscripciones del chofer COMPARTIDAS entre pantallas (2026-09-26, auditoría
// del chofer, R6). El remito de hoy lo abrían por separado el inicio, Vender,
// Entregar, Cobrar, Mis papeles y Mi rendición, y cada cambio de pantalla
// cerraba el listener y lo volvía a armar (con su "cargando" y su lectura). Con
// useSharedSubscription hay uno solo por dato y queda vivo 30 s después de
// salir de la pantalla: ir y volver entre Inicio, Vender y Mis ventas no
// rearma nada. La key lleva el día (useDiaActual), así a la medianoche se
// abre la del día nuevo.

const SIN_REMITOS: RemitoCarga[] = []
const SIN_DESPACHOS: Despacho[] = []

/** Remitos de carga de HOY del chofer, del más nuevo al más viejo. */
export function useRemitosChoferHoy(uid: string | null | undefined, enabled = true) {
  const dia = useDiaActual()
  return useSharedSubscription<RemitoCarga[]>(
    `remitosChoferHoy:${uid ?? ''}:${dia}`,
    (cb) => subscribeRemitosCargaChoferHoy(uid ?? '', cb),
    SIN_REMITOS,
    { enabled: enabled && !!uid },
  )
}

export interface VentasRecientes { ventas: VentaCamion[] | null; pendientes: number }
const SIN_VENTAS: VentasRecientes = { ventas: null, pendientes: 0 }

/** Las 50 ventas más recientes del chofer y cuántas siguen sin subir. */
export function useVentasRecientesCompartidas(uid: string | null | undefined) {
  return useSharedSubscription<VentasRecientes>(
    `ventasRecientesChofer:${uid ?? ''}`,
    (cb, onErr) => {
      let pendientes = 0
      let ventas: VentaCamion[] | null = null
      return subscribeVentasRecientesChofer(
        uid ?? '',
        (vs) => { ventas = vs; cb({ ventas, pendientes }) },
        onErr,
        (n) => { if (n !== pendientes) { pendientes = n; cb({ ventas, pendientes }) } },
      )
    },
    SIN_VENTAS,
    { enabled: !!uid },
  )
}

/** Despachos del día del chofer (por su mail) o del ayudante (los del chofer al que acompaña). */
export function useDespachosDelDia(email: string | null | undefined, como: 'chofer' | 'ayudante', enabled = true) {
  const dia = useDiaActual()
  return useSharedSubscription<Despacho[]>(
    `despachos:${como}:${email ?? ''}:${dia}`,
    (cb) => (como === 'chofer'
      ? subscribeDespachosForDriver(dia, email ?? '', cb)
      : subscribeDespachosForAyudante(dia, email ?? '', cb)),
    SIN_DESPACHOS,
    { enabled: enabled && !!email },
  )
}
