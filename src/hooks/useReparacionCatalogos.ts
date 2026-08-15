import { useQuery } from '@tanstack/react-query'
import { getMotivosReparacion, getTiposReparacion } from '../services/reparacionCatalogService'

export function useMotivosReparacion() {
  const { data, isLoading } = useQuery({
    queryKey:  ['motivosReparacion'],
    queryFn:   getMotivosReparacion,
    staleTime: 5 * 60 * 1000,
  })
  return { motivos: data ?? [], isLoading }
}

export function useTiposReparacion() {
  const { data, isLoading } = useQuery({
    queryKey:  ['tiposReparacion'],
    queryFn:   getTiposReparacion,
    staleTime: 5 * 60 * 1000,
  })
  return { tipos: data ?? [], isLoading }
}
