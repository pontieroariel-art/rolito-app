import { useState, useEffect, ChangeEvent } from 'react'
import { deleteField } from 'firebase/firestore'
import { Tag } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import {
  getAllUsers,
  updateUserRole,
  updateUserStatus,
  updateUserDocument,
  approveUser,
} from '../../services/userService'
import { useNotifyAprobado } from '../../hooks/useNotifications'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { UserProfile, UserRole, UserStatus, ListaPrecios } from '../../types'

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  comercial:   'Comercial',
  logistica:   'Logística',
  chofer:      'Chofer',
  cliente:     'Cliente',
}

const STATUS_STYLES: Record<UserStatus, string> = {
  activo:    'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:  'bg-red-500/20 text-red-400 border-red-500/30',
  pendiente: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

const STATUS_LABELS: Record<UserStatus, string> = {
  activo:    'Activo',
  inactivo:  'Inactivo',
  pendiente: 'Pendiente',
}

const ALL_ROLES: UserRole[]    = ['super_admin', 'comercial', 'logistica', 'chofer', 'cliente']
const ALL_STATUSES: UserStatus[] = ['activo', 'inactivo', 'pendiente']

export default function UserManagement() {
  const { user: currentUser }           = useAuth()
  const [users, setUsers]               = useState<UserProfile[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [roleFilter, setRoleFilter]     = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const notifyAprobadoMutation          = useNotifyAprobado()
  const { listas }                      = useAllListasPrecios()

  const load = async () => {
    setLoading(true)
    const data = await getAllUsers()
    setUsers(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = users.filter((u) => {
    const q           = search.toLowerCase()
    const matchSearch = !q ||
      u.nombre?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    const matchRole   = roleFilter   === 'all' || u.rol    === roleFilter
    const matchStatus = statusFilter === 'all' || u.estado === statusFilter
    return matchSearch && matchRole && matchStatus
  })

  const handleRole = async (uid: string, rol: UserRole) => {
    await updateUserRole(uid, rol)
    setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, rol } : u))
  }

  const handleToggleStatus = async (u: UserProfile) => {
    const newEstado: UserStatus = u.estado === 'activo' ? 'inactivo' : 'activo'
    await updateUserStatus(u.uid, newEstado)
    setUsers((prev) => prev.map((p) => p.uid === u.uid ? { ...p, estado: newEstado } : p))
  }

  const handleApprove = async (u: UserProfile) => {
    if (!currentUser) return
    await approveUser(u.uid, currentUser.uid)
    setUsers((prev) => prev.map((p) => p.uid === u.uid ? { ...p, estado: 'activo' as UserStatus } : p))
    if (u.email) {
      notifyAprobadoMutation.mutate({ email: u.email, nombre: u.nombreContacto || u.nombre || '' })
    }
  }

  const pendingCount = users.filter((u) => u.estado === 'pendiente').length

  if (loading) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Gestión de usuarios</h1>
            <p className="text-muted text-sm">{users.length} usuarios en total</p>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2 text-sm text-yellow-400">
                {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
              </div>
            )}
            <Button variant="outline" onClick={load} className="text-sm">
              ↻ Actualizar
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white placeholder-muted text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <select
            value={roleFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setRoleFilter(e.target.value as UserRole | 'all')
            }
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">Todos los roles</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setStatusFilter(e.target.value as UserStatus | 'all')
            }
            className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">Todos los estados</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          {(search || roleFilter !== 'all' || statusFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all') }}
              className="text-sm text-muted hover:text-white px-3 py-2"
            >
              Limpiar ✕
            </button>
          )}
        </div>

        {/* Contadores rápidos */}
        <div className="flex flex-wrap gap-2">
          {(['all', ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-accent text-bg border-accent'
                  : 'border-border text-muted hover:border-accent hover:text-white'
              }`}
            >
              {s === 'all'
                ? `Todos (${users.length})`
                : `${STATUS_LABELS[s]} (${users.filter((u) => u.estado === s).length})`}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">No hay usuarios con estos filtros</p>
            </div>
          ) : (
            filtered.map((u) => (
              <UserRow
                key={u.uid}
                user={u}
                currentUser={currentUser}
                listas={listas}
                onRoleChange={handleRole}
                onToggleStatus={handleToggleStatus}
                onApprove={handleApprove}
              />
            ))
          )}
        </div>
      </main>
    </>
  )
}

interface UserRowProps {
  user:           UserProfile
  currentUser:    UserProfile | null
  listas:         ListaPrecios[]
  onRoleChange:   (uid: string, rol: UserRole) => Promise<void>
  onToggleStatus: (u: UserProfile) => Promise<void>
  onApprove:      (u: UserProfile) => Promise<void>
}

function UserRow({ user, currentUser, listas, onRoleChange, onToggleStatus, onApprove }: UserRowProps) {
  const [busy, setBusy]               = useState(false)
  const [preciosModal, setPreciosModal] = useState(false)
  const isSelf = user.uid === currentUser?.uid

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const handleListaChange = (listaPreciosId: string) =>
    run(() => updateUserDocument(user.uid, { listaPreciosId: listaPreciosId || deleteField() }))

  const listaAsignada = listas.find((l) => l.id === user.listaPreciosId)
  const customCount   = Object.keys(user.preciosCustom ?? {}).length

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{user.razonSocial || user.nombre || '(sin nombre)'}</p>
            {isSelf && <span className="text-xs text-muted">(vos)</span>}
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap
                ${STATUS_STYLES[user.estado] ?? 'bg-muted/20 text-muted border-muted/30'}`}
            >
              {STATUS_LABELS[user.estado] ?? user.estado}
            </span>
            {customCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 font-medium flex items-center gap-1">
                <Tag size={10} />
                {customCount} precio{customCount !== 1 ? 's' : ''} especial{customCount !== 1 ? 'es' : ''}
              </span>
            )}
          </div>
          <p className="text-muted text-xs mt-0.5 truncate">{user.email}</p>
          {user.fechaCreacion && (
            <p className="text-muted text-xs mt-0.5">
              Registrado: {user.fechaCreacion.toDate().toLocaleDateString('es-AR')}
            </p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <select
            value={user.rol}
            disabled={busy || isSelf}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              run(() => onRoleChange(user.uid, e.target.value as UserRole))
            }
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>

          {user.estado === 'pendiente' && (
            <Button onClick={() => run(() => onApprove(user))} loading={busy} className="text-xs py-1.5 px-3">
              ✓ Aprobar
            </Button>
          )}

          {user.estado !== 'pendiente' && !isSelf && (
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

      {/* Fila de precios — solo para clientes */}
      {user.rol === 'cliente' && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs text-muted whitespace-nowrap">Canal / lista:</span>
            <select
              value={user.listaPreciosId ?? ''}
              disabled={busy}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => handleListaChange(e.target.value)}
              className="bg-bg border border-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-0 max-w-xs disabled:opacity-50"
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
              className="flex items-center gap-1.5 text-xs text-accent hover:text-white border border-accent/30 hover:border-accent rounded-lg px-3 py-1 transition-colors"
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
          onClose={() => setPreciosModal(false)}
        />
      )}
    </div>
  )
}

// ── PreciosCustomModal ────────────────────────────────────────────────────────

function PreciosCustomModal({
  user,
  lista,
  onClose,
}: {
  user:    UserProfile
  lista:   ListaPrecios
  onClose: () => void
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    lista.items.filter((i) => i.activo).forEach((i) => {
      const v = user.preciosCustom?.[i.productoId]
      if (v !== undefined) map[i.productoId] = String(v)
    })
    return map
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const preciosCustom: Record<string, number> = {}
    Object.entries(overrides).forEach(([id, val]) => {
      const n = Number(val)
      if (!isNaN(n) && val !== '') preciosCustom[id] = n
    })
    await updateUserDocument(user.uid, {
      preciosCustom: Object.keys(preciosCustom).length ? preciosCustom : deleteField(),
    })
    setSaving(false)
    onClose()
  }

  const activeItems = lista.items.filter((i) => i.activo)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Precios especiales — ${user.razonSocial || user.nombre}`}
    >
      <p className="text-xs text-muted mb-4">
        Dejá el campo vacío para usar el precio del canal ({lista.nombre}).
        Ingresá un valor para sobreescribir solo ese producto.
      </p>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {activeItems.map((item) => (
          <div key={item.productoId} className="flex items-center gap-3">
            <span className="text-sm flex-1 min-w-0 truncate">{item.nombre}</span>
            <span className="text-xs text-muted shrink-0 w-16 text-right">
              Canal: ${item.precio.toLocaleString('es-AR')}
            </span>
            <div className="relative w-28 shrink-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs">$</span>
              <input
                type="number"
                min="0"
                placeholder={String(item.precio)}
                value={overrides[item.productoId] ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const v = e.target.value
                  setOverrides((p) => {
                    const next = { ...p }
                    if (v === '') delete next[item.productoId]
                    else next[item.productoId] = v
                    return next
                  })
                }}
                className={`w-full bg-bg border rounded-lg pl-6 pr-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent ${
                  overrides[item.productoId] !== undefined
                    ? 'border-yellow-500/50 bg-yellow-500/5'
                    : 'border-border'
                }`}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Guardar</Button>
      </div>
    </Modal>
  )
}
