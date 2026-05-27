import { useQuery } from '@tanstack/react-query'
import { getCatalogo } from '../services/catalogoService'

export function useCatalogo() {
  const { data, isLoading } = useQuery({
    queryKey:  ['catalogo'],
    queryFn:   getCatalogo,
    staleTime: 5 * 60 * 1000, // 5 min — el catálogo puede cambiar en producción
  })
  return { catalogo: data ?? [], isLoading }
}
