import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react'
import { DeliveryAddress } from '../types'
import { useAuth } from './AuthContext'

interface BranchContextValue {
  selectedAddress: DeliveryAddress | null
  setSelectedAddress: (addr: DeliveryAddress) => void
  clearBranch: () => void
  needsSelection: boolean  // true si tiene múltiples sucursales y no eligió
}

const BranchContext = createContext<BranchContextValue | null>(null)

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [selectedAddress, setSelectedAddressState] = useState<DeliveryAddress | null>(null)

  // Key estable basada en IDs de addresses — evita recalcular por cambios de propiedades internas
  const addressesKey = user?.addresses?.map((a) => a.id).join(',') ?? ''

  useEffect(() => {
    if (!user?.uid) {
      setSelectedAddressState(null)
      return
    }
    const addresses = user.addresses ?? []

    // Una sola sucursal → se selecciona automáticamente
    if (addresses.length === 1) {
      setSelectedAddressState(addresses[0])
      return
    }
    // Sin sucursales
    if (addresses.length === 0) {
      setSelectedAddressState(null)
      return
    }
    // Múltiples: restaurar desde localStorage
    const stored = localStorage.getItem(`branch_${user.uid}`)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DeliveryAddress
        // Verificar que la sucursal guardada sigue existiendo
        const stillExists = addresses.some((a) => a.id === parsed.id)
        setSelectedAddressState(stillExists ? parsed : null)
      } catch {
        setSelectedAddressState(null)
      }
    } else {
      setSelectedAddressState(null)
    }
    // addressesKey reemplaza deliberadamente a user.addresses (ver comentario arriba)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, addressesKey])

  const uid = user?.uid
  const setSelectedAddress = useCallback((addr: DeliveryAddress) => {
    setSelectedAddressState(addr)
    if (uid) localStorage.setItem(`branch_${uid}`, JSON.stringify(addr))
  }, [uid])

  const clearBranch = useCallback(() => {
    setSelectedAddressState(null)
    if (uid) localStorage.removeItem(`branch_${uid}`)
  }, [uid])

  const needsSelection = (user?.addresses?.length ?? 0) > 1 && !selectedAddress
  // value memoizado (2026-09-12): el objeto nuevo en cada render re-renderizaba a todos los consumidores.
  const value = useMemo(() => ({ selectedAddress, setSelectedAddress, clearBranch, needsSelection }), [selectedAddress, setSelectedAddress, clearBranch, needsSelection])

  return (
    <BranchContext.Provider value={value}>
      {children}
    </BranchContext.Provider>
  )
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch debe usarse dentro de BranchProvider')
  return ctx
}
