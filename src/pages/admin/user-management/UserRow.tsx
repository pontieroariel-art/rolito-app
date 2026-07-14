import { useState, ChangeEvent } from 'react'
import { deleteField, serverTimestamp } from 'firebase/firestore'
import { Tag, ChevronRight, MapPin, Phone, CreditCard, Navigation, Clock, Hash } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { registrarCambioLista } from '../../../services/historialPreciosService'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile, UserRole, ListaPrecios, DeliveryAddress } from '../../../types'
import { tsToDate } from '../../../utils/helpers'
import { ALL_ROLES, ROLE_LABELS, STATUS_STYLES, STATUS_LABELS } from './shared'
import { FichaClienteModal } from './FichaClienteModal'
import { PreciosCustomModal } from './PreciosCustomModal'

export interface UserRowProps {
  user:                UserProfile
  currentUser:         UserProfile | null
  listas:              ListaPrecios[]
  onRoleChange:        (uid: string, rol: UserRole) => Promise<void>
  onSubrolChange:      (uid: string, subrol: 'chofer' | 'ayudante') => Promise<void>
  onToggleStatus:      (u: UserProfile) => Promise<void>
  onApprove:           (u: UserProfile) => Promise<void>
  onListaChange:       (uid: string, listaPreciosId: string | null) => void
  onAddressesChanged:  (uid: string, addresses: DeliveryAddress[]) => void
  onVisitaChanged:     (uid: string, esVisita: boolean, frecuenciaVisita?: string) => void
}

export function UserRow({ user, currentUser, listas, onRoleChange, onSubrolChange, onToggleStatus, onApprove, onListaChange, onAddressesChanged, onVisitaChanged }: UserRowProps) {
  const [busy, setBusy]               = useState(false)
  const [preciosModal, setPreciosModal] = useState(false)
  const [fichaModal, setFichaModal]   = useState(false)
  const isSelf            = user.uid === currentUser?.uid
  const canManagePrices   = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const canChangeStatus   = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const canChangeRole     = currentUser?.rol === 'super_admin'

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

  const listaAsignada = listas.find((l) => l.id === user.listaPreciosId)
  const customCount   = Object.keys(user.preciosCustom ?? {}).length

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Info — clickeable para ver ficha completa (solo clientes) */}
        <button
          onClick={() => user.rol === 'cliente' && setFichaModal(true)}
          className={`min-w-0 flex-1 text-left flex items-center gap-2 ${user.rol === 'cliente' ? 'group cursor-pointer' : 'cursor-default'}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm text-gray-900 group-hover:text-accent transition-colors">
                {user.razonSocial || user.nombre || '(sin nombre)'}
              </p>
              {isSelf && <span className="text-xs text-gray-500">(vos)</span>}
              <span
                className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap
                  ${STATUS_STYLES[user.estado] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}
              >
                {STATUS_LABELS[user.estado] ?? user.estado}
              </span>
              {customCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 border border-yellow-200 text-amber-700 font-medium flex items-center gap-1">
                  <Tag size={10} />
                  {customCount} precio{customCount !== 1 ? 's' : ''} especial{customCount !== 1 ? 'es' : ''}
                </span>
              )}
              {user.esVisita && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 font-medium flex items-center gap-1">
                  <Navigation size={10} />
                  visita
                </span>
              )}
              {(() => {
                if (!user.ultimoCambioPrecio) return null
                const d = tsToDate(user.ultimoCambioPrecio)
                const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
                if (diffDays > 7) return null
                return (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 border border-orange-200 text-orange-700 font-medium flex items-center gap-1">
                    <Clock size={10} />
                    precio actualizado
                  </span>
                )
              })()}
            </div>
            {user.rol !== 'cliente'
              ? user.dni
                ? <p className="text-gray-500 text-xs mt-0.5">DNI: {user.dni}</p>
                : <p className="text-gray-500 text-xs mt-0.5 truncate">{user.email}</p>
              : <>
                  {user.email && <p className="text-gray-500 text-xs mt-0.5 truncate">{user.email}</p>}
                  {user.cuit && <p className="text-gray-500 text-xs mt-0.5">CUIT: {user.cuit}</p>}
                </>
            }
            {user.codigoCliente && (
              <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1">
                <Hash size={9} className="shrink-0" />
                {user.codigoCliente}
              </p>
            )}
            {(() => {
              const primary = user.addresses?.find((a) => a.esPrincipal) ?? user.addresses?.[0]
              return primary ? (
                <p className="text-gray-500 text-xs mt-0.5 truncate flex items-center gap-1">
                  <MapPin size={10} className="shrink-0" />
                  {primary.address}
                </p>
              ) : null
            })()}
          </div>
          <ChevronRight size={14} className="text-gray-500 group-hover:text-accent transition-colors shrink-0" />
        </button>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2 items-center shrink-0">
          {user.rol === 'cliente' ? (
            <span className="bg-gray-100 border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-500">
              Cliente
            </span>
          ) : canChangeRole ? (
            <select
              value={user.rol}
              disabled={busy || isSelf}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                run(() => onRoleChange(user.uid, e.target.value as UserRole))
              }
              className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ALL_ROLES.filter((r) => r !== 'cliente').map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          ) : (
            <span className="bg-gray-100 border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-500">
              {ROLE_LABELS[user.rol]}
            </span>
          )}

          {user.estado === 'pendiente' && canChangeStatus && (
            <Button onClick={() => run(() => onApprove(user))} loading={busy} className="text-xs py-1.5 px-3">
              ✓ Activar
            </Button>
          )}

          {user.estado !== 'pendiente' && !isSelf && canChangeStatus && (
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

      {/* Subrol chofer / ayudante */}
      {user.rol === 'chofer' && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">Función:</span>
          <select
            value={user.subrol ?? 'chofer'}
            disabled={busy}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              run(() => onSubrolChange(user.uid, e.target.value as 'chofer' | 'ayudante'))
            }
            className="bg-white border border-[#D3D1C7] rounded-lg px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          >
            <option value="chofer">Chofer</option>
            <option value="ayudante">Ayudante</option>
          </select>
        </div>
      )}

      {/* Fila de precios — solo para clientes y roles con acceso a precios */}
      {user.rol === 'cliente' && canManagePrices && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 flex-1 min-w-0">
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

          {listaAsignada && (
            <button
              onClick={() => setPreciosModal(true)}
              className="flex items-center gap-1.5 text-xs text-accent hover:bg-accent hover:text-gray-700 border border-accent/30 hover:border-accent rounded-lg px-3 py-1 transition-colors"
            >
              <Tag size={11} />
              {customCount > 0 ? `${customCount} precio${customCount !== 1 ? 's' : ''} especial${customCount !== 1 ? 'es' : ''}` : 'Precios especiales'}
            </button>
          )}
        </div>
      )}

      {/* Modal de precios especiales */}
      {preciosModal && listaAsignada && (
        <PreciosCustomModal
          user={user}
          lista={listaAsignada}
          currentUser={currentUser}
          onClose={() => setPreciosModal(false)}
        />
      )}

      {/* Ficha completa del cliente */}
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
