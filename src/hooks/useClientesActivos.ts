import { useQuery } from '@tanstack/react-query'
import { getClientesActivos } from '../services/userService'
import { UserProfile } from '../types'

export function useClientesActivos() {
  const { data, isLoading } = useQuery({
    queryKey:  ['users', 'clientesActivos'],
    queryFn:   getClientesActivos,
    staleTime: 300_000,
  })
  return { clientes: (data ?? []) as UserProfile[], loading: isLoading }
}
