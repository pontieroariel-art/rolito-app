import { Outlet } from 'react-router-dom'
import { GpsChoferProvider } from '@/hooks/useGpsChofer'

// Contenedor de las rutas /chofer/* (2026-09-26, auditoría del chofer, A6): lo
// que tiene que seguir vivo mientras el chofer va de una pantalla a otra, como el
// GPS, se monta acá una sola vez en vez de en cada pantalla.
export default function ChoferShell() {
  return (
    <GpsChoferProvider>
      <Outlet />
    </GpsChoferProvider>
  )
}
