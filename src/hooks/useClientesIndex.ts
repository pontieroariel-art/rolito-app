import { useMemo } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { subscribeClientesIndexTodos } from '@/services/clientesIndexService'
import type { ClienteIndex } from '@/types'

const VACIO: ClienteIndex[] = []

// Clientes activos para BUSCAR (índice liviano clientesIndex, 2026-09-10): una
// sola suscripción compartida entre pantallas, servida desde la caché del
// teléfono. Reemplaza a useClientesActivos en los buscadores; la ficha completa
// se pide con useClienteSeleccionado al elegir uno.
//
// Desde el 2026-09-22 es una vista de la MISMA suscripción que useClientesIndexTodos
// (filtrada a activos en memoria): antes eran dos streams de la misma colección
// (2.178 activos + 2.226 todos) cuando una pantalla usaba los dos hooks, y la
// diferencia son 48 docs.
export function useClientesIndex(opts: { enabled?: boolean } = {}) {
  const { clientes: todos, loading } = useClientesIndexTodos(opts)
  const ordenados = useMemo(
    () => todos.filter((c) => c.estado === 'activo').sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es')),
    [todos],
  )
  return { clientes: ordenados, loading }
}

// Todos los clientes del índice, de cualquier estado (2026-09-14): reemplaza a
// `getAllUsers` (2.000+ fichas completas con preciosTango) en las pantallas de
// escritorio que solo necesitan razón social, código y estado para cruzar
// pedidos históricos y armar el combo de clientes.
export function useClientesIndexTodos(opts: { enabled?: boolean } = {}) {
  const { data, loading, timedOut } = useSharedSubscription<ClienteIndex[]>('clientesIndex:todos', subscribeClientesIndexTodos, VACIO, { keepAliveMs: 5 * 60_000, ...opts })
  return { clientes: data, loading: loading && !timedOut }
}
