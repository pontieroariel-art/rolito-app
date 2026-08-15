import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { PasoTaller, TipoPipelineHeladera } from '../types'

const pasosTallerRef = () => doc(db, 'config', 'pasosTaller')

export const getPasosTaller = async (): Promise<Record<string, PasoTaller>> => {
  try {
    const snap = await getDoc(pasosTallerRef())
    if (snap.exists()) return (snap.data().pasos as Record<string, PasoTaller>) ?? {}
    await setDoc(pasosTallerRef(), { pasos: {} })
    return {}
  } catch {
    return {}
  }
}

// Recalcula siguientePasoId para todos los pasos de cada tipoPipeline
// (activos, ordenados por `orden`) y persiste el mapa completo. Se llama
// después de cualquier alta/edición/reordenamiento/activar-desactivar, así
// las Firestore rules siempre pueden confiar en el link sin tener que
// ordenar ni buscar dentro de una lista.
export const savePasosTaller = (pasos: Record<string, PasoTaller>): Promise<void> =>
  setDoc(pasosTallerRef(), { pasos: relinkearSiguientes(pasos) })

function relinkearSiguientes(pasos: Record<string, PasoTaller>): Record<string, PasoTaller> {
  const resultado = { ...pasos }
  const tipos: TipoPipelineHeladera[] = ['fabricacion', 'reacondicionamiento']
  for (const tipo of tipos) {
    const delTipo = Object.values(pasos).filter((p) => p.tipoPipeline === tipo)
    const activos = delTipo.filter((p) => p.activo).sort((a, b) => a.orden - b.orden)
    activos.forEach((p, i) => {
      resultado[p.id] = { ...p, siguientePasoId: activos[i + 1]?.id ?? null }
    })
    // Inactivos: sin link válido (no se usan mientras estén desactivados).
    delTipo.filter((p) => !p.activo).forEach((p) => {
      resultado[p.id] = { ...p, siguientePasoId: null }
    })
  }
  return resultado
}
