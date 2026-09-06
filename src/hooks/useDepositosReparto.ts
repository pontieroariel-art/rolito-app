import { useMemo } from 'react'
import { useSharedSubscription } from './useSharedSubscription'
import { subscribeDepositosTango } from '@/services/depositosService'
import { depositoDeUsuario, ordenarDepositosReparto } from '@/utils/depositos'
import type { DepositoTango } from '@/types'

const VACIO: DepositoTango[] = []

// Catálogo de depósitos de Tango, compartido entre pantallas (carga,
// descarga, liquidación, venta). `reparto` = los que salen a repartir
// (tipo repartidor, activos), ordenados por código.
export function useDepositosReparto(opts: { enabled?: boolean } = {}) {
  const { data: depositos, loading } = useSharedSubscription<DepositoTango[]>('depositosTango', subscribeDepositosTango, VACIO, opts)
  const reparto = useMemo(() => ordenarDepositosReparto(depositos), [depositos])
  return { depositos, reparto, loading }
}

/** El depósito del usuario logueado (chofer o supervisor vinculado), o undefined. */
export function useDepositoDelUsuario(uid: string | null | undefined): { deposito: DepositoTango | undefined; loading: boolean } {
  const { depositos, loading } = useDepositosReparto({ enabled: !!uid })
  return { deposito: useMemo(() => depositoDeUsuario(depositos, uid), [depositos, uid]), loading }
}
