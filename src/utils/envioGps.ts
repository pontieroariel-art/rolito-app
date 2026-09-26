// Filtro del envío de GPS del chofer (2026-09-26, auditoría del chofer, R5).
// El teléfono lee la posición cada 10 s, pero parado en un cliente escribía
// igual la misma coordenada: seis escrituras por minuto por chofer que no le
// cambian nada a nadie. Se manda si se movió 40 m o más, o si pasó un minuto
// desde el último envío (así el mapa en vivo, que marca "sin señal" recién a
// los 20 min, sigue viendo al chofer al día). Mismo criterio que el espejo del
// servidor (`valeLaPenaEspejar` en functions/src/triggers/location.ts).

export const METROS_MINIMOS_GPS = 40
export const MS_MAXIMOS_GPS = 60_000

export interface EnvioGps { lat: number; lng: number; en: number }

export function hayQueEnviarGps(ultimo: EnvioGps | null, lat: number, lng: number, ahora: number): boolean {
  if (!ultimo) return true
  if (ahora - ultimo.en >= MS_MAXIMOS_GPS) return true
  return distanciaMetros(ultimo.lat, ultimo.lng, lat, lng) >= METROS_MINIMOS_GPS
}

function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}
