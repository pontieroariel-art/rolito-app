import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTodosLosClientes } from '../services/userService'
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
    queryKey:  ['users', 'todos-clientes'],
    queryFn:   () => getTodosLosClientes(),
    staleTime: 0,
  })

  const sucursales = useMemo<SucursalItem[]>(() => {
    const seen = new Set<string>()
    const result: SucursalItem[] = []

    for (const u of allUsers) {
      const baseName = u.razonSocial || u.nombre || u.email

      if (u.addresses?.length) {
        for (const addr of u.addresses) {
          const dedupeKey = `${u.uid}|${addr.id}|${addr.address}`
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          result.push({
            key:     `${u.uid}_${addr.id}`,
            user:    u,
            addrId:  addr.id,
            label:   addr.nombre || baseName,
            address: addr.address,
          })
        }
      } else {
        const addr = getPrimaryAddress(u)?.address || u.address || ''
        const dedupeKey = `${u.uid}||${addr}`
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey)
          result.push({
            key:     u.uid,
            user:    u,
            addrId:  '',
            label:   baseName,
            address: addr,
          })
        }
      }
    }

    return result
  }, [allUsers])

  return { sucursales, isLoading, isError }
}
