import { useQuery } from '@tanstack/react-query'
import { getMotivosIngreso } from '../services/motivoIngresoService'

export function useMotivosIngreso() {
  const { data, isLoading } = useQuery({
    queryKey:  ['motivosIngreso'],
    queryFn:   getMotivosIngreso,
    staleTime: 5 * 60 * 1000,
  })
  return { motivos: data ?? [], isLoading }
}
