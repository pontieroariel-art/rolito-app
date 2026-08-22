import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getOperariosProduccion } from '../services/userService'
import { UserProfile } from '../types'

export function useOperariosProduccion() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey:  ['users', 'operariosProduccion'],
    queryFn:   getOperariosProduccion,
    staleTime: 60_000,
  })
  return {
    operarios: (data ?? []) as UserProfile[],
    loading:   isLoading,
    refetch:   () => qc.invalidateQueries({ queryKey: ['users', 'operariosProduccion'] }),
  }
}
