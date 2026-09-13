import { ReactNode } from 'react'
import { GoogleMap } from '@react-google-maps/api'
import { MapPinOff } from 'lucide-react'
import { useGoogleMapsLoader } from '@/hooks/useGoogleMapsLoader'
import { CENTRO_BA, CONTENEDOR, ModoMapa, opcionesMapa } from './config'

/**
 * Contenedor de mapa con los tres estados resueltos igual en toda la app
 * (fase 3.3, 2026-09-12): mientras carga la API muestra un esqueleto del
 * color del mapa que viene, si la API no carga lo dice en vez de quedarse en
 * blanco, y si no hay nada para mostrar centra en Buenos Aires.
 *
 * Antes cada pantalla resolvía la espera a su manera: un pulso gris, un pulso
 * crema, el spinner de pantalla completa o nada.
 *
 * Solo estandariza el marco: los marcadores, las rutas y los popups siguen
 * siendo de cada pantalla, que los pasa como hijos.
 */

type PropsGoogleMap = React.ComponentProps<typeof GoogleMap>

interface Props extends Omit<PropsGoogleMap, 'mapContainerStyle' | 'options' | 'center' | 'zoom' | 'children'> {
  modo: ModoMapa
  center?: google.maps.LatLngLiteral
  zoom?: number
  /** Pisa lo que haga falta de las opciones del modo. */
  opciones?: google.maps.MapOptions
  /**
   * Marcadores, rutas y popups. Como función cuando arman objetos de Google
   * (`pinCliente`, `new google.maps.Size`, …): React evalúa los hijos ANTES de
   * que este componente decida si la API ya cargó, así que pasarlos sueltos
   * revienta con "google is not defined" en el primer render.
   */
  children?: ReactNode | (() => ReactNode)
  /** Clase del hueco mientras carga o si falla (el alto lo pone la pantalla). */
  claseHueco?: string
}

const FONDO: Record<ModoMapa, string> = {
  oscuro: 'bg-[#0A1628]',
  claro:  'bg-[#f5f3ee]',
  sobrio: 'bg-gray-100',
  calido: 'bg-[#f5f2ec]',
}

export default function MapaBase({
  modo, center, zoom = 12, opciones, children, claseHueco = 'w-full h-full', ...props
}: Props) {
  const { isLoaded, loadError } = useGoogleMapsLoader()

  if (loadError) {
    return (
      <div className={`${claseHueco} ${FONDO[modo]} flex flex-col items-center justify-center gap-2 p-4 text-center`}>
        <MapPinOff size={22} className={modo === 'oscuro' ? 'text-white/50' : 'text-gray-400'} />
        <p className={`text-sm ${modo === 'oscuro' ? 'text-white/70' : 'text-gray-600'}`}>No pudimos cargar el mapa.</p>
        <p className={`text-xs ${modo === 'oscuro' ? 'text-white/40' : 'text-gray-400'}`}>Revisá la conexión y volvé a entrar.</p>
      </div>
    )
  }

  if (!isLoaded) return <div className={`${claseHueco} ${FONDO[modo]} animate-pulse`} aria-label="Cargando el mapa" />

  return (
    <GoogleMap
      mapContainerStyle={CONTENEDOR}
      center={center ?? CENTRO_BA}
      zoom={zoom}
      options={opcionesMapa(modo, opciones)}
      {...props}
    >
      {typeof children === 'function' ? children() : children}
    </GoogleMap>
  )
}
