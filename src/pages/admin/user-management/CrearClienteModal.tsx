import { useState, FormEvent } from 'react'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Modal from '../../../components/ui/Modal'
import { AddressAutocomplete, AddressMapPicker } from '../../../components/ui/AddressPickerField'
import { useGoogleMapsLoader } from '../../../hooks/useGoogleMapsLoader'
import { useAuth } from '../../../context/AuthContext'
import { createClientUser } from '../../../services/userService'

export function CrearClienteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user: currentUser } = useAuth()
  const { isLoaded } = useGoogleMapsLoader()

  const [razonSocial,    setRazonSocial]    = useState('')
  const [nombreContacto, setNombreContacto] = useState('')
  const [cuit,           setCuit]           = useState('')
  const [email,          setEmail]          = useState('')
  const [telefono,       setTelefono]       = useState('')
  const [password,       setPassword]       = useState('')
  const [showPass,       setShowPass]       = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState('')

  // Dirección de entrega — obligatoria: sin esto el cliente no tiene dónde
  // recibir un pedido ni aparece en el mapa.
  const [addr, setAddr] = useState({
    nombre: '', address: '', lat: null as number | null, lng: null as number | null,
    horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '',
  })
  const [addrError, setAddrError] = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const cuitDigits = cuit.replace(/\D/g, '')
    if (cuitDigits.length !== 11) { setError('El CUIT debe tener 11 dígitos'); return }
    if (password.length < 6)      { setError('La contraseña debe tener al menos 6 caracteres'); return }
    if (!addr.lat || !addr.lng)   { setAddrError('Seleccioná la dirección y confirmá la ubicación en el mapa.'); return }
    if (!currentUser)             { setError('Sesión inválida, volvé a iniciar sesión.'); return }
    setLoading(true)
    setError('')
    const emailFinal = email.trim() || `${cuitDigits}@rolito.app`
    try {
      await createClientUser({
        email: emailFinal, password, razonSocial, nombreContacto: nombreContacto || undefined, cuit, telefono,
        addresses: [{
          id: crypto.randomUUID(),
          nombre: addr.nombre || 'Principal',
          address: addr.address, lat: addr.lat, lng: addr.lng,
          horarioApertura: addr.horarioApertura, horarioCierre: addr.horarioCierre,
          contactoNombre: addr.contactoNombre, contactoTelefono: addr.contactoTelefono,
          // "Principal" queda como elección explícita, no se auto-marca al
          // crear (grupos empresarios con sucursales equivalentes).
          esPrincipal: false,
        }],
        creadoPor: { uid: currentUser.uid, nombre: currentUser.nombreContacto || currentUser.nombre, rol: currentUser.rol },
      })
      onCreated()
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('Ya existe una cuenta con ese email')
      } else {
        setError(err?.message ?? 'Error al crear el cliente. Intentá de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Crear cliente">
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <Input
          label="Razón social"
          value={razonSocial}
          onChange={(e) => setRazonSocial(e.target.value)}
          required
          placeholder="Mi Empresa S.A."
        />
        <Input
          label="Nombre de contacto (opcional)"
          value={nombreContacto}
          onChange={(e) => setNombreContacto(e.target.value)}
          placeholder="Juan García"
        />
        <Input
          label="CUIT"
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
          required
          placeholder="20123456789"
        />
        <Input
          label="Email (opcional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="cliente@empresa.com"
        />
        <Input
          label="Teléfono (opcional)"
          type="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+54 11 1234-5678"
        />
        <Input
          label="Contraseña temporal"
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Mínimo 6 caracteres"
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass((v) => !v)}
              className="text-lg leading-none text-gray-500 hover:text-gray-700"
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          }
        />

        {/* Dirección de entrega */}
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-gray-700">Dirección de entrega</p>
          <Input
            label="Nombre de la sucursal (opcional)"
            value={addr.nombre}
            onChange={(e) => setAddr((f) => ({ ...f, nombre: e.target.value }))}
            placeholder="Depósito, Sede central..."
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500">Dirección</label>
            <AddressAutocomplete
              onSelect={(address, lat, lng) => { setAddrError(''); setAddr((f) => ({ ...f, address, lat, lng })) }}
            />
            {addrError && <p className="text-red-500 text-xs">{addrError}</p>}
            {isLoaded && addr.lat && addr.lng && (
              <div className="mt-1 space-y-1">
                <AddressMapPicker
                  lat={addr.lat} lng={addr.lng} height={220}
                  onLocationChange={(address, lat, lng) => setAddr((f) => ({ ...f, address, lat, lng }))}
                />
                <p className="text-xs text-success">✓ {addr.address}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['horarioApertura', 'horarioCierre'] as const).map((field, i) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">{i === 0 ? 'Apertura' : 'Cierre'}</label>
                <input
                  type="time"
                  value={addr[field]}
                  onChange={(e) => setAddr((f) => ({ ...f, [field]: e.target.value }))}
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Contacto en el lugar (opcional)"
              value={addr.contactoNombre}
              onChange={(e) => setAddr((f) => ({ ...f, contactoNombre: e.target.value }))}
              placeholder="Juan García"
            />
            <Input
              label="Teléfono (opcional)"
              value={addr.contactoTelefono}
              onChange={(e) => setAddr((f) => ({ ...f, contactoTelefono: e.target.value }))}
              placeholder="+54 11..."
            />
          </div>
        </div>

        <p className="text-xs text-gray-500">
          La cuenta queda activa de inmediato. El cliente puede ingresar con su CUIT y contraseña.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={loading} className="flex-1">Crear cliente</Button>
        </div>
      </form>
    </Modal>
  )
}
