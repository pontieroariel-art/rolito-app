// Matemática de ruteo compartida entre el tablero de despacho diario
// (despachoService.optimizeStopOrder) y la planificación semanal
// (MapaPlanificacion) — antes estaba duplicada de forma independiente en los
// dos módulos, con el riesgo de que diverjan silenciosamente.

export interface LatLng { lat: number; lng: number }

export function haversineKm(a: LatLng, b: LatLng): number {
  const R    = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Ordena las paradas por "vecino más cercano" desde el origen. Es una
// heurística de distancia en línea recta, no una optimización real de
// horarios/tráfico — el trazado y la duración reales se resuelven después
// con ORS Directions (o el fallback a Google Maps).
export function nearestNeighborOrder<T extends LatLng>(start: LatLng, stops: T[]): T[] {
  const remaining = [...stops]
  const ordered: T[] = []
  let current = start
  while (remaining.length > 0) {
    let bestIdx  = 0
    let bestDist = Infinity
    remaining.forEach((s, i) => {
      const d = haversineKm(current, s)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    })
    const [next] = remaining.splice(bestIdx, 1)
    ordered.push(next)
    current = next
  }
  return ordered
}

export function timeStrToUnix(dateStr: string, time: string): number {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return 0
  return Math.floor(new Date(`${dateStr}T${time.padStart(5, '0')}:00`).getTime() / 1000)
}

export function unixToTimeStr(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
}
