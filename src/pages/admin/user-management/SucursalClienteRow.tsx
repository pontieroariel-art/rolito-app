import { useState, ChangeEvent } from 'react'
import { deleteField, serverTimestamp } from 'firebase/firestore'
import { ChevronRight, MapPin, Phone, CreditCard, Navigation } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { registrarCambioLista } from '../../../services/historialPreciosService'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile, ListaPrecios, DeliveryAddress } from '../../../types'
import { SucursalFlat, STATUS_STYLES, STATUS_LABELS } from './shared'
import { FichaClienteModal } from './FichaClienteModal'

export function SucursalClienteRow({
  sucursal, currentUser, listas, onToggleStatus, onApprove, onListaChange, onAddressesChanged, onVisitaChanged,
}: {
  sucursal:           SucursalFlat
  currentUser:        UserProfile | null
  listas:             ListaPrecios[]
  onToggleStatus:     (u: UserProfile) => Promise<void>
  onApprove:          (u: UserProfile) => Promise<void>
  onListaChange:      (uid: string, listaPreciosId: string | null) => void
  onAddressesChanged: (uid: string, addresses: DeliveryAddress[]) => void
  onVisitaChanged:    (uid: string, esVisita: boolean, frecuenciaVisita?: string) => void
}) {
  const { user, address } = sucursal
  const [busy, setBusy]             = useState(false)
  const [fichaModal, setFichaModal] = useState(false)

  const canManagePrices = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const canChangeStatus = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const listaAsignada   = listas.find((l) => l.id === user.listaPreciosId)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const handleListaChange = async (listaPreciosId: string) => {
    const oldLista = listas.find((l) => l.id === user.listaPreciosId)
    const newLista = listas.find((l) => l.id === listaPreciosId)
    await run(() => updateUserDocument(user.uid, {
      listaPreciosId:     listaPreciosId || deleteField(),
      ultimoCambioPrecio: serverTimestamp(),
    }))
    onListaChange(user.uid, listaPreciosId || null)
    if (currentUser) {
      registrarCambioLista({
        clientId:            user.uid,
        clientName:          user.razonSocial || user.nombre || user.email,
        listaAnteriorId:     user.listaPreciosId ?? null,
        listaAnteriorNombre: oldLista?.nombre ?? null,
        listaNuevaId:        listaPreciosId || null,
        listaNuevaNombre:    newLista?.nombre ?? null,
        modificadoPor:       currentUser.email,
        modificadoPorNombre: currentUser.nombreContacto || currentUser.nombre || currentUser.email,
      }).catch(console.error)
    }
  }

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <button
          onClick={() => setFichaModal(true)}
          className="min-w-0 flex-1 text-left group flex items-center gap-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const addrCode = address?.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(address.id) ? address.id : null
                const code = addrCode ?? user.codigoCliente ?? null
                return code ? (
                  <span className="font-mono text-xs font-bold text-accent bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5">
                    {code}
                  </span>
                ) : null
              })()}
              <p className="font-semibold text-sm text-gray-900 group-hover:text-accent transition-colors">
                {address?.nombre || user.razonSocial || user.nombre || '(sin nombre)'}
              </p>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STATUS_STYLES[user.estado] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                {STATUS_LABELS[user.estado] ?? user.estado}
              </span>
              {user.esVisita && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 font-medium flex items-center gap-1">
                  <Navigation size={10} />
                  visita
                </span>
              )}
            </div>
            {user.cuit && (
              <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1">
                <CreditCard size={9} className="shrink-0" />
                {user.cuit}
              </p>
            )}
            {address?.address && (
              <p className="text-gray-500 text-xs mt-0.5 truncate flex items-center gap-1">
                <MapPin size={10} className="shrink-0" />
                {address.address}
              </p>
            )}
            {address?.contactoTelefono && (
              <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1">
                <Phone size={9} className="shrink-0" />
                {address.contactoTelefono}
              </p>
            )}
          </div>
          <ChevronRight size={14} className="text-gray-500 group-hover:text-accent transition-colors shrink-0" />
        </button>

        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <span className="bg-gray-100 border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-500">Cliente</span>
          {user.estado === 'pendiente' && canChangeStatus && (
            <Button onClick={() => run(() => onApprove(user))} loading={busy} className="text-xs py-1.5 px-3">
              ✓ Activar
            </Button>
          )}
          {user.estado !== 'pendiente' && canChangeStatus && (
            <Button
              variant={user.estado === 'activo' ? 'danger' : 'outline'}
              onClick={() => run(() => onToggleStatus(user))}
              loading={busy}
              disabled={busy}
              className="text-xs py-1.5 px-3"
            >
              {user.estado === 'activo' ? 'Desactivar' : 'Activar'}
            </Button>
          )}
        </div>
      </div>

      {canManagePrices && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500 whitespace-nowrap">Canal / lista:</span>
          <select
            value={user.listaPreciosId ?? ''}
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleListaChange(e.target.value)}
            className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-0 max-w-xs disabled:opacity-50"
          >
            <option value="">Sin lista asignada</option>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}</option>
            ))}
          </select>
        </div>
      )}

      {fichaModal && (
        <FichaClienteModal
          user={user}
          lista={listaAsignada}
          currentUser={currentUser}
          onClose={() => setFichaModal(false)}
          onAddressesChanged={(addresses) => onAddressesChanged(user.uid, addresses)}
          onVisitaChanged={(esVisita, frecuenciaVisita) => onVisitaChanged(user.uid, esVisita, frecuenciaVisita)}
          onActivar={canChangeStatus && user.estado === 'pendiente'
            ? async () => { await onApprove(user); setFichaModal(false) }
            : undefined}
        />
      )}
    </div>
  )
}
