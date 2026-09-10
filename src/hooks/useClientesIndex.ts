import { useMemo } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { subscribeClientesIndex } from '@/services/clientesIndexService'
import type { ClienteIndex } from '@/types'

const VACIO: ClienteIndex[] = []

// Clientes activos para BUSCAR (índice liviano clientesIndex, 2026-09-10): una
// sola suscripción compartida entre pantallas, servida desde la caché del
// teléfono. Reemplaza a useClientesActivos en los buscadores; la ficha completa
// se pide con useClienteSeleccionado al elegir uno.
export function useClientesIndex(opts: { enabled?: boolean } = {}) {
  const { data, loading, timedOut } = useSharedSubscription<ClienteIndex[]>('clientesIndex', subscribeClientesIndex, VACIO, { keepAliveMs: 5 * 60_000, ...opts })
  const ordenados = useMemo(() => [...data].sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es')), [data])
  return { clientes: ordenados, loading: loading && !timedOut }
}
