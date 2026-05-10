import { useState, useEffect, ChangeEvent } from 'react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import {
  getAllUsers,
  updateUserRole,
  updateUserStatus,
  approveUser,
} from '../../services/userService'
import { UserProfile, UserRole, UserStatus } from '../../types'

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
  user: UserProfile
  currentUser: UserProfile | null
  onRoleChange: (uid: string, rol: UserRole) => Promise<void>
  onToggleStatus: (u: UserProfile) => Promise<void>
  onApprove: (u: UserProfile) => Promise<void>
}

function UserRow({ user, currentUser, onRoleChange, onToggleStatus, onApprove }: UserRowProps) {
  const [busy, setBusy] = useState(false)
  const isSelf = user.uid === currentUser?.uid

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{user.nombre || '(sin nombre)'}</p>
            {isSelf && <span className="text-xs text-muted">(vos)</span>}
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap
                ${STATUS_STYLES[user.estado] ?? 'bg-muted/20 text-muted border-muted/30'}`}
            >
              {STATUS_LABELS[user.estado] ?? user.estado}
            </span>
          </div>
          <p className="text-muted text-xs mt-0.5 truncate">{user.email}</p>
          {user.fechaCreacion && (
            <p className="text-muted text-xs mt-0.5">
              Registrado: {user.fechaCreacion.toDate().toLocaleDateString('es-AR')}
            </p>
          )}
          {user.fechaAprobacion && (
            <p className="text-muted text-xs">
              Aprobado: {user.fechaAprobacion.toDate().toLocaleDateString('es-AR')}
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
            <Button
              onClick={() => run(() => onApprove(user))}
              loading={busy}
              className="text-xs py-1.5 px-3"
            >
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
    </div>
  )
}
