import { useMemo } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { subscribeClientesIndexTodos } from '@/services/clientesIndexService'
import type { ClienteIndex } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { tieneAlgunRol } from '@/utils/roles'

const VACIO: ClienteIndex[] = []

// En la calle (chofer, supervisor) el índice queda vivo 2 h y no 5 min (R11,
// auditoría del chofer): entre venta y venta pasan más de 5 min y cada vuelta
// releía los 2.226 clientes. Si el teléfono se duerme más de 30 min Firestore
// igual relee al reconectar; esto cubre la app abierta entre ventas.
const KEEP_ALIVE_OFICINA = 5 * 60_000
const KEEP_ALIVE_CALLE = 2 * 60 * 60_000

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
  const { user } = useAuth()
  const enLaCalle = !!user && tieneAlgunRol(user, ['chofer', 'supervisor'])
  const { data, loading, timedOut } = useSharedSubscription<ClienteIndex[]>('clientesIndex:todos', subscribeClientesIndexTodos, VACIO, { keepAliveMs: enLaCalle ? KEEP_ALIVE_CALLE : KEEP_ALIVE_OFICINA, ...opts })
  return { clientes: data, loading: loading && !timedOut }
}
