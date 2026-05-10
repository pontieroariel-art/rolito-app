import { useState, useRef } from 'react'
import Navbar from '../../components/layout/Navbar'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useProfile } from '../../hooks/useProfile'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { StandaloneSearchBox } from '@react-google-maps/api'

export default function ClientProfile() {
  const { user, saving, error, saveProfile } = useProfile()
  const { isLoaded }  = useGoogleMapsLoader()
  const searchBoxRef  = useRef(null)
  const [saved, setSaved] = useState(false)

  const [form, setForm] = useState({
    name:    user?.name    ?? '',
    phone:   user?.phone   ?? '',
    address: user?.address ?? '',
  })

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const handlePlacesChanged = () => {
    const places = searchBoxRef.current?.getPlaces()
    if (places?.[0]?.formatted_address) {
      setForm((f) => ({ ...f, address: places[0].formatted_address }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    await saveProfile(form)
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
            name="name"
            value={form.name}
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

          {/* Dirección con Google Maps Autocomplete */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">
              Dirección de entrega
            </label>
            {isLoaded ? (
              <StandaloneSearchBox
                onLoad={(ref) => (searchBoxRef.current = ref)}
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
            {form.address && (
              <p className="text-xs text-muted mt-1">📍 {form.address}</p>
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

        {/* Info del rol */}
        <div className="bg-surface border border-border rounded-xl p-4 text-sm">
          <p className="text-muted">Rol: <span className="text-white capitalize">{user.role}</span></p>
          <p className="text-muted mt-1">Cuenta creada: {user.createdAt?.toDate?.().toLocaleDateString('es-AR') ?? '—'}</p>
        </div>
      </main>
    </>
  )
}
