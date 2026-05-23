import { useQuery } from '@tanstack/react-query'
import { getChoferes } from '../services/userService'
import { UserProfile } from '../types'

export function useChoferes() {
  const { data, isLoading } = useQuery({
    queryKey:  ['users', 'choferes'],
    queryFn:   getChoferes,
    staleTime: 300_000,
  })
  return { choferes: (data ?? []) as UserProfile[], loading: isLoading }
}
