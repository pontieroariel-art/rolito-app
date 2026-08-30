import { useEffect, useMemo, useState } from 'react'
import { toDateStr } from '../utils/helpers'

// Clave del día actual (fecha local, YYYY-MM-DD). Cuando la pantalla cruza la
// medianoche el estado cambia y quien lo use vuelve a calcular su rango — así
// una tablet o un TV dejados abiertos toda la noche no siguen clavados en el
// día anterior. (Antes esta lógica vivía duplicada dentro de useProduccionResumen;
// ahora la comparten todas las pantallas de expedición/producción.)
export function useDiaActual(): string {
  const [dia, setDia] = useState(() => toDateStr(new Date()))
  useEffect(() => {
    const proximaMedianoche = new Date()
    proximaMedianoche.setHours(24, 0, 0, 0)
    const id = setTimeout(
      () => setDia(toDateStr(new Date())),
      proximaMedianoche.getTime() - Date.now() + 1000,
    )
    return () => clearTimeout(id)
  }, [dia])
  return dia
}

// Igual que useDiaActual pero como Date estable (mediodía local del día), listo
// para pasar a los subscribe *DelDia sin que se congele al montar. El mediodía
// evita que un corrimiento de zona horaria caiga en el día equivocado cuando el
// rango se trunca a las 00:00.
export function useFechaDelDia(): Date {
  const dia = useDiaActual()
  return useMemo(() => new Date(`${dia}T12:00:00`), [dia])
}
