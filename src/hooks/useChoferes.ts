import { useQuery } from '@tanstack/react-query'
import { getAllUsers } from '../services/userService'
import { UserProfile } from '../types'

export function useChoferes() {
  const { data, isLoading } = useQuery({
    queryKey: ['users', 'choferes'],
    queryFn:  () => getAllUsers().then((users) =>
      users.filter((u) => u.rol === 'chofer' && u.estado === 'activo')
    ),
    staleTime: 60_000,
  })
  return { choferes: (data ?? []) as UserProfile[], loading: isLoading }
}
