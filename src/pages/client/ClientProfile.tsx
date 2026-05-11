import { useState, useRef, FormEvent } from 'react'
import { GoogleMap, Marker } from '@react-google-maps/api'
import Navbar from '../../components/layout/Navbar'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useProfile } from '../../hooks/useProfile'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import { DeliveryAddress } from '../../types'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  comercial:   'Comercial',
  logistica:   'Logística',
  chofer:      'Chofer',
  cliente:     'Cliente',
}

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl:      true,
  gestureHandling:  'none',
  styles: [
    { elementType: 'geometry',           stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0A1628' }] },
    { elementType: 'labels.text.fill',   stylers: [{ color: '#74a0c8' }] },
    { featureType: 'road',         elementType: 'geometry', stylers: [{ color: '#1E3A5F' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#163868' }] },
    { featureType: 'water',        elementType: 'geometry', stylers: [{ color: '#05101e' }] },
    { featureType: 'poi',          elementType: 'geometry', stylers: [{ color: '#0e1f38' }] },
  ],
}

// ── ClientProfile ─────────────────────────────────────────────────────────────

export default function ClientProfile() {
  const { user, saving, error, saveProfile, saveAddresses } = useProfile()
  const { isLoaded } = useGoogleMapsLoader()

  const [profileForm, setProfileForm] = useState({
    razonSocial:    user?.razonSocial    ?? '',
    nombreContacto: user?.nombreContacto ?? '',
    telefono:       user?.telefono       ?? '',
    cuit:           user?.cuit           ?? '',
  })
  const [profileSaved, setProfileSaved] = useState(false)

  const [addresses,    setAddresses]    = useState<DeliveryAddress[]>(user?.addresses ?? [])
  const [showAddForm,  setShowAddForm]  = useState(false)
  const [addressSaved, setAddressSaved] = useState(false)

  const handleProfileSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await saveProfile(profileForm)
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 3000)
  }

  const handleAddAddress = async (addr: DeliveryAddress) => {
    const updated = addr.esPrincipal
      ? [...addresses.map((a) => ({ ...a, esPrincipal: false })), addr]
      : [...addresses, addr]
    setAddresses(updated)
    await saveAddresses(updated)
    setShowAddForm(false)
    setAddressSaved(true)
    setTimeout(() => setAddressSaved(false), 3000)
  }

  const handleDeleteAddress = async (id: string) => {
    const updated = addresses.filter((a) => a.id !== id)
    setAddresses(updated)
    await saveAddresses(updated)
  }

  const handleSetPrincipal = async (id: string) => {
    const updated = addresses.map((a) => ({ ...a, esPrincipal: a.id === id }))
    setAddresses(updated)
    await saveAddresses(updated)
  }

  if (!user) return <LoadingSpinner fullScreen />

  return (
    <>
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-8 pb-10">
        <div>
          <h1 className="text-2xl font-bold">Mi perfil</h1>
          <p className="text-muted text-sm mt-1">{user.email}</p>
        </div>

        {/* ── Datos del cliente ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Datos del cliente</h2>
          <form
            onSubmit={handleProfileSubmit}
            className="bg-surface border border-border rounded-2xl p-5 space-y-4"
          >
            <Input
              label="Razón social"
              value={profileForm.razonSocial}
              onChange={(e) => setProfileForm((f) => ({ ...f, razonSocial: e.target.value }))}
              placeholder="Empresa S.A."
            />
            <Input
              label="Nombre de contacto"
              value={profileForm.nombreContacto}
              onChange={(e) => setProfileForm((f) => ({ ...f, nombreContacto: e.target.value }))}
              placeholder="Juan García"
            />
            <Input
              label="Teléfono WhatsApp"
              type="tel"
              value={profileForm.telefono}
              onChange={(e) => setProfileForm((f) => ({ ...f, telefono: e.target.value }))}
              placeholder="+54 11 1234-5678"
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-300">Email</label>
              <input
                type="email"
                value={user.email}
                readOnly
                className="bg-surface border border-border rounded-lg px-3 py-2 text-muted w-full cursor-not-allowed"
              />
            </div>
            <Input
              label="CUIT"
              value={profileForm.cuit}
              onChange={(e) => setProfileForm((f) => ({ ...f, cuit: e.target.value }))}
              placeholder="20-12345678-9"
            />

            {error && <ErrorBox message={error} />}
            {profileSaved && <SuccessBox message="Perfil guardado correctamente" />}

            <Button type="submit" loading={saving} className="w-full">
              Guardar cambios
            </Button>
          </form>
        </section>

        {/* ── Direcciones de entrega ──────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Direcciones de entrega</h2>
            {!showAddForm && (
              <button
                onClick={() => setShowAddForm(true)}
                className="text-sm text-accent hover:underline"
              >
                + Agregar
              </button>
            )}
          </div>

          {addresses.length === 0 && !showAddForm && (
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-muted text-sm">No tenés direcciones guardadas</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="text-accent text-sm mt-2 hover:underline block mx-auto"
              >
                Agregar primera dirección →
              </button>
            </div>
          )}

          <div className="space-y-3">
            {addresses.map((addr) => (
              <AddressCard
                key={addr.id}
                addr={addr}
                onDelete={() => handleDeleteAddress(addr.id)}
                onSetPrincipal={() => handleSetPrincipal(addr.id)}
                disabled={saving}
              />
            ))}
          </div>

          {addressSaved && <SuccessBox message="Dirección guardada correctamente" />}

          {showAddForm && (
            <AddressForm
              isLoaded={isLoaded}
              hasPrincipal={addresses.some((a) => a.esPrincipal)}
              saving={saving}
              onSave={handleAddAddress}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </section>

        {/* ── Info de cuenta ──────────────────────────────────────────────── */}
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

// ── AddressCard ───────────────────────────────────────────────────────────────

function AddressCard({
  addr,
  onDelete,
  onSetPrincipal,
  disabled,
}: {
  addr: DeliveryAddress
  onDelete: () => void
  onSetPrincipal: () => void
  disabled: boolean
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{addr.nombre}</p>
            {addr.esPrincipal && (
              <span className="text-xs bg-accent/10 text-accent border border-accent/20 rounded-full px-2 py-0.5">
                Principal
              </span>
            )}
          </div>
          <p className="text-muted text-sm mt-0.5 truncate">{addr.address}</p>
        </div>
        <button
          onClick={onDelete}
          disabled={disabled}
          className="text-red-400 hover:text-red-300 text-sm shrink-0 disabled:opacity-50"
        >
          Eliminar
        </button>
      </div>

      {(addr.horarioApertura || addr.horarioCierre) && (
        <p className="text-muted text-xs">
          Horario: {addr.horarioApertura || '—'} – {addr.horarioCierre || '—'}
        </p>
      )}
      {addr.contactoNombre && (
        <p className="text-muted text-xs">
          Contacto: {addr.contactoNombre}
          {addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
        </p>
      )}

      {!addr.esPrincipal && (
        <button
          onClick={onSetPrincipal}
          disabled={disabled}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          Establecer como principal
        </button>
      )}
    </div>
  )
}

// ── AddressForm ───────────────────────────────────────────────────────────────

type AddrFormState = {
  nombre: string
  address: string
  lat: number | null
  lng: number | null
  horarioApertura: string
  horarioCierre: string
  contactoNombre: string
  contactoTelefono: string
  esPrincipal: boolean
}

function AddressForm({
  isLoaded,
  hasPrincipal,
  saving,
  onSave,
  onCancel,
}: {
  isLoaded: boolean
  hasPrincipal: boolean
  saving: boolean
  onSave: (addr: DeliveryAddress) => void
  onCancel: () => void
}) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const [addrError, setAddrError] = useState('')
  const [form, setForm] = useState<AddrFormState>({
    nombre:          '',
    address:         '',
    lat:             null,
    lng:             null,
    horarioApertura: '',
    horarioCierre:   '',
    contactoNombre:  '',
    contactoTelefono:'',
    esPrincipal:     !hasPrincipal,
  })

  // Mount PlaceAutocompleteElement (Places API New) once Maps is loaded
  useEffect(() => {
    if (!isLoaded || !containerRef.current) return

    const el = new google.maps.places.PlaceAutocompleteElement({
      includedRegionCodes: ['ar'],
    })

    const onSelect = async (e: google.maps.places.PlacePredictionSelectEvent) => {
      setAddrError('')
      const place = e.placePrediction.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location'] })
      setForm((f) => ({
        ...f,
        address: place.formattedAddress ?? '',
        lat:     place.location?.lat()   ?? null,
        lng:     place.location?.lng()   ?? null,
      }))
    }

    el.addEventListener('gmp-select', onSelect)
    containerRef.current.replaceChildren(el)

    return () => {
      el.removeEventListener('gmp-select', onSelect)
      containerRef.current?.replaceChildren()
    }
  }, [isLoaded])

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.lat || !form.lng) {
      setAddrError('Seleccioná una dirección del listado de sugerencias.')
      return
    }
    onSave({ id: crypto.randomUUID(), ...form })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface border border-accent/20 rounded-2xl p-5 space-y-4 mt-3"
    >
      <h3 className="font-semibold text-accent">Nueva dirección</h3>

      <Input
        label="Nombre de la sucursal"
        value={form.nombre}
        onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
        placeholder="Ej: Sede central, Depósito norte..."
        required
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-300">Dirección</label>
        {/* PlaceAutocompleteElement mounts here — renders its own <input> */}
        <div ref={containerRef} className="w-full" />
        {!isLoaded && (
          <input
            type="text"
            disabled
            placeholder="Cargando mapa..."
            className="bg-bg border border-border rounded-lg px-3 py-2 text-muted w-full opacity-50"
          />
        )}
        {addrError && (
          <p className="text-red-400 text-xs mt-1">{addrError}</p>
        )}

        {form.lat && form.lng && isLoaded && (
          <div
            className="mt-2 rounded-xl overflow-hidden border border-border"
            style={{ height: '140px' }}
          >
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={{ lat: form.lat, lng: form.lng }}
              zoom={15}
              options={MAP_OPTIONS}
            >
              <Marker position={{ lat: form.lat, lng: form.lng }} />
            </GoogleMap>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Apertura</label>
          <input
            type="time"
            value={form.horarioApertura}
            onChange={(e) => setForm((f) => ({ ...f, horarioApertura: e.target.value }))}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Cierre</label>
          <input
            type="time"
            value={form.horarioCierre}
            onChange={(e) => setForm((f) => ({ ...f, horarioCierre: e.target.value }))}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      <Input
        label="Nombre del contacto"
        value={form.contactoNombre}
        onChange={(e) => setForm((f) => ({ ...f, contactoNombre: e.target.value }))}
        placeholder="Juan García"
      />
      <Input
        label="Teléfono del contacto"
        type="tel"
        value={form.contactoTelefono}
        onChange={(e) => setForm((f) => ({ ...f, contactoTelefono: e.target.value }))}
        placeholder="+54 11 1234-5678"
      />

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.esPrincipal}
          onChange={(e) => setForm((f) => ({ ...f, esPrincipal: e.target.checked }))}
          className="w-4 h-4 accent-accent"
        />
        <span className="text-sm text-gray-300">Dirección principal</span>
      </label>

      <div className="flex gap-3 pt-1">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" loading={saving} className="flex-1">
          Guardar dirección
        </Button>
      </div>
    </form>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
      <p className="text-red-400 text-sm">{message}</p>
    </div>
  )
}

function SuccessBox({ message }: { message: string }) {
  return (
    <div className="bg-success/10 border border-success/30 rounded-lg px-3 py-2">
      <p className="text-success text-sm">✓ {message}</p>
    </div>
  )
}
