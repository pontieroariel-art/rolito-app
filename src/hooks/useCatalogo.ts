import { useQuery } from '@tanstack/react-query'
import { getCatalogo } from '../services/catalogoService'

export function useCatalogo() {
  const { data, isLoading } = useQuery({
    queryKey:  ['catalogo'],
    queryFn:   getCatalogo,
    staleTime: Infinity,
  })
  return { catalogo: data ?? [], isLoading }
}
