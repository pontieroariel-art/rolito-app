import { subscribeProgramas, subscribeVisitasPuntuales } from '../services/visitasService'
import { ProgramaVisita, VisitaPuntual } from '../types'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import { toDateStr } from '../utils/helpers'

export function useProgramasVisita() {
  const { data: programas, loading } = useFirestoreSubscription<ProgramaVisita[]>(subscribeProgramas, [], [])
  return { programas, loading }
}

export function useVisitasPuntuales() {
  const { data: visitas, loading } = useFirestoreSubscription<VisitaPuntual[]>(subscribeVisitasPuntuales, [], [])
  return { visitas, loading }
}

/** Devuelve programas activos cuyo día de semana coincide con `date` */
export function programasParaFecha(programas: ProgramaVisita[], date: Date): ProgramaVisita[] {
  const dow = date.getDay()
  return programas.filter((p) => p.activo && p.diasSemana.includes(dow))
}

/** Devuelve visitas puntuales para una fecha específica (comparando YYYY-MM-DD) */
export function visitasParaFecha(visitas: VisitaPuntual[], date: Date): VisitaPuntual[] {
  const dateStr = toDateStr(date)
  return visitas.filter((v) => {
    if (!v.fecha?.toDate) return false
    return toDateStr(v.fecha.toDate()) === dateStr
  })
}
