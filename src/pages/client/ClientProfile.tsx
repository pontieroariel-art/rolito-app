import { useState, useRef, ChangeEvent, FormEvent } from 'react'
import { GoogleMap, Marker, StandaloneSearchBox } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useProfile } from '../../hooks/useProfile'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  comercial:   'Comercial',
  logistica:   'Logística',
  chofer:      'Chofer',
  cliente:     'Cliente',
}

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI:  true,
  zoomControl:       true,
  gestureHandling:   'none',
  styles: [
    { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
    { featureType: 'road',               elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
    { featureType: 'road.highway',       elementType: 'geometry', stylers: [{ color: '#163868' }] },
    { featureType: 'water',              elementType: 'geometry', stylers: [{ color: '#05101e' }] },
    { featureType: 'poi',                elementType: 'geometry', stylers: [{ color: '#0e1f38' }] },
  ],
}

const MAP_CONTAINER: React.CSSProperties = { width: '100%', height: '100%' }

type Coords = { lat: number; lng: number }

export default function ClientProfile() {
  const { user, saving, error, saveProfile } = useProfile()
  const { isLoaded }  = useGoogleMapsLoader()
  const searchBoxRef  = useRef<google.maps.places.SearchBox | null>(null)
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    nombre:  user?.nombre  ?? '',
    phone:   user?.phone   ?? '',
    address: user?.address ?? '',
  })

  const [coords, setCoords] = useState<Coords | null>(
    user?.lat && user?.lng ? { lat: user.lat, lng: user.lng } : null,
  )

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
    // Al editar manualmente el campo de dirección, limpiar el mapa
    if (e.target.name === 'address') setCoords(null)
  }

  const handlePlacesChanged = () => {
    const places = searchBoxRef.current?.getPlaces()
    if (!places?.[0]) return
    const place = places[0]
    const address = place.formatted_address ?? ''
    const lat = place.geometry?.location?.lat() ?? null
    const lng = place.geometry?.location?.lng() ?? null
    setForm((f) => ({ ...f, address }))
    setCoords(lat !== null && lng !== null ? { lat, lng } : null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await saveProfile({ ...form, lat: coords?.lat ?? null, lng: coords?.lng ?? null })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!user) return <LoadingSpinner fullScreen />

  return (
    <>
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Mi perfil</h1>
          <p className="text-muted text-sm mt-1">{user.email}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-2xl p-5 space-y-4">
          <Input
            label="Nombre completo"
            name="nombre"
            value={form.nombre}
            onChange={handleChange}
            placeholder="Juan García"
          />
          <Input
            label="Teléfono"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            placeholder="+54 11 1234-5678"
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">
              Dirección de entrega
            </label>
            {isLoaded ? (
              <StandaloneSearchBox
                onLoad={(ref) => { searchBoxRef.current = ref }}
                onPlacesChanged={handlePlacesChanged}
              >
                <input
                  type="text"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  placeholder="Ingresá tu dirección..."
                  className="bg-bg border border-border rounded-lg px-3 py-2 text-white placeholder-muted w-full focus:outline-none focus:ring-2 focus:ring-accent transition-colors"
                />
              </StandaloneSearchBox>
            ) : (
              <Input
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="Ingresá tu dirección..."
              />
            )}

            {coords && isLoaded && (
              <div className="mt-2 rounded-xl overflow-hidden border border-border" style={{ height: '160px' }}>
                <GoogleMap
                  mapContainerStyle={MAP_CONTAINER}
                  center={coords}
                  zoom={15}
                  options={MAP_OPTIONS}
                >
                  <Marker position={coords} />
                </GoogleMap>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {saved && (
            <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2">
              <p className="text-success text-sm">✓ Perfil guardado correctamente</p>
            </div>
          )}

          <Button type="submit" loading={saving} className="w-full">
            Guardar cambios
          </Button>
        </form>

        <div className="bg-surface border border-border rounded-xl p-4 text-sm space-y-1">
          <p className="text-muted">
            Rol: <span className="text-white">{ROLE_LABELS[user.rol] ?? user.rol}</span>
          </p>
          <p className="text-muted">
            Estado: <span className="text-white capitalize">{user.estado}</span>
          </p>
          <p className="text-muted">
            Cuenta creada:{' '}
            <span className="text-white">
              {user.fechaCreacion?.toDate?.().toLocaleDateString('es-AR') ?? '—'}
            </span>
          </p>
        </div>
      </main>
    </>
  )
}
