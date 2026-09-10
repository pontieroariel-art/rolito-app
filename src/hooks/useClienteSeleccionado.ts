import { useQuery } from '@tanstack/react-query'
import { getUserDocument } from '@/services/userService'
import type { UserProfile } from '@/types'

// Ficha completa de UN cliente (precios de Tango, condición de venta, domicilios,
// sucursales) al elegirlo en un buscador (2026-09-10): una lectura por id, con
// caché de 5 minutos por si vuelve al mismo cliente. Antes esa ficha venía en la
// lista entera de 2.000+ clientes que bajaba cada pantalla.
export function useClienteSeleccionado(uid: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['users', 'cliente', uid ?? ''],
    queryFn:  () => getUserDocument(uid!),
    enabled:  !!uid,
    staleTime: 300_000,
  })
  return { cliente: (uid ? data ?? undefined : undefined) as UserProfile | undefined, loading: !!uid && isLoading }
}
