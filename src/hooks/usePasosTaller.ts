import { useQuery } from '@tanstack/react-query'
import { getPasosTaller } from '../services/pasosTallerService'

export function usePasosTaller() {
  const { data, isLoading } = useQuery({
    queryKey:  ['pasosTaller'],
    queryFn:   getPasosTaller,
    staleTime: 5 * 60 * 1000,
  })
  return { pasos: data ?? {}, isLoading }
}
