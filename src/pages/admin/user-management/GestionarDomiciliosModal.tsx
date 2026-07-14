import { useState, FormEvent } from 'react'
import { Plus, Trash2, Navigation } from 'lucide-react'
import { AddressAutocomplete, AddressMapPicker, AddressMapMini } from '../../../components/ui/AddressPickerField'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile, DeliveryAddress } from '../../../types'

export function GestionarDomiciliosModal({
  user,
  isLoaded,
  onClose,
  onAddressesChanged,
}: {
  user:                UserProfile
  isLoaded:            boolean
  onClose:             () => void
  onAddressesChanged?: (addresses: DeliveryAddress[]) => void
}) {
  const [addresses,    setAddresses]    = useState(user.addresses ?? [])
  const [showForm,     setShowForm]     = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [editingLocId, setEditingLocId] = useState<string | null>(null)
  const [editLoc,      setEditLoc]      = useState<{ address: string; lat: number | null; lng: number | null }>({ address: '', lat: null, lng: null })

  const [newAddr, setNewAddr] = useState({
    nombre:           '',
    address:          '',
    lat:              null as number | null,
    lng:              null as number | null,
    horarioApertura:  '',
    horarioCierre:    '',
    contactoNombre:   '',
    contactoTelefono: '',
    esPrincipal:      addresses.length === 0,
  })
  const [addrError, setAddrError] = useState('')

  const save = async (updated: typeof addresses) => {
    setSaving(true)
    setSaveError('')
    try {
      await updateUserDocument(user.uid, { addresses: updated })
      setAddresses(updated)
      onAddressesChanged?.(updated)
    } catch (err) {
      console.error('GestionarDomiciliosModal save error:', err)
      setSaveError('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id: string) => save(addresses.filter((a) => a.id !== id))

  const handleSetPrincipal = (id: string) =>
    save(addresses.map((a) => ({ ...a, esPrincipal: a.id === id })))

  const handleSaveLocation = async (id: string) => {
    if (!editLoc.lat || !editLoc.lng) return
    await save(addresses.map((a) => a.id === id ? { ...a, address: editLoc.address || a.address, lat: editLoc.lat, lng: editLoc.lng } : a))
    setEditingLocId(null)
  }

  const handleAddSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!newAddr.lat || !newAddr.lng) {
      setAddrError('Seleccioná la dirección y confirmá la ubicación en el mapa.')
      return
    }
    const entry = { id: crypto.randomUUID(), ...newAddr }
    const updated = newAddr.esPrincipal
      ? [...addresses.map((a) => ({ ...a, esPrincipal: false })), entry]
      : [...addresses, entry]
    await save(updated)
    setShowForm(false)
    setNewAddr({
      nombre: '', address: '', lat: null, lng: null,
      horarioApertura: '', horarioCierre: '',
      contactoNombre: '', contactoTelefono: '',
      esPrincipal: updated.length === 1,
    })
  }

  return (
    <Modal open onClose={onClose} title={`Domicilios — ${user.razonSocial || user.nombre}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

        {/* Lista de domicilios existentes */}
        {addresses.map((addr) => (
          <div key={addr.id} className="bg-[#F8F7F2] rounded-xl p-3 space-y-2 border border-[#D3D1C7]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-medium">{addr.nombre}</p>
                  {addr.esPrincipal && (
                    <span className="text-xs px-1.5 py-0.5 bg-accent/15 text-accent rounded-full border border-accent/30">
                      Principal
                    </span>
                  )}
                  {addr.lat && addr.lng
                    ? <span className="text-xs text-success">✓ verificada</span>
                    : <span className="text-xs text-yellow-400">⚠ sin mapa</span>
                  }
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{addr.address}</p>
              </div>
              <button
                onClick={() => handleDelete(addr.id)}
                disabled={saving}
                className="text-red-400 hover:text-red-300 disabled:opacity-40 shrink-0 p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {isLoaded && addr.lat && addr.lng && editingLocId !== addr.id && (
              <AddressMapMini lat={addr.lat} lng={addr.lng} />
            )}

            {/* Editor de ubicación inline */}
            {isLoaded && editingLocId === addr.id && (
              <div className="space-y-2 pt-1">
                <AddressAutocomplete
                  initialValue={addr.address}
                  onSelect={(address, lat, lng) => setEditLoc({ address, lat, lng })}
                />
                {editLoc.lat && editLoc.lng && (
                  <AddressMapPicker
                    lat={editLoc.lat}
                    lng={editLoc.lng}
                    height={220}
                    onLocationChange={(address, lat, lng) => setEditLoc({ address, lat, lng })}
                  />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveLocation(addr.id)}
                    disabled={!editLoc.lat || saving}
                    className="flex-1 text-xs bg-accent text-white rounded-lg py-1.5 disabled:opacity-40"
                  >
                    Guardar ubicación
                  </button>
                  <button
                    onClick={() => setEditingLocId(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-[#D3D1C7] rounded-lg px-3 py-1.5"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {addr.horarioApertura && (
              <p className="text-xs text-gray-500">Horario: {addr.horarioApertura} – {addr.horarioCierre}</p>
            )}
            {addr.contactoNombre && (
              <p className="text-xs text-gray-500">
                Contacto: {addr.contactoNombre}{addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
            {isLoaded && editingLocId !== addr.id && (
              <button
                onClick={() => { setEditingLocId(addr.id); setEditLoc({ address: addr.address, lat: addr.lat ?? null, lng: addr.lng ?? null }) }}
                className="text-xs text-accent hover:underline flex items-center gap-1"
              >
                <Navigation size={10} /> {addr.lat ? 'Editar ubicación' : 'Fijar ubicación'}
              </button>
            )}
            {!addr.esPrincipal && (
              <button
                onClick={() => handleSetPrincipal(addr.id)}
                disabled={saving}
                className="text-xs text-accent hover:underline disabled:opacity-40"
              >
                Establecer como principal
              </button>
            )}
          </div>
          </div>
        ))}

        {addresses.length === 0 && !showForm && (
          <p className="text-xs text-gray-500 text-center py-2">Sin domicilios registrados</p>
        )}

        {saveError && (
          <p className="text-xs text-red-400 text-center">{saveError}</p>
        )}

        {/* Formulario para agregar */}
        {showForm ? (
          <form onSubmit={handleAddSubmit} className="space-y-3 border border-accent/30 rounded-xl p-4 bg-[#F8F7F2]/50">
            <p className="text-sm font-semibold text-accent">Nuevo domicilio</p>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Nombre de la sucursal</label>
              <input
                value={newAddr.nombre}
                onChange={(e) => setNewAddr((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Depósito norte, Sede central..."
                required
                className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500">Dirección</label>
              <AddressAutocomplete
                onSelect={(address, lat, lng) => {
                  setAddrError('')
                  setNewAddr((f) => ({ ...f, address, lat, lng }))
                }}
              />
              {addrError && <p className="text-red-400 text-xs">{addrError}</p>}

              {isLoaded && newAddr.lat && newAddr.lng && (
                <div className="mt-1 space-y-1">
                  <AddressMapPicker
                    lat={newAddr.lat}
                    lng={newAddr.lng}
                    height={240}
                    onLocationChange={(address, lat, lng) =>
                      setNewAddr((f) => ({ ...f, address, lat, lng }))
                    }
                  />
                  <p className="text-xs text-success">✓ {newAddr.address}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['horarioApertura', 'horarioCierre'] as const).map((field, i) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">{i === 0 ? 'Apertura' : 'Cierre'}</label>
                  <input
                    type="time"
                    value={newAddr[field]}
                    onChange={(e) => setNewAddr((f) => ({ ...f, [field]: e.target.value }))}
                    className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([['contactoNombre', 'Nombre contacto', 'Juan García'], ['contactoTelefono', 'Teléfono', '+54 11...']] as const).map(([field, label, placeholder]) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">{label}</label>
                  <input
                    value={newAddr[field]}
                    onChange={(e) => setNewAddr((f) => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newAddr.esPrincipal}
                onChange={(e) => setNewAddr((f) => ({ ...f, esPrincipal: e.target.checked }))}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-xs text-gray-300">Dirección principal</span>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={() => setShowForm(false)} className="flex-1 text-sm">
                Cancelar
              </Button>
              <Button type="submit" loading={saving} className="flex-1 text-sm">
                Guardar
              </Button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-1.5 text-sm text-accent hover:text-gray-700 border border-dashed border-accent/30 hover:border-accent rounded-xl py-3 transition-colors"
          >
            <Plus size={14} /> Agregar domicilio
          </button>
        )}
      </div>
    </Modal>
  )
}
