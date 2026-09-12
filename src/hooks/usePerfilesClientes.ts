import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getUserDocument } from '@/services/userService'
import type { UserProfile } from '@/types'

// Fichas completas de UN PUÑADO de clientes por id (2026-09-12): la ventanilla
// las necesita para reimprimir la factura o el ticket de las ventas del día
// (CUIT, condición de IVA, sucursal). Antes bajaba las 2.000+ fichas de todos
// los clientes activos para eso. Misma caché por id que useClienteSeleccionado.
export function usePerfilesClientes(uids: Array<string | null | undefined>): Map<string, UserProfile> {
  const unicos = useMemo(() => [...new Set(uids.filter((u): u is string => !!u))].sort(), [uids])
  const consultas = useQueries({
    queries: unicos.map((uid) => ({
      queryKey: ['users', 'cliente', uid],
      queryFn:  () => getUserDocument(uid),
      staleTime: 300_000,
    })),
  })
  // La identidad del Map solo cambia cuando cambia alguna ficha, no en cada render.
  const firma = consultas.map((q) => (q.data ? (q.data as UserProfile).uid : '')).join('|')
  return useMemo(() => {
    const m = new Map<string, UserProfile>()
    consultas.forEach((q) => { const p = q.data as UserProfile | null | undefined; if (p) m.set(p.uid, p) })
    return m
  // 'consultas' cambia de identidad en cada render; 'firma' resume su contenido.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma])
}
