// Configuración única de los mapas (fase 3.3 del reordenamiento, 2026-09-12).
//
// Todos los mapas de la app son Google Maps con `@react-google-maps/api` y el
// mismo loader (`hooks/useGoogleMapsLoader`): no hay tiles ni proveedores que
// unificar. Lo que sí estaba repetido y ya había derivado:
//   · el centro de Buenos Aires, en ocho lugares y con cuatro nombres
//   · el tamaño del contenedor, en nueve
//   · la paleta oscura, en cuatro copias con colores distintos entre sí
//   · la paleta clara, en tres variantes
// Acá viven una sola vez. Las paletas son cuatro a propósito, porque los
// mapas tienen usos distintos (ver `ModoMapa`).

/** Obelisco. Centro por defecto cuando todavía no hay nada que mostrar. */
export const CENTRO_BA = { lat: -34.6037, lng: -58.3816 } as const

/** El mapa ocupa todo su contenedor: el alto lo pone la pantalla. */
export const CONTENEDOR: React.CSSProperties = { width: '100%', height: '100%' }

/** Oscuro: tableros de seguimiento en vivo (flota, monitoreo, tablero comercial). */
export const ESTILOS_OSCUROS: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
  { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
  { featureType: 'poi',          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',      stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
]

/** Claro: mapas de clientes, con los colores cálidos de la app. */
export const ESTILOS_CLAROS: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',         stylers: [{ color: '#f5f3ee' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#c9e4f5' }] },
  { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e4dc' }] },
  { featureType: 'poi',          stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',      stylers: [{ visibility: 'off' }] },
]

/** Sobrio: mapa de Google tal cual, sin puntos de interés ni transporte, para no tapar los pines. */
export const ESTILOS_SOBRIOS: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',            stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',        stylers: [{ visibility: 'off' }] },
  { featureType: 'road',           elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]

/** Cálido: la ruta del chofer en el celular, con las rutas resaltadas y mucho contraste al sol. */
export const ESTILOS_CALIDOS: google.maps.MapTypeStyle[] = [
  { featureType: 'poi',     stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway',  elementType: 'geometry',        stylers: [{ color: '#f5e9c8' }] },
  { featureType: 'road.highway',  elementType: 'geometry.stroke', stylers: [{ color: '#e0c97a' }] },
  { featureType: 'road.arterial', elementType: 'geometry',        stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local',    elementType: 'geometry',        stylers: [{ color: '#f9f6f0' }] },
  { featureType: 'landscape',     elementType: 'geometry',        stylers: [{ color: '#f5f2ec' }] },
  { featureType: 'water',         elementType: 'geometry',        stylers: [{ color: '#c9e4f0' }] },
  { featureType: 'poi.park',      elementType: 'geometry',        stylers: [{ color: '#d8ead2' }] },
]

export type ModoMapa = 'oscuro' | 'claro' | 'sobrio' | 'calido'

const PALETAS: Record<ModoMapa, google.maps.MapTypeStyle[]> = {
  oscuro: ESTILOS_OSCUROS,
  claro:  ESTILOS_CLAROS,
  sobrio: ESTILOS_SOBRIOS,
  calido: ESTILOS_CALIDOS,
}

/**
 * Opciones de un mapa. Por defecto: sin la interfaz de Google salvo el zoom,
 * y `greedy` (un dedo arrastra el mapa, que es lo que espera quien lo usa en
 * la tablet o el celular). `extra` pisa lo que haga falta.
 */
export function opcionesMapa(modo: ModoMapa, extra: google.maps.MapOptions = {}): google.maps.MapOptions {
  return {
    styles:            PALETAS[modo],
    disableDefaultUI:  true,
    zoomControl:       true,
    streetViewControl: false,
    mapTypeControl:    false,
    fullscreenControl: false,
    gestureHandling:   'greedy',
    ...extra,
  }
}
