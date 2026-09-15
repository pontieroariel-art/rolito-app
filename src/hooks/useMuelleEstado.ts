import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { DARSENAS_POR_PLANTA, type MuelleEstado, type PlantaId } from '@/types'
import { onSnapshotError } from '@/services/observability'

/**
 * Estado público del muelle de una planta (`muelleEstado/{planta}`, 2026-09-15): qué
 * dársenas están ocupadas, escrito por el servidor. Devuelve además la lista de bocas
 * LIBRES en el orden físico del muelle (5 4 3 2 1, como se ven desde la tele), que es
 * lo que el chofer que volvió elige. `cargando` hasta la primera respuesta: sin dato no
 * hay que ofrecer todas las bocas como libres.
 */
export function useMuelleEstado(plantaId: PlantaId | null): { estado: MuelleEstado | null; libres: number[]; cargando: boolean; sinDato: boolean } {
  const [estado, setEstado] = useState<MuelleEstado | null>(null)
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    if (!plantaId) { setEstado(null); setCargando(false); return }
    setCargando(true)
    return onSnapshot(
      doc(db, 'muelleEstado', plantaId),
      (snap) => { setEstado(snap.exists() ? (snap.data() as MuelleEstado) : null); setCargando(false) },
      onSnapshotError(() => { setEstado(null); setCargando(false) }, 'muelleEstado'),
    )
  }, [plantaId])
  const total = plantaId ? DARSENAS_POR_PLANTA[plantaId] : 0
  // Sin doc (el server todavía no publicó nada, o falló la lectura) NO se ofrece
  // ninguna boca: la gracia es mostrar solo las libres, no adivinar.
  const sinDato = !cargando && !estado
  const ocupadas = estado?.ocupadas ?? {}
  const libres = estado ? Array.from({ length: total }, (_, i) => total - i).filter((n) => !ocupadas[String(n)]) : []
  return { estado, libres, cargando, sinDato }
}
