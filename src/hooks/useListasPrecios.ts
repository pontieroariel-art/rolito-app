import { useQuery } from '@tanstack/react-query'
import { getAllListasPrecios, getListaPrecios } from '../services/listaPreciosService'

export function useAllListasPrecios() {
  const { data, isLoading } = useQuery({
    queryKey:  ['listas-precios'],
    queryFn:   getAllListasPrecios,
    staleTime: 5 * 60_000,
  })
  return { listas: data ?? [], isLoading }
}

export function useListaPrecios(id?: string) {
  const { data, isLoading } = useQuery({
    queryKey:  ['listas-precios', id],
    queryFn:   () => getListaPrecios(id!),
    enabled:   !!id,
    staleTime: 5 * 60_000,
  })
  return { lista: data ?? null, isLoading }
}
