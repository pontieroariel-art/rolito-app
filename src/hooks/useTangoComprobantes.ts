import { useEffect, useMemo, useState } from 'react'
import type { EmpresaTango, TangoComprobantesDoc, UserProfile } from '@/types'
import { subscribeTangoComprobantes } from '@/services/tangoComprobantesService'
import { tangoIdsDe } from '@/utils/tangoEmpresas'

// Índices de facturas y remitos de Tango de un cliente: uno por cada código
// que tiene en cada empresa (sucursales). Se suscribe a todos y devuelve la
// lista (los que todavía no existen en Firestore se omiten).
export function useTangoComprobantes(cliente: Pick<UserProfile, 'idGva14Tango' | 'codigoTango' | 'tangoIds'> | null | undefined): { indices: TangoComprobantesDoc[]; cargando: boolean } {
  const [porId, setPorId] = useState<Record<string, TangoComprobantesDoc | null>>({})
  const claves = useMemo(() => {
    const ids = tangoIdsDe(cliente)
    const out: { empresa: EmpresaTango; codigo: string }[] = []
    for (const empresa of Object.keys(ids) as EmpresaTango[]) for (const x of ids[empresa] ?? []) out.push({ empresa, codigo: x.codigo })
    return out
  }, [cliente])
  const clavesJson = JSON.stringify(claves)

  useEffect(() => {
    setPorId({})
    const lista = JSON.parse(clavesJson) as { empresa: EmpresaTango; codigo: string }[]
    const unsubs = lista.map(({ empresa, codigo }) =>
      subscribeTangoComprobantes(empresa, codigo, (d) => setPorId((prev) => ({ ...prev, [`${empresa}_${codigo}`]: d }))))
    return () => unsubs.forEach((u) => u())
  }, [clavesJson])

  const indices = useMemo(() => Object.values(porId).filter((d): d is TangoComprobantesDoc => !!d), [porId])
  const cargando = claves.length > 0 && Object.keys(porId).length < claves.length
  return { indices, cargando }
}
