import { useJsApiLoader } from '@react-google-maps/api'

type Library = 'drawing' | 'geometry' | 'localContext' | 'places' | 'visualization'

// Debe estar fuera del componente para que la referencia sea estable
const LIBRARIES: Library[] = ['places']

export function useGoogleMapsLoader() {
  return useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY,
    libraries:        LIBRARIES,
    language:         'es',
    region:           'AR',
  })
}
