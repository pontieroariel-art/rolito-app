import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTecnicos } from '../services/userService'
import { UserProfile } from '../types'

export function useTecnicos() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey:  ['users', 'tecnicos'],
    queryFn:   getTecnicos,
    staleTime: 60_000,
  })
  return {
    tecnicos: (data ?? []) as UserProfile[],
    loading:  isLoading,
    refetch:  () => qc.invalidateQueries({ queryKey: ['users', 'tecnicos'] }),
  }
}
