import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
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
  }, [user?.uid, addressesKey])

  const setSelectedAddress = (addr: DeliveryAddress) => {
    setSelectedAddressState(addr)
    if (user?.uid) {
      localStorage.setItem(`branch_${user.uid}`, JSON.stringify(addr))
    }
  }

  const clearBranch = () => {
    setSelectedAddressState(null)
    if (user?.uid) {
      localStorage.removeItem(`branch_${user.uid}`)
    }
  }

  const addresses = user?.addresses ?? []
  const needsSelection = addresses.length > 1 && !selectedAddress

  return (
    <BranchContext.Provider value={{ selectedAddress, setSelectedAddress, clearBranch, needsSelection }}>
      {children}
    </BranchContext.Provider>
  )
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch debe usarse dentro de BranchProvider')
  return ctx
}
