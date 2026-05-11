import { useJsApiLoader } from '@react-google-maps/api'

import type { Libraries } from '@react-google-maps/api'

// Debe estar fuera del componente para que la referencia sea estable
const LIBRARIES: Libraries = ['places']

export function useGoogleMapsLoader() {
  return useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY,
    libraries:        LIBRARIES,
    language:         'es',
    region:           'AR',
  })
}
