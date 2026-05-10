import { useJsApiLoader } from '@react-google-maps/api'

// IMPORTANTE: debe estar fuera del componente para que la referencia sea estable
// Si se define dentro, @react-google-maps/api recarga el script en cada render
const LIBRARIES = ['places']

export function useGoogleMapsLoader() {
  return useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY,
    libraries: LIBRARIES,
    language: 'es',
    region: 'AR',
  })
}
