// Rango [desde, hasta] (inclusive, hora local) del período seleccionado en los
// reportes calendario día/mes/año — Historial de /movimientos y de comercial.
// El fetch por rango (useOrdersRango / useVisitasPuntualesRango) trae exactamente
// estos registros, en vez del viejo stream fijo de 30 días que dejaba cualquier
// mes/año pasado vacío. El filtro client-side de las páginas (mismo período)
// queda redundante pero correcto.

export type PeriodoCalendario = 'dia' | 'mes' | 'anio'

export function rangoCalendario(
  periodo: PeriodoCalendario,
  year:    number,
  month:   number,   // 0-indexed, como Date
  day:     number,
): { desde: Date; hasta: Date } {
  if (periodo === 'dia') {
    return {
      desde: new Date(year, month, day, 0, 0, 0, 0),
      hasta: new Date(year, month, day, 23, 59, 59, 999),
    }
  }
  if (periodo === 'mes') {
    return {
      desde: new Date(year, month, 1, 0, 0, 0, 0),
      // día 0 del mes siguiente = último día del mes actual
      hasta: new Date(year, month + 1, 0, 23, 59, 59, 999),
    }
  }
  return {
    desde: new Date(year, 0, 1, 0, 0, 0, 0),
    hasta: new Date(year, 11, 31, 23, 59, 59, 999),
  }
}
