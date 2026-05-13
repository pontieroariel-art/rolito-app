import { useState, useEffect } from 'react'
import { subscribeProgramas, subscribeVisitasPuntuales } from '../services/visitasService'
import { ProgramaVisita, VisitaPuntual } from '../types'

export function useProgramasVisita() {
  const [programas, setProgramas] = useState<ProgramaVisita[]>([])
  const [loading,   setLoading]   = useState(true)
  useEffect(() => {
    const unsub = subscribeProgramas((data) => { setProgramas(data); setLoading(false) })
    return unsub
  }, [])
  return { programas, loading }
}

export function useVisitasPuntuales() {
  const [visitas, setVisitas] = useState<VisitaPuntual[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const unsub = subscribeVisitasPuntuales((data) => { setVisitas(data); setLoading(false) })
    return unsub
  }, [])
  return { visitas, loading }
}

/** Devuelve programas activos cuyo día de semana coincide con `date` */
export function programasParaFecha(programas: ProgramaVisita[], date: Date): ProgramaVisita[] {
  const dow = date.getDay()
  return programas.filter((p) => p.activo && p.diasSemana.includes(dow))
}

/** Devuelve visitas puntuales para una fecha específica (comparando YYYY-MM-DD) */
export function visitasParaFecha(visitas: VisitaPuntual[], date: Date): VisitaPuntual[] {
  const dateStr = date.toISOString().split('T')[0]
  return visitas.filter((v) => {
    if (!v.fecha?.toDate) return false
    return v.fecha.toDate().toISOString().split('T')[0] === dateStr
  })
}
