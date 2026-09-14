import { useQuery } from '@tanstack/react-query'
import {
  subscribeProgramas, subscribeVisitasPuntuales, getVisitasPuntualesInRange,
  subscribeProgramasDeChofer, subscribeVisitasPuntualesDeChofer,
} from '../services/visitasService'
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

// ── Versiones acotadas para el home del chofer (2026-09-14) ──────────────────
// Bajan solo lo del chofer (`driverId` = email) más lo sin chofer, en vez de
// la colección entera; el home sigue filtrando en memoria como red de
// seguridad. Sin email (ayudante esperando su despacho) devuelven vacío.

const SIN_DATOS: never[] = []

export function useProgramasVisitaDeChofer(driverEmail: string | null | undefined) {
  const { data: programas, loading } = useFirestoreSubscription<ProgramaVisita[]>(
    (cb, onError) => {
      if (!driverEmail) { cb(SIN_DATOS); return () => {} }
      return subscribeProgramasDeChofer(driverEmail, cb, onError)
    },
    [driverEmail],
    SIN_DATOS,
  )
  return { programas, loading }
}

/**
 * Visitas puntuales del chofer desde el día `desde` (00:00 local) y por `dias`
 * días. Pasá un Date estable (useFechaDelDia) para no resuscribir en cada render.
 */
export function useVisitasPuntualesDeChofer(driverEmail: string | null | undefined, desde: Date, dias = 7) {
  const claveDesde = toDateStr(desde)
  const { data: visitas, loading } = useFirestoreSubscription<VisitaPuntual[]>(
    (cb, onError) => {
      if (!driverEmail) { cb(SIN_DATOS); return () => {} }
      const inicio = new Date(`${claveDesde}T00:00:00`)
      const fin = new Date(inicio); fin.setDate(fin.getDate() + dias)
      return subscribeVisitasPuntualesDeChofer(driverEmail, inicio, fin, cb, onError)
    },
    [driverEmail, claveDesde, dias],
    SIN_DATOS,
  )
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
