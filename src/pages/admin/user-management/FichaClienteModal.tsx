import { useState, ChangeEvent } from 'react'
import { deleteField } from 'firebase/firestore'
import { MapPin, Phone, Mail, CreditCard, Building2, User, Calendar, CheckCircle, Plus, Navigation, Tag, Hash } from 'lucide-react'
import { AddressMapMini } from '../../../components/ui/AddressPickerField'
import { useGoogleMapsLoader } from '../../../hooks/useGoogleMapsLoader'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile, ListaPrecios, DeliveryAddress } from '../../../types'
import { STATUS_STYLES, STATUS_LABELS, Row } from './shared'
import { GestionarDomiciliosModal } from './GestionarDomiciliosModal'
import { HistorialPreciosSection } from './HistorialPreciosSection'

const FRECUENCIA_LABELS: Record<string, string> = {
  semanal:   'Semanal',
  quincenal: 'Quincenal',
  mensual:   'Mensual',
}

export function FichaClienteModal({
  user,
  lista,
  currentUser,
  onClose,
  onAddressesChanged,
  onVisitaChanged,
  onActivar,
}: {
  user:                UserProfile
  lista:               ListaPrecios | undefined
  currentUser:         UserProfile | null
  onClose:             () => void
  onAddressesChanged?: (addresses: DeliveryAddress[]) => void
  onVisitaChanged?:    (esVisita: boolean, frecuenciaVisita?: string) => void
  onActivar?:          () => Promise<void>
}) {
  const [domiciliosModal,  setDomiciliosModal]  = useState(false)
  const [localAddresses,   setLocalAddresses]   = useState(user.addresses ?? [])
  const [esVisita,         setEsVisita]         = useState(user.esVisita ?? false)
  const [frecuenciaVisita, setFrecuenciaVisita] = useState(user.frecuenciaVisita ?? 'semanal')
  const [savingVisita,     setSavingVisita]     = useState(false)
  const [codigoCliente,    setCodigoCliente]    = useState(user.codigoCliente ?? '')
  const [savingCodigo,     setSavingCodigo]     = useState(false)
  const [activando,        setActivando]        = useState(false)
  const [localRazonSocial,    setLocalRazonSocial]    = useState(user.razonSocial ?? '')
  const [localNombreContacto, setLocalNombreContacto] = useState(user.nombreContacto ?? '')
  const [localTelefono,       setLocalTelefono]       = useState(user.telefono || user.phone || '')
  const [savingInfo,          setSavingInfo]           = useState(false)
  const { isLoaded } = useGoogleMapsLoader()

  const canManagePrices  = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const canAssignCode    = ['super_admin', 'facturacion'].includes(currentUser?.rol ?? '')
  const canEditInfoBasica = ['super_admin', 'gerente_comercial', 'comercial', 'logistica'].includes(currentUser?.rol ?? '')

  const handleSaveInfo = async () => {
    setSavingInfo(true)
    try {
      await updateUserDocument(user.uid, {
        razonSocial:    localRazonSocial.trim(),
        nombreContacto: localNombreContacto.trim(),
        telefono:       localTelefono.trim(),
      })
    } finally {
      setSavingInfo(false)
    }
  }

  const handleSaveCodigo = async () => {
    setSavingCodigo(true)
    try {
      await updateUserDocument(user.uid, {
        codigoCliente: codigoCliente.trim() || deleteField(),
      })
    } catch (err) {
      console.error(err)
    } finally {
      setSavingCodigo(false)
    }
  }

  const handleActivar = async () => {
    if (!onActivar) return
    setActivando(true)
    await onActivar()
    setActivando(false)
  }

  const handleToggleVisita = async (checked: boolean) => {
    setSavingVisita(true)
    setEsVisita(checked)
    const update: Record<string, unknown> = { esVisita: checked }
    if (checked) update.frecuenciaVisita = frecuenciaVisita
    try {
      await updateUserDocument(user.uid, update as any)
      onVisitaChanged?.(checked, checked ? frecuenciaVisita : undefined)
    } catch (err) {
      console.error(err)
      setEsVisita(!checked)
    } finally {
      setSavingVisita(false)
    }
  }

  const handleFrecuenciaChange = async (val: string) => {
    setFrecuenciaVisita(val as UserProfile['frecuenciaVisita'] & string)
    if (esVisita) {
      await updateUserDocument(user.uid, { frecuenciaVisita: val })
      onVisitaChanged?.(true, val)
    }
  }
  const formatCuit = (cuit: string) => {
    const d = cuit.replace(/\D/g, '')
    if (d.length === 11) return `${d.slice(0,2)}-${d.slice(2,10)}-${d.slice(10)}`
    return cuit
  }

  const tel = user.telefono || user.phone || ''

  return (
    <Modal open onClose={onClose} title="Ficha del cliente">
      <div className="space-y-5">

        {/* Empresa */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={12} /> Empresa
          </h3>
          <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
            {canEditInfoBasica ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Razón social</label>
                <input
                  value={localRazonSocial}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalRazonSocial(e.target.value)}
                  className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              <Row label="Razón social" value={user.razonSocial || '—'} />
            )}
            {canEditInfoBasica ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Nombre contacto</label>
                <input
                  value={localNombreContacto}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalNombreContacto(e.target.value)}
                  className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              <Row label="Nombre contacto" value={user.nombreContacto || user.nombre || '—'} />
            )}
            {user.cuit && <Row label="CUIT" value={formatCuit(user.cuit)} icon={<CreditCard size={13} className="text-gray-500 shrink-0" />} />}
          </div>
        </section>

        {/* Contacto */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <User size={12} /> Contacto
          </h3>
          <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
            <Row label="Email" value={user.email || '—'} icon={<Mail size={13} className="text-gray-500 shrink-0" />} />
            {canEditInfoBasica ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Teléfono</label>
                <input
                  value={localTelefono}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalTelefono(e.target.value)}
                  placeholder="+54 11 1234-5678"
                  className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ) : (
              tel ? <Row label="Teléfono" value={tel} icon={<Phone size={13} className="text-gray-500 shrink-0" />} /> : null
            )}
            {canEditInfoBasica && (
              <Button onClick={handleSaveInfo} loading={savingInfo} className="w-full text-xs mt-1">
                Guardar cambios
              </Button>
            )}
          </div>
        </section>

        {/* Cuenta */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={12} /> Cuenta
          </h3>
          <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Estado</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[user.estado]}`}>
                {STATUS_LABELS[user.estado]}
              </span>
            </div>
            {user.fechaCreacion && (
              <Row label="Registro"   value={user.fechaCreacion.toDate().toLocaleDateString('es-AR')} />
            )}
            {user.fechaAprobacion && (
              <Row
                label="Activado"
                value={user.fechaAprobacion.toDate().toLocaleDateString('es-AR')}
                icon={<CheckCircle size={13} className="text-success shrink-0" />}
              />
            )}
            {onActivar && user.estado === 'pendiente' && (
              <Button onClick={handleActivar} loading={activando} className="w-full text-sm mt-1">
                ✓ Activar cliente
              </Button>
            )}
          </div>
        </section>

        {/* Canal de precios */}
        {lista && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={12} /> Canal / precios
            </h3>
            <div className="bg-[#F8F7F2] rounded-xl p-3">
              <Row label="Lista asignada" value={lista.nombre} />
              {Object.keys(user.preciosCustom ?? {}).length > 0 && (
                <p className="text-xs text-yellow-400 mt-1.5">
                  {Object.keys(user.preciosCustom!).length} precio{Object.keys(user.preciosCustom!).length !== 1 ? 's' : ''} especial{Object.keys(user.preciosCustom!).length !== 1 ? 'es' : ''}
                </p>
              )}
              {!canManagePrices && (
                <p className="text-xs text-gray-400 mt-1.5">Solo el gerente comercial puede modificar precios.</p>
              )}
            </div>
          </section>
        )}

        {/* Código de cliente — asignado por facturación */}
        {user.rol === 'cliente' && (canAssignCode || user.codigoCliente) && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Hash size={12} /> Código de cliente
            </h3>
            <div className="bg-[#F8F7F2] rounded-xl p-3">
              {canAssignCode ? (
                <div className="flex gap-2">
                  <input
                    value={codigoCliente}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCodigoCliente(e.target.value)}
                    placeholder="Ej: CLI-0042"
                    className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 flex-1 focus:outline-none focus:ring-1 focus:ring-accent placeholder-gray-400"
                  />
                  <Button onClick={handleSaveCodigo} loading={savingCodigo} className="text-xs shrink-0">
                    Guardar
                  </Button>
                </div>
              ) : (
                <Row label="Código" value={user.codigoCliente ?? '—'} />
              )}
              {canAssignCode && (
                <p className="text-xs text-gray-400 mt-1.5">Código interno de facturación para este cliente.</p>
              )}
            </div>
          </section>
        )}

        {/* Visita */}
        {user.rol === 'cliente' && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Navigation size={12} /> Seguimiento de visita
            </h3>
            <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={esVisita}
                  disabled={savingVisita || !canEditInfoBasica}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleToggleVisita(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm">Cliente con visitas periódicas</span>
              </label>
              {esVisita && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Frecuencia</label>
                  <select
                    value={frecuenciaVisita}
                    disabled={savingVisita || !canEditInfoBasica}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFrecuenciaChange(e.target.value)}
                    className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(FRECUENCIA_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
              {savingVisita && <p className="text-xs text-gray-500">Guardando…</p>}
            </div>
          </section>
        )}

        {/* Domicilios */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={12} /> Domicilios ({localAddresses.length})
            </h3>
            <button
              onClick={() => setDomiciliosModal(true)}
              className="flex items-center gap-1 text-xs text-accent hover:bg-accent hover:text-gray-700 border border-accent/30 hover:border-accent rounded-lg px-2.5 py-1 transition-colors"
            >
              <Plus size={11} /> Gestionar
            </button>
          </div>

          {localAddresses.length > 0 ? (
            <div className="space-y-2">
              {localAddresses.map((addr) => (
                <div key={addr.id} className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{addr.nombre}</p>
                    {addr.esPrincipal && (
                      <span className="text-xs px-1.5 py-0.5 bg-accent/15 text-accent rounded-full border border-accent/30">
                        Principal
                      </span>
                    )}
                    {addr.lat && addr.lng
                      ? <span className="text-xs text-success">✓ ubicación verificada</span>
                      : <span className="text-xs text-yellow-400">⚠ sin ubicación</span>
                    }
                  </div>
                  <p className="text-xs text-gray-500">{addr.address}</p>
                  {isLoaded && addr.lat && addr.lng && (
                    <AddressMapMini lat={addr.lat} lng={addr.lng} />
                  )}
                  {addr.contactoNombre && (
                    <p className="text-xs text-gray-500">
                      Contacto: {addr.contactoNombre}
                      {addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
                    </p>
                  )}
                  {addr.horarioApertura && addr.horarioCierre && (
                    <p className="text-xs text-gray-500">
                      Horario: {addr.horarioApertura} – {addr.horarioCierre}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setDomiciliosModal(true)}
              className="w-full bg-[#F8F7F2] border border-dashed border-[#D3D1C7] rounded-xl p-4 text-center text-xs text-gray-500 hover:text-accent hover:border-accent transition-colors"
            >
              Sin domicilios registrados — clic para agregar
            </button>
          )}
        </section>

        {/* Historial de precios */}
        {user.rol === 'cliente' && (
          <HistorialPreciosSection
            uid={user.uid}
            lista={lista}
            preciosCustom={user.preciosCustom}
          />
        )}

        <Button variant="outline" onClick={onClose} className="w-full mt-1">Cerrar</Button>

        {domiciliosModal && (
          <GestionarDomiciliosModal
            user={user}
            isLoaded={isLoaded}
            onClose={() => setDomiciliosModal(false)}
            onAddressesChanged={(updated) => {
              setLocalAddresses(updated)
              onAddressesChanged?.(updated)
            }}
          />
        )}
      </div>
    </Modal>
  )
}
