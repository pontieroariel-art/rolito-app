import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getClientesActivos } from '../services/userService'
import { UserProfile, getPrimaryAddress } from '../types'

export interface SucursalItem {
  key:     string        // uid o uid_addrId — único por fila
  user:    UserProfile
  addrId:  string        // address.id o '' si no tiene addresses
  label:   string        // nombre de la sucursal (address.nombre || razonSocial)
  address: string        // dirección de entrega
}

export function useSucursales() {
  const { data: allUsers = [], isLoading, isError } = useQuery({
    queryKey:  ['users', 'clientes-activos'],
    queryFn:   () => getClientesActivos(),
    staleTime: 0,
  })

  const sucursales = useMemo<SucursalItem[]>(() => {
    return allUsers.flatMap((u) => {
      const baseName = u.razonSocial || u.nombre || u.email
      if (u.addresses?.length) {
        return u.addresses.map((addr) => ({
          key:     `${u.uid}_${addr.id}`,
          user:    u,
          addrId:  addr.id,
          label:   addr.nombre || baseName,
          address: addr.address,
        }))
      }
      return [{
        key:     u.uid,
        user:    u,
        addrId:  '',
        label:   baseName,
        address: getPrimaryAddress(u)?.address || u.address || '',
      }]
    })
  }, [allUsers])

  return { sucursales, isLoading, isError }
}
