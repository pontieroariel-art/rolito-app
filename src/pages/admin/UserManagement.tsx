import { useState, useEffect, useMemo, ChangeEvent, FormEvent, ReactNode } from 'react'
import { deleteField, serverTimestamp } from 'firebase/firestore'
import { Tag, ChevronRight, MapPin, Phone, Mail, CreditCard, Building2, User, Calendar, CheckCircle, Plus, Trash2, Navigation, Clock, Hash } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { registrarCambioLista, registrarCambiosCustom, CambioCustom } from '../../services/historialPreciosService'
import { useHistorialCliente } from '../../hooks/useHistorialPrecios'
import { HistorialPrecioEvento } from '../../types'
import { AddressAutocomplete, AddressMapPicker, AddressMapMini } from '../../components/ui/AddressPickerField'
import { useGoogleMapsLoader } from '../../hooks/useGoogleMapsLoader'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import {
  getAllUsers,
  updateUserRole,
  updateUserStatus,
  updateUserDocument,
  approveUser,
  createStaffUser,
  createClientUser,
  createChoferUser,
} from '../../services/userService'
import { useNotifyAprobado } from '../../hooks/useNotifications'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { UserProfile, UserRole, UserStatus, ListaPrecios, DeliveryAddress } from '../../types'

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       'Super Admin',
  gerente_comercial: 'Gte. Comercial',
  comercial:         'Comercial',
  logistica:         'Logística',
  facturacion:       'Facturación',
  chofer:            'Chofer',
  cliente:           'Cliente',
}

const STATUS_STYLES: Record<UserStatus, string> = {
  activo:    'bg-green-500/20 text-green-400 border-green-500/30',
  inactivo:  'bg-red-500/20 text-red-400 border-red-500/30',
  pendiente: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

const STATUS_LABELS: Record<UserStatus, string> = {
  activo:    'Activo',
  inactivo:  'Inactivo',
  pendiente: 'Borrador',
}

const ALL_ROLES: UserRole[]    = ['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion', 'chofer', 'cliente']
const STAFF_ROLES: UserRole[]  = ['super_admin', 'gerente_comercial', 'comercial', 'logistica', 'facturacion', 'chofer']
const ALL_STATUSES: UserStatus[] = ['activo', 'inactivo', 'pendiente']

export default function UserManagement() {
  const { user: currentUser }           = useAuth()
  const [users, setUsers]               = useState<UserProfile[]>([])
  const [loading, setLoading]           = useState(true)
  const [tab, setTab]                   = useState<'clientes' | 'equipo'>('clientes')
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [crearModal, setCrearModal]               = useState(false)
  const [crearClienteModal, setCrearClienteModal] = useState(false)
  const notifyAprobadoMutation          = useNotifyAprobado()
  const { listas }                      = useAllListasPrecios()

  const load = async () => {
    setLoading(true)
    const data = await getAllUsers()
    setUsers(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const isStaff = (u: UserProfile) => u.rol !== 'cliente'

  const filtered = users.filter((u) => {
    if (tab === 'clientes' && isStaff(u)) return false
    if (tab === 'equipo'   && !isStaff(u)) return false
    const q           = search.toLowerCase()
    const matchSearch = !q ||
      u.nombre?.toLowerCase().includes(q) ||
      u.razonSocial?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || u.estado === statusFilter
    return matchSearch && matchStatus
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

  const handleListaChange = (uid: string, listaPreciosId: string | null) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.uid === uid ? { ...u, listaPreciosId: listaPreciosId ?? undefined } : u,
      ),
    )
  }

  const handleAddressesChanged = (uid: string, addresses: DeliveryAddress[]) => {
    setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, addresses } : u))
  }

  const handleVisitaChanged = (uid: string, esVisita: boolean, frecuenciaVisita?: string) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.uid === uid ? { ...u, esVisita, frecuenciaVisita: frecuenciaVisita as UserProfile['frecuenciaVisita'] } : u,
      ),
    )
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
            {pendingCount > 0 && ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '') && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2 text-sm text-yellow-400">
                {pendingCount} borrador{pendingCount > 1 ? 'es' : ''} pendiente{pendingCount > 1 ? 's' : ''}
              </div>
            )}
            {tab === 'equipo' && currentUser?.rol === 'super_admin' && (
              <Button onClick={() => setCrearModal(true)} className="text-sm">
                + Crear usuario
              </Button>
            )}
            {tab === 'clientes' && ['super_admin', 'gerente_comercial', 'comercial'].includes(currentUser?.rol ?? '') && (
              <Button onClick={() => setCrearClienteModal(true)} className="text-sm">
                + Crear cliente
              </Button>
            )}
            <Button variant="outline" onClick={load} className="text-sm">
              ↻ Actualizar
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-1">
          {(['clientes', 'equipo'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch('') }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-white'
              }`}
            >
              {t === 'clientes'
                ? `Clientes (${users.filter((u) => u.rol === 'cliente').length})`
                : `Equipo Rolito (${users.filter((u) => u.rol !== 'cliente').length})`}
            </button>
          ))}
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
          {(search || statusFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setStatusFilter('all') }}
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
                ? `Todos (${filtered.length})`
                : `${STATUS_LABELS[s]} (${filtered.filter((u) => u.estado === s).length})`}
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
                onListaChange={handleListaChange}
                onAddressesChanged={handleAddressesChanged}
                onVisitaChanged={handleVisitaChanged}
              />
            ))
          )}
        </div>
      </main>

      {crearModal && (
        <CrearStaffModal
          onClose={() => setCrearModal(false)}
          onCreated={() => { setCrearModal(false); load() }}
        />
      )}
      {crearClienteModal && (
        <CrearClienteModal
          onClose={() => setCrearClienteModal(false)}
          onCreated={() => { setCrearClienteModal(false); load() }}
          currentUserRol={currentUser?.rol}
        />
      )}
    </>
  )
}

// ── CrearStaffModal ───────────────────────────────────────────────────────────

function CrearStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre,   setNombre]   = useState('')
  const [email,    setEmail]    = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rol,      setRol]      = useState<UserRole>('comercial')
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const isChofer = rol === 'chofer'

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isChofer && !/^\d{4}$/.test(password)) { setError('El PIN debe ser exactamente 4 dígitos numéricos'); return }
    if (!isChofer && password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
    if (isChofer && !username.trim()) { setError('El nombre de usuario es obligatorio'); return }
    setLoading(true)
    setError('')
    try {
      if (isChofer) {
        await createChoferUser({ nombreContacto: nombre, username: username.trim(), pin: password })
      } else {
        await createStaffUser({ email, password, nombreContacto: nombre, rol })
      }
      onCreated()
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError(isChofer ? 'Ya existe un chofer con ese nombre de usuario' : 'Ya existe una cuenta con ese email')
      } else {
        setError('Error al crear el usuario. Intentá de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Crear usuario Rolito">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre completo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          placeholder="Juan García"
        />
        <div>
          <label className="text-xs text-muted mb-1 block">Rol</label>
          <select
            value={rol}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setRol(e.target.value as UserRole)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {isChofer ? (
          <>
            <Input
              label="Nombre de usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="juan.garcia"
              autoComplete="off"
            />
            <p className="text-xs text-muted -mt-2">
              El chofer ingresa con este usuario (sin espacios ni mayúsculas).
            </p>
          </>
        ) : (
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="juan@rolito.com"
          />
        )}

        <Input
          label={isChofer ? 'PIN' : 'Contraseña temporal'}
          type={showPass ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder={isChofer ? '4 dígitos' : 'Mínimo 6 caracteres'}
          inputMode={isChofer ? 'numeric' : undefined}
          maxLength={isChofer ? 4 : undefined}
          rightElement={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass((v) => !v)}
              className="text-lg leading-none text-muted hover:text-white"
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          }
        />
        <p className="text-xs text-muted -mt-2">
          {isChofer
            ? 'PIN de 4 dígitos. El chofer ingresa desde "Ingreso Choferes" en la app.'
            : 'El usuario podrá cambiar su contraseña desde "¿Olvidaste tu contraseña?" en Ingreso Empresa.'}
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" loading={loading} className="flex-1">Crear cuenta</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── CrearClienteModal ─────────────────────────────────────────────────────────

function CrearClienteModal({ onClose, onCreated, currentUserRol }: { onClose: () => void; onCreated: () => void; currentUserRol?: UserRole }) {
  const estadoInicial: UserStatus = ['super_admin', 'gerente_comercial'].includes(currentUserRol ?? '')
    ? 'activo'
    : 'pendiente'
  const [razonSocial,    setRazonSocial]    = useState('')
  const [nombreContacto, setNombreContacto] = useState('')
  const [cuit,           setCuit]           = useState('')
  const [email,          setEmail]          = useState('')
  const [telefono,       setTelefono]       = useState('')
  const [password,       setPassword]       = useState('')
  const [showPass,       setShowPass]       = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState('')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const cuitDigits = cuit.replace(/\D/g, '')
    if (cuitDigits.length !== 11) { setError('El CUIT debe tener 11 dígitos'); return }
    if (password.length < 6)      { setError('La contraseña debe tener al menos 6 caracteres'); return }
    setLoading(true)
    setError('')
    try {
      await createClientUser({ email, password, razonSocial, nombreContacto, cuit, telefono, estadoInicial })
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Razón social"
          value={razonSocial}
          onChange={(e) => setRazonSocial(e.target.value)}
          required
          placeholder="Mi Empresa S.A."
        />
        <Input
          label="Nombre de contacto"
          value={nombreContacto}
          onChange={(e) => setNombreContacto(e.target.value)}
          required
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
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
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
              className="text-lg leading-none text-muted hover:text-white"
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          }
        />
        {estadoInicial === 'pendiente' ? (
          <p className="text-xs text-yellow-400">
            La cuenta se creará como borrador. El gerente comercial deberá revisar las condiciones y activarla.
          </p>
        ) : (
          <p className="text-xs text-muted">
            La cuenta quedará activa de inmediato. El cliente puede ingresar con su CUIT y contraseña.
          </p>
        )}

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

interface UserRowProps {
  user:                UserProfile
  currentUser:         UserProfile | null
  listas:              ListaPrecios[]
  onRoleChange:        (uid: string, rol: UserRole) => Promise<void>
  onToggleStatus:      (u: UserProfile) => Promise<void>
  onApprove:           (u: UserProfile) => Promise<void>
  onListaChange:       (uid: string, listaPreciosId: string | null) => void
  onAddressesChanged:  (uid: string, addresses: DeliveryAddress[]) => void
  onVisitaChanged:     (uid: string, esVisita: boolean, frecuenciaVisita?: string) => void
}

function UserRow({ user, currentUser, listas, onRoleChange, onToggleStatus, onApprove, onListaChange, onAddressesChanged, onVisitaChanged }: UserRowProps) {
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
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        {/* Info — clickeable para ver ficha completa */}
        <button
          onClick={() => setFichaModal(true)}
          className="min-w-0 flex-1 text-left group flex items-center gap-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm group-hover:text-accent transition-colors">
                {user.razonSocial || user.nombre || '(sin nombre)'}
              </p>
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
              {user.esVisita && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-400 font-medium flex items-center gap-1">
                  <Navigation size={10} />
                  visita
                </span>
              )}
              {(() => {
                if (!user.ultimoCambioPrecio) return null
                const d = user.ultimoCambioPrecio.toDate?.() ?? new Date((user.ultimoCambioPrecio as any).seconds * 1000)
                const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
                if (diffDays > 7) return null
                return (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-medium flex items-center gap-1">
                    <Clock size={10} />
                    precio actualizado
                  </span>
                )
              })()}
            </div>
            {user.username
              ? <p className="text-muted text-xs mt-0.5">@{user.username}</p>
              : <p className="text-muted text-xs mt-0.5 truncate">{user.email}</p>
            }
            {user.cuit && <p className="text-muted text-xs mt-0.5">CUIT: {user.cuit}</p>}
            {user.codigoCliente && (
              <p className="text-muted text-xs mt-0.5 flex items-center gap-1">
                <Hash size={9} className="shrink-0" />
                {user.codigoCliente}
              </p>
            )}
            {(() => {
              const primary = user.addresses?.find((a) => a.esPrincipal) ?? user.addresses?.[0]
              return primary ? (
                <p className="text-muted text-xs mt-0.5 truncate flex items-center gap-1">
                  <MapPin size={10} className="shrink-0" />
                  {primary.address}
                </p>
              ) : null
            })()}
          </div>
          <ChevronRight size={14} className="text-muted group-hover:text-accent transition-colors shrink-0" />
        </button>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2 items-center shrink-0">
          {user.rol === 'cliente' ? (
            <span className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-muted">
              Cliente
            </span>
          ) : canChangeRole ? (
            <select
              value={user.rol}
              disabled={busy || isSelf}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                run(() => onRoleChange(user.uid, e.target.value as UserRole))
              }
              className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ALL_ROLES.filter((r) => r !== 'cliente').map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          ) : (
            <span className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-muted">
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

      {/* Fila de precios — solo para clientes y roles con acceso a precios */}
      {user.rol === 'cliente' && canManagePrices && (
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

// ── FichaClienteModal ─────────────────────────────────────────────────────────

const FRECUENCIA_LABELS: Record<string, string> = {
  semanal:   'Semanal',
  quincenal: 'Quincenal',
  mensual:   'Mensual',
}

function FichaClienteModal({
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
  const { isLoaded } = useGoogleMapsLoader()

  const canManagePrices = ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '')
  const canAssignCode   = ['super_admin', 'facturacion'].includes(currentUser?.rol ?? '')

  const handleSaveCodigo = async () => {
    setSavingCodigo(true)
    await updateUserDocument(user.uid, {
      codigoCliente: codigoCliente.trim() || deleteField(),
    })
    setSavingCodigo(false)
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
    await updateUserDocument(user.uid, update as any)
    onVisitaChanged?.(checked, checked ? frecuenciaVisita : undefined)
    setSavingVisita(false)
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
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={12} /> Empresa
          </h3>
          <div className="bg-bg rounded-xl p-3 space-y-2">
            <Row label="Razón social"    value={user.razonSocial || '—'} />
            <Row label="Nombre contacto" value={user.nombreContacto || user.nombre || '—'} />
            {user.cuit && <Row label="CUIT" value={formatCuit(user.cuit)} icon={<CreditCard size={13} className="text-muted shrink-0" />} />}
          </div>
        </section>

        {/* Contacto */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <User size={12} /> Contacto
          </h3>
          <div className="bg-bg rounded-xl p-3 space-y-2">
            <Row label="Email"    value={user.email || '—'} icon={<Mail  size={13} className="text-muted shrink-0" />} />
            {tel && <Row label="Teléfono" value={tel}       icon={<Phone size={13} className="text-muted shrink-0" />} />}
          </div>
        </section>

        {/* Cuenta */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={12} /> Cuenta
          </h3>
          <div className="bg-bg rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted">Estado</span>
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
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={12} /> Canal / precios
            </h3>
            <div className="bg-bg rounded-xl p-3">
              <Row label="Lista asignada" value={lista.nombre} />
              {Object.keys(user.preciosCustom ?? {}).length > 0 && (
                <p className="text-xs text-yellow-400 mt-1.5">
                  {Object.keys(user.preciosCustom!).length} precio{Object.keys(user.preciosCustom!).length !== 1 ? 's' : ''} especial{Object.keys(user.preciosCustom!).length !== 1 ? 'es' : ''}
                </p>
              )}
              {!canManagePrices && (
                <p className="text-xs text-muted/50 mt-1.5">Solo el gerente comercial puede modificar precios.</p>
              )}
            </div>
          </section>
        )}

        {/* Código de cliente — asignado por facturación */}
        {user.rol === 'cliente' && (canAssignCode || user.codigoCliente) && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Hash size={12} /> Código de cliente
            </h3>
            <div className="bg-bg rounded-xl p-3">
              {canAssignCode ? (
                <div className="flex gap-2">
                  <input
                    value={codigoCliente}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCodigoCliente(e.target.value)}
                    placeholder="Ej: CLI-0042"
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white flex-1 focus:outline-none focus:ring-1 focus:ring-accent placeholder-muted"
                  />
                  <Button onClick={handleSaveCodigo} loading={savingCodigo} className="text-xs shrink-0">
                    Guardar
                  </Button>
                </div>
              ) : (
                <Row label="Código" value={user.codigoCliente ?? '—'} />
              )}
              {canAssignCode && (
                <p className="text-xs text-muted/60 mt-1.5">Código interno de facturación para este cliente.</p>
              )}
            </div>
          </section>
        )}

        {/* Visita */}
        {user.rol === 'cliente' && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Navigation size={12} /> Seguimiento de visita
            </h3>
            <div className="bg-bg rounded-xl p-3 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={esVisita}
                  disabled={savingVisita}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleToggleVisita(e.target.checked)}
                  className="w-4 h-4 accent-accent"
                />
                <span className="text-sm">Cliente con visitas periódicas</span>
              </label>
              {esVisita && (
                <div>
                  <label className="text-xs text-muted mb-1 block">Frecuencia</label>
                  <select
                    value={frecuenciaVisita}
                    disabled={savingVisita}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFrecuenciaChange(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(FRECUENCIA_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              )}
              {savingVisita && <p className="text-xs text-muted">Guardando…</p>}
            </div>
          </section>
        )}

        {/* Domicilios */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={12} /> Domicilios ({localAddresses.length})
            </h3>
            <button
              onClick={() => setDomiciliosModal(true)}
              className="flex items-center gap-1 text-xs text-accent hover:text-white border border-accent/30 hover:border-accent rounded-lg px-2.5 py-1 transition-colors"
            >
              <Plus size={11} /> Gestionar
            </button>
          </div>

          {localAddresses.length > 0 ? (
            <div className="space-y-2">
              {localAddresses.map((addr) => (
                <div key={addr.id} className="bg-bg rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-white">{addr.nombre}</p>
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
                  <p className="text-xs text-muted">{addr.address}</p>
                  {isLoaded && addr.lat && addr.lng && (
                    <AddressMapMini lat={addr.lat} lng={addr.lng} />
                  )}
                  {addr.contactoNombre && (
                    <p className="text-xs text-muted">
                      Contacto: {addr.contactoNombre}
                      {addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
                    </p>
                  )}
                  {addr.horarioApertura && addr.horarioCierre && (
                    <p className="text-xs text-muted">
                      Horario: {addr.horarioApertura} – {addr.horarioCierre}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setDomiciliosModal(true)}
              className="w-full bg-bg border border-dashed border-border rounded-xl p-4 text-center text-xs text-muted hover:text-accent hover:border-accent transition-colors"
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

// ── HistorialPreciosSection ───────────────────────────────────────────────────

const CHART_COLORS = ['#00C2FF', '#FF6B6B', '#4ECDC4', '#FFE66D', '#C084FC', '#F97316', '#34D399']

function evToDate(ev: HistorialPrecioEvento): Date {
  const ts = ev.fecha as any
  if (!ts) return new Date(0)
  return ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
}

function relativeTime(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7)  return `hace ${days} días`
  if (days < 30) return `hace ${Math.floor(days / 7)} sem.`
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: '2-digit' })
}

function HistorialPreciosSection({
  uid,
  lista,
  preciosCustom,
}: {
  uid:           string
  lista?:        ListaPrecios
  preciosCustom?: Record<string, number>
}) {
  const [visible, setVisible]       = useState(false)
  const { historial, loading, load } = useHistorialCliente(uid)

  const handleLoad = () => { setVisible(true); load() }

  // Chart data
  const chartData = useMemo(() => {
    const evs = historial.filter((e) => e.tipo === 'custom' && e.precioNuevo != null)
    if (evs.length < 2) return null
    const byProduct: Record<string, Array<{ ts: number; precio: number }>> = {}
    for (const ev of evs) {
      const n = ev.productoNombre ?? '?'
      if (!byProduct[n]) byProduct[n] = []
      byProduct[n].push({ ts: evToDate(ev).getTime(), precio: ev.precioNuevo! })
    }
    const allTs = [...new Set(Object.values(byProduct).flat().map((p) => p.ts))].sort()
    if (allTs.length < 2) return null
    const productos = Object.keys(byProduct)
    const rows = allTs.map((ts) => {
      const row: Record<string, any> = {
        fecha: new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      }
      for (const nombre of productos) {
        const pts = byProduct[nombre].filter((p) => p.ts <= ts)
        if (pts.length > 0) row[nombre] = pts[pts.length - 1].precio
      }
      return row
    })
    return { rows, productos }
  }, [historial])

  // Desviación vs lista base
  const desvios = useMemo(() => {
    if (!lista || !preciosCustom) return []
    return Object.entries(preciosCustom).map(([id, custom]) => {
      const item = lista.items.find((i) => i.productoId === id)
      if (!item) return null
      const pct = Math.round(((custom - item.precio) / item.precio) * 100)
      return { nombre: item.nombre, listaPrice: item.precio, customPrice: custom, pct }
    }).filter(Boolean) as Array<{ nombre: string; listaPrice: number; customPrice: number; pct: number }>
  }, [lista, preciosCustom])

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={12} /> Historial de precios
        </h3>
        {!visible && (
          <button
            onClick={handleLoad}
            className="text-xs text-accent hover:text-white border border-accent/30 hover:border-accent rounded-lg px-2.5 py-1 transition-colors"
          >
            Ver historial
          </button>
        )}
      </div>

      {/* Desviación vs lista base */}
      {desvios.length > 0 && (
        <div className="bg-bg rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-muted">Desviación respecto a lista base ({lista?.nombre})</p>
          {desvios.map((d) => (
            <div key={d.nombre} className="flex justify-between items-center text-xs">
              <span className="text-muted truncate flex-1">{d.nombre}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-muted">${d.listaPrice.toLocaleString('es-AR')}</span>
                <span className="text-white font-medium">${d.customPrice.toLocaleString('es-AR')}</span>
                <span className={`font-bold w-12 text-right ${
                  Math.abs(d.pct) > 20 ? 'text-red-400' : d.pct < 0 ? 'text-success' : 'text-orange-400'
                }`}>
                  {d.pct > 0 ? '+' : ''}{d.pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!visible && (
        <p className="text-xs text-muted/60 text-center py-1">Cargá el historial para ver el detalle de cambios</p>
      )}

      {visible && loading && (
        <p className="text-xs text-muted text-center py-2 animate-pulse">Cargando historial…</p>
      )}

      {visible && !loading && historial.length === 0 && (
        <div className="bg-bg rounded-xl p-4 text-center">
          <p className="text-xs text-muted">Sin cambios registrados aún</p>
        </div>
      )}

      {visible && !loading && historial.length > 0 && (
        <>
          {/* Gráfico evolución */}
          {chartData && (
            <div className="bg-bg rounded-xl p-3">
              <p className="text-xs text-muted mb-2">Evolución de precios</p>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={chartData.rows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <XAxis dataKey="fecha" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={44}
                    tickFormatter={(v) => `$${Number(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f1c30', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`$${Number(v).toLocaleString('es-AR')}`, '']}
                  />
                  {chartData.productos.map((nombre, i) => (
                    <Line key={nombre} type="stepAfter" dataKey={nombre}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2} dot={{ r: 3 }} connectNulls={false} name={nombre} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {historial.map((ev) => {
              const fecha   = evToDate(ev)
              const diff    = ev.precioAnterior != null && ev.precioNuevo != null
                ? Math.round(((ev.precioNuevo - ev.precioAnterior) / ev.precioAnterior) * 100)
                : null
              const big     = diff !== null && Math.abs(diff) > 20
              const vigTs   = ev.vigenciaHasta as any
              const vigDate = vigTs?.toDate?.() ?? (vigTs?.seconds ? new Date(vigTs.seconds * 1000) : null)
              const expired = vigDate && vigDate < new Date()

              return (
                <div key={ev.id} className={`bg-bg rounded-xl p-3 space-y-1 border ${
                  big ? 'border-red-500/20' : 'border-transparent'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="shrink-0 text-sm mt-0.5">{ev.tipo === 'lista' ? '📋' : '💰'}</span>
                      <div className="min-w-0">
                        {ev.tipo === 'lista' ? (
                          <p className="text-xs">
                            <span className="text-muted line-through">{ev.listaAnteriorNombre ?? '—'}</span>
                            {' → '}
                            <span className="text-accent font-medium">{ev.listaNuevaNombre ?? '—'}</span>
                          </p>
                        ) : (
                          <p className="text-xs">
                            <span className="font-medium">{ev.productoNombre}</span>
                            {' '}
                            {ev.accion === 'eliminado' ? (
                              <span className="text-red-400">eliminado (era ${(ev.precioAnterior ?? 0).toLocaleString('es-AR')})</span>
                            ) : (
                              <>
                                <span className="text-muted">${(ev.precioAnterior ?? 0).toLocaleString('es-AR')}</span>
                                {' → '}
                                <span className="text-accent font-medium">${(ev.precioNuevo ?? 0).toLocaleString('es-AR')}</span>
                                {diff !== null && (
                                  <span className={`ml-1 font-bold text-xs ${big ? 'text-red-400' : diff > 0 ? 'text-orange-400' : 'text-success'}`}>
                                    {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}%{big ? ' ⚠' : ''}
                                  </span>
                                )}
                              </>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-muted/70">{ev.modificadoPorNombre}</p>
                        {ev.motivo && (
                          <p className="text-xs text-muted/60 italic mt-0.5">"{ev.motivo}"</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted">{relativeTime(fecha)}</p>
                      {vigDate && (
                        <p className={`text-xs mt-0.5 ${expired ? 'text-red-400' : 'text-accent/70'}`}>
                          {expired ? 'vencido' : `hasta ${vigDate.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Row({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-xs text-white text-right flex items-center gap-1">
        {icon}
        {value}
      </span>
    </div>
  )
}

// ── GestionarDomiciliosModal ──────────────────────────────────────────────────

function GestionarDomiciliosModal({
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
  const [addresses, setAddresses] = useState(user.addresses ?? [])
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')

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
    } catch {
      setSaveError('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id: string) => save(addresses.filter((a) => a.id !== id))

  const handleSetPrincipal = (id: string) =>
    save(addresses.map((a) => ({ ...a, esPrincipal: a.id === id })))

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
          <div key={addr.id} className="bg-bg rounded-xl p-3 space-y-2 border border-border">
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
                <p className="text-xs text-muted mt-0.5">{addr.address}</p>
              </div>
              <button
                onClick={() => handleDelete(addr.id)}
                disabled={saving}
                className="text-red-400 hover:text-red-300 disabled:opacity-40 shrink-0 p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {isLoaded && addr.lat && addr.lng && (
              <AddressMapMini lat={addr.lat} lng={addr.lng} />
            )}

            {addr.horarioApertura && (
              <p className="text-xs text-muted">Horario: {addr.horarioApertura} – {addr.horarioCierre}</p>
            )}
            {addr.contactoNombre && (
              <p className="text-xs text-muted">
                Contacto: {addr.contactoNombre}{addr.contactoTelefono && ` · ${addr.contactoTelefono}`}
              </p>
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
        ))}

        {addresses.length === 0 && !showForm && (
          <p className="text-xs text-muted text-center py-2">Sin domicilios registrados</p>
        )}

        {saveError && (
          <p className="text-xs text-red-400 text-center">{saveError}</p>
        )}

        {/* Formulario para agregar */}
        {showForm ? (
          <form onSubmit={handleAddSubmit} className="space-y-3 border border-accent/30 rounded-xl p-4 bg-bg/50">
            <p className="text-sm font-semibold text-accent">Nuevo domicilio</p>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Nombre de la sucursal</label>
              <input
                value={newAddr.nombre}
                onChange={(e) => setNewAddr((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Depósito norte, Sede central..."
                required
                className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted">Dirección</label>
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
                  <label className="text-xs text-muted">{i === 0 ? 'Apertura' : 'Cierre'}</label>
                  <input
                    type="time"
                    value={newAddr[field]}
                    onChange={(e) => setNewAddr((f) => ({ ...f, [field]: e.target.value }))}
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([['contactoNombre', 'Nombre contacto', 'Juan García'], ['contactoTelefono', 'Teléfono', '+54 11...']] as const).map(([field, label, placeholder]) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs text-muted">{label}</label>
                  <input
                    value={newAddr[field]}
                    onChange={(e) => setNewAddr((f) => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
            className="w-full flex items-center justify-center gap-1.5 text-sm text-accent hover:text-white border border-dashed border-accent/30 hover:border-accent rounded-xl py-3 transition-colors"
          >
            <Plus size={14} /> Agregar domicilio
          </button>
        )}
      </div>
    </Modal>
  )
}

// ── PreciosCustomModal ────────────────────────────────────────────────────────

function PreciosCustomModal({
  user,
  lista,
  currentUser,
  onClose,
}: {
  user:        UserProfile
  lista:       ListaPrecios
  currentUser: UserProfile | null
  onClose:     () => void
}) {
  const [overrides,     setOverrides]     = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    lista.items.filter((i) => i.activo).forEach((i) => {
      const v = user.preciosCustom?.[i.productoId]
      if (v !== undefined) map[i.productoId] = String(v)
    })
    return map
  })
  const [motivo,        setMotivo]        = useState('')
  const [vigenciaHasta, setVigenciaHasta] = useState(user.vigenciaCustom?.[lista.items[0]?.productoId ?? ''] ?? '')
  const [saving,        setSaving]        = useState(false)

  const activeItems = lista.items.filter((i) => i.activo)

  const handleSave = async () => {
    setSaving(true)

    // Construir nuevo preciosCustom
    const preciosCustom: Record<string, number> = {}
    Object.entries(overrides).forEach(([id, val]) => {
      const n = Number(val)
      if (!isNaN(n) && val !== '') preciosCustom[id] = n
    })

    // Vigencia para todos los productos con precio custom
    const vigenciaCustom: Record<string, string> = {}
    if (vigenciaHasta) {
      Object.keys(preciosCustom).forEach((id) => { vigenciaCustom[id] = vigenciaHasta })
    }

    // Calcular cambios respecto al estado anterior
    const oldCustom = user.preciosCustom ?? {}
    const cambios: CambioCustom[] = []

    for (const [id, newPrice] of Object.entries(preciosCustom)) {
      const oldPrice = oldCustom[id] ?? null
      if (oldPrice !== newPrice) {
        const item = activeItems.find((i) => i.productoId === id)
        cambios.push({
          productoId:     id,
          productoNombre: item?.nombre ?? id,
          precioAnterior: oldPrice,
          precioNuevo:    newPrice,
          accion:         oldPrice === null ? 'agregado' : 'modificado',
          vigenciaHasta:  vigenciaHasta || null,
        })
      }
    }
    for (const id of Object.keys(oldCustom)) {
      if (!(id in preciosCustom)) {
        const item = activeItems.find((i) => i.productoId === id)
        cambios.push({
          productoId:     id,
          productoNombre: item?.nombre ?? id,
          precioAnterior: oldCustom[id],
          precioNuevo:    null,
          accion:         'eliminado',
          vigenciaHasta:  null,
        })
      }
    }

    await updateUserDocument(user.uid, {
      preciosCustom:      Object.keys(preciosCustom).length ? preciosCustom : deleteField(),
      vigenciaCustom:     Object.keys(vigenciaCustom).length ? vigenciaCustom : deleteField(),
      ultimoCambioPrecio: cambios.length > 0 ? serverTimestamp() : (user.ultimoCambioPrecio ?? null),
    })

    if (cambios.length > 0 && currentUser) {
      registrarCambiosCustom({
        clientId:            user.uid,
        clientName:          user.razonSocial || user.nombre || user.email,
        cambios,
        modificadoPor:       currentUser.email,
        modificadoPorNombre: currentUser.nombreContacto || currentUser.nombre || currentUser.email,
        motivo:              motivo || undefined,
      }).catch(console.error)
    }

    setSaving(false)
    onClose()
  }

  const pct = (nuevo: number, viejo: number) => Math.round(((nuevo - viejo) / viejo) * 100)

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

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {activeItems.map((item) => {
          const hasOverride = overrides[item.productoId] !== undefined
          const newNum      = hasOverride ? Number(overrides[item.productoId]) : null
          const oldNum      = user.preciosCustom?.[item.productoId] ?? null
          const changed     = hasOverride && newNum !== null && newNum !== oldNum
          const diff        = changed && oldNum !== null ? pct(newNum!, oldNum) : null
          const bigChange   = diff !== null && Math.abs(diff) > 20

          return (
            <div key={item.productoId} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate block">{item.nombre}</span>
                {diff !== null && (
                  <span className={`text-xs font-semibold ${bigChange ? 'text-red-400' : diff > 0 ? 'text-orange-400' : 'text-success'}`}>
                    {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}%{bigChange ? ' ⚠' : ''}
                  </span>
                )}
              </div>
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
                    hasOverride ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-border'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Vigencia y motivo */}
      <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Válido hasta (opcional)</label>
            <input
              type="date"
              value={vigenciaHasta}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setVigenciaHasta(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Motivo del cambio</label>
            <input
              type="text"
              value={motivo}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMotivo(e.target.value)}
              placeholder="Acuerdo comercial, ajuste..."
              className="w-full bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        {vigenciaHasta && (
          <p className="text-xs text-accent/70">
            Los precios especiales tendrán vigencia hasta el {new Date(vigenciaHasta + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Guardar</Button>
      </div>
    </Modal>
  )
}
