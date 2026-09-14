import { PlantaId } from '../types'

// Marca este dispositivo como "tablet de planta X" en localStorage (no
// sessionStorage: tiene que sobrevivir a cerrar y reabrir la app instalada,
// no solo a la pestaña). Landing.tsx la usa para mandar "/" derecho a
// produccion-{planta} en vez del landing genérico — así el logout nunca
// muestra Clientes/Choferes/Equipo Rolito. Ver Navbar.tsx para el porqué no
// se resuelve con un navigate() en el logout (pierde la carrera contra el
// redirect de ProtectedRoute).
//
// Vive aparte de produccionAuthService (2026-09-14) para que Landing, que se
// carga al arranque, no arrastre el servicio entero (login por legajo, reset
// de PIN por callable) al chunk inicial: acá solo hay localStorage.
const DISPOSITIVO_PRODUCCION_KEY = 'produccionPlantaDevice'

export function marcarDispositivoProduccion(planta: PlantaId): void {
  try { localStorage.setItem(DISPOSITIVO_PRODUCCION_KEY, planta) } catch { /* localStorage puede fallar en privado/incognito, no es crítico */ }
}

export function getDispositivoProduccion(): PlantaId | null {
  try {
    const v = localStorage.getItem(DISPOSITIVO_PRODUCCION_KEY)
    return v === 'torcuato' || v === 'merlo' ? v : null
  } catch {
    return null
  }
}
