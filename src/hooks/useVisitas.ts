import { useQuery } from '@tanstack/react-query'
import { subscribeProgramas, subscribeVisitasPuntuales, getVisitasPuntualesInRange } from '../services/visitasService'
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

// Versión por rango del hook de arriba, para el Historial (/movimientos): trae
// las visitas con `fecha` en [desde, hasta] con una query puntual, en vez del
// stream fijo de 30 días. Pasá Dates ESTABLES (useMemo) para no re-fetchear.
export function useVisitasPuntualesRango(desde: Date, hasta: Date): { visitas: VisitaPuntual[]; loading: boolean } {
  const { data: visitas = [], isLoading } = useQuery({
    queryKey:  ['visitasPuntualesRango', desde.getTime(), hasta.getTime()],
    queryFn:   () => getVisitasPuntualesInRange(desde, hasta),
    staleTime: 60_000,
  })
  return { visitas, loading: isLoading }
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
