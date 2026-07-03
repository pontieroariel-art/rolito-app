import { useState, useEffect, useMemo, useRef, ChangeEvent, FormEvent, ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
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
import { Skeleton } from '../../components/ui/skeleton'
import { useAuth } from '../../context/AuthContext'
import {
  getAllUsers,
  getStaffUsers,
  invalidateUsersCache,
  updateUserRole,
  updateUserStatus,
  updateUserDocument,
  approveUser,
  createStaffUser,
  createClientUser,
  createChoferUser,
  createClienteImportado,
} from '../../services/userService'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { UserProfile, UserRole, UserStatus, ListaPrecios, DeliveryAddress } from '../../types'
import { tsToDate } from '../../utils/helpers'

const PAGE_SIZE = 50

interface SucursalFlat {
  user:    UserProfile
  address: DeliveryAddress | null
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:       'Super Admin',
  gerente_general:   'Gte. General',
  gerente_comercial: 'Gte. Comercial',
  comercial:         'Comercial',
  logistica:         'Logística',
  facturacion:       'Facturación',
  chofer:            'Chofer',
  cliente:           'Cliente',
}

const STATUS_STYLES: Record<UserStatus, string> = {
  activo:    'bg-green-100 text-green-700 border-green-200',
  inactivo:  'bg-red-100 text-red-700 border-red-200',
  pendiente: 'bg-yellow-100 text-amber-700 border-yellow-200',
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
  const navigate = useNavigate()
  const { user: currentUser }           = useAuth()
  const [clientes, setClientes]         = useState<UserProfile[]>([])
  const [equipo, setEquipo]             = useState<UserProfile[]>([])
  const [loadingClientes, setLoadingClientes] = useState(false)
  const [loadingEquipo, setLoadingEquipo]     = useState(false)
  const clientesLoadedRef               = useRef(false)
  const [tab, setTab]                   = useState<'clientes' | 'equipo'>('clientes')
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [sectorFilter, setSectorFilter] = useState<string>('all')
  const [visibleCount, setVisibleCount]           = useState(PAGE_SIZE)
  const [crearModal, setCrearModal]               = useState(false)
  const [crearClienteModal, setCrearClienteModal] = useState(false)
  const [importarModal, setImportarModal]         = useState(false)
  const { listas }                      = useAllListasPrecios()

  const users = useMemo(() => [...equipo, ...clientes], [equipo, clientes])

  const loadEquipo = async () => {
    setLoadingEquipo(true)
    const data = await getStaffUsers()
    setEquipo(data)
    setLoadingEquipo(false)
  }

  const loadClientes = async (force = false) => {
    if (!force && clientesLoadedRef.current) return
    setLoadingClientes(true)
    const data = await getAllUsers(force)
    setClientes(data.filter((u) => u.rol === 'cliente'))
    clientesLoadedRef.current = true
    setLoadingClientes(false)
  }

  const load = async () => {
    invalidateUsersCache()
    clientesLoadedRef.current = false
    await loadEquipo()
    await loadClientes(true)
  }

  useEffect(() => {
    loadEquipo()
    loadClientes()
  }, [])

  const handleTabChange = (newTab: 'clientes' | 'equipo') => {
    setTab(newTab)
    setVisibleCount(PAGE_SIZE)
    if (newTab === 'clientes') loadClientes()
  }

  const isStaff = (u: UserProfile) => u.rol !== 'cliente'

  const sectors = useMemo(() => {
    const set = new Set<string>()
    clientes.filter((u) => u.sector).forEach((u) => set.add(u.sector!))
    return Array.from(set).sort()
  }, [clientes])

  // Lista plana: una entrada por sucursal (dirección) dentro de cada cuenta
  const sucursalesFlat = useMemo<SucursalFlat[]>(() =>
    clientes.flatMap((u): SucursalFlat[] =>
      u.addresses?.length
        ? u.addresses.map((addr) => ({ user: u, address: addr }))
        : [{ user: u, address: null }]
    )
  , [clientes])

  const filteredSucursales = useMemo(() => {
    const q = search.toLowerCase()
    return sucursalesFlat.filter((sf) => {
      const u    = sf.user
      const addr = sf.address
      const matchSearch = !q ||
        u.razonSocial?.toLowerCase().includes(q) ||
        u.nombre?.toLowerCase().includes(q) ||
        u.cuit?.includes(q) ||
        u.codigoCliente?.toLowerCase().includes(q) ||
        addr?.id?.toLowerCase().includes(q) ||
        addr?.nombre?.toLowerCase().includes(q) ||
        addr?.address?.toLowerCase().includes(q)
      const matchStatus = statusFilter === 'all' || u.estado === statusFilter
      const matchSector = sectorFilter === 'all' || u.sector === sectorFilter
      return matchSearch && matchStatus && matchSector
    })
  }, [sucursalesFlat, search, statusFilter, sectorFilter])

  const loading = tab === 'clientes' ? loadingClientes : loadingEquipo

  // filtered sólo se usa para el tab equipo
  const filtered = equipo.filter((u) => {
    const q           = search.toLowerCase()
    const matchSearch = !q ||
      u.nombre?.toLowerCase().includes(q) ||
      u.razonSocial?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || u.estado === statusFilter
    const matchSector = sectorFilter === 'all' || u.sector === sectorFilter
    return matchSearch && matchStatus && matchSector
  })

  const setUsers = (updater: (prev: UserProfile[]) => UserProfile[]) => {
    setClientes((prev) => updater(prev))
    setEquipo((prev) => updater(prev))
  }

  const handleRole = async (uid: string, rol: UserRole) => {
    await updateUserRole(uid, rol)
    setEquipo((prev) => prev.map((u) => u.uid === uid ? { ...u, rol } : u))
    setClientes((prev) => prev.map((u) => u.uid === uid ? { ...u, rol } : u))
  }

  const handleSubrol = async (uid: string, subrol: 'chofer' | 'ayudante') => {
    await updateUserDocument(uid, { subrol })
    setEquipo((prev) => prev.map((u) => u.uid === uid ? { ...u, subrol } : u))
  }

  const handleToggleStatus = async (u: UserProfile) => {
    const newEstado: UserStatus = u.estado === 'activo' ? 'inactivo' : 'activo'
    await updateUserStatus(u.uid, newEstado)
    setClientes((prev) => prev.map((p) => p.uid === u.uid ? { ...p, estado: newEstado } : p))
    setEquipo((prev) => prev.map((p) => p.uid === u.uid ? { ...p, estado: newEstado } : p))
  }

  const handleListaChange = (uid: string, listaPreciosId: string | null) => {
    setClientes((prev) =>
      prev.map((u) =>
        u.uid === uid ? { ...u, listaPreciosId: listaPreciosId ?? undefined } : u,
      ),
    )
  }

  const handleAddressesChanged = (uid: string, addresses: DeliveryAddress[]) => {
    setClientes((prev) => prev.map((u) => u.uid === uid ? { ...u, addresses } : u))
    setEquipo((prev) => prev.map((u) => u.uid === uid ? { ...u, addresses } : u))
  }

  const handleVisitaChanged = (uid: string, esVisita: boolean, frecuenciaVisita?: string) => {
    setClientes((prev) =>
      prev.map((u) =>
        u.uid === uid ? { ...u, esVisita, frecuenciaVisita: frecuenciaVisita as UserProfile['frecuenciaVisita'] } : u,
      ),
    )
  }

  const handleApprove = async (u: UserProfile) => {
    if (!currentUser) return
    await approveUser(u.uid, currentUser.uid)
    setClientes((prev) => prev.map((p) => p.uid === u.uid ? { ...p, estado: 'activo' as UserStatus } : p))
    if (u.email) {
      // El email de aprobación lo envía el trigger onUserApproved server-side.
    }
  }

  const pendingCount = clientes.filter((u) => u.estado === 'pendiente').length

  if (loadingEquipo && equipo.length === 0 && clientes.length === 0) return (
    <>
      <Navbar />
      <div className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-44" />
        </div>
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gestión de usuarios</h1>
            <p className="text-gray-500 text-sm">{sucursalesFlat.length} sucursales · {equipo.length} equipo</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 && ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '') && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 text-sm text-amber-700">
                {pendingCount} borrador{pendingCount > 1 ? 'es' : ''}
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
            {tab === 'clientes' && currentUser?.rol === 'super_admin' && (
              <Button variant="outline" onClick={() => setImportarModal(true)} className="text-sm">
                ↑ Excel
              </Button>
            )}
            {tab === 'clientes' && (
              <Button variant="outline" onClick={() => navigate('/admin/mapa-clientes')} className="text-sm flex items-center gap-1.5">
                <MapPin size={14} /> Mapa
              </Button>
            )}
            <Button variant="outline" onClick={load} className="text-sm">
              ↻
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 gap-1">
          {(['clientes', 'equipo'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { handleTabChange(t); setSearch(''); setSectorFilter('all') }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-400 hover:text-gray-900'
              }`}
            >
              {t === 'clientes'
                ? `Clientes (${sucursalesFlat.length})`
                : `Equipo Rolito (${equipo.length})`}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="space-y-2">
          <input
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
            placeholder={tab === 'clientes' ? 'Buscar por razón social, CUIT, código, dirección...' : 'Buscar por nombre o email...'}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as UserStatus | 'all'); setVisibleCount(PAGE_SIZE) }}>
              <SelectTrigger className="flex-1 min-w-[130px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tab === 'clientes' && sectors.length > 0 && (
              <Select value={sectorFilter} onValueChange={(v) => { setSectorFilter(v); setVisibleCount(PAGE_SIZE) }}>
                <SelectTrigger className="flex-1 min-w-[130px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los sectores</SelectItem>
                  {sectors.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(search || statusFilter !== 'all' || sectorFilter !== 'all') && (
              <button
                onClick={() => { setSearch(''); setStatusFilter('all'); setSectorFilter('all'); setVisibleCount(PAGE_SIZE) }}
                className="text-sm text-gray-400 hover:text-gray-900 px-3 py-2 shrink-0"
              >
                Limpiar ✕
              </button>
            )}
          </div>
        </div>

        {/* Contadores rápidos */}
        <div className="flex flex-wrap gap-2">
          {(['all', ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setVisibleCount(PAGE_SIZE) }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-accent text-white border-accent'
                  : 'border-[#D3D1C7] text-gray-500 hover:border-accent/50 hover:text-gray-900'
              }`}
            >
              {s === 'all'
                ? `Todos (${tab === 'clientes' ? filteredSucursales.length : filtered.length})`
                : `${STATUS_LABELS[s]} (${
                    tab === 'clientes'
                      ? filteredSucursales.filter((sf) => sf.user.estado === s).length
                      : filtered.filter((u) => u.estado === s).length
                  })`}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
              <LoadingSpinner />
              <p className="text-gray-400 text-sm mt-2">Cargando...</p>
            </div>
          ) : tab === 'clientes' ? (
            filteredSucursales.length === 0 ? (
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
                <p className="text-gray-500 text-sm">No hay clientes con estos filtros</p>
              </div>
            ) : (
              <>
                {filteredSucursales.slice(0, visibleCount).map((sf) => (
                  <SucursalClienteRow
                    key={`${sf.user.uid}_${sf.address?.id ?? 'main'}`}
                    sucursal={sf}
                    currentUser={currentUser}
                    listas={listas}
                    onToggleStatus={handleToggleStatus}
                    onApprove={handleApprove}
                    onListaChange={handleListaChange}
                    onAddressesChanged={handleAddressesChanged}
                    onVisitaChanged={handleVisitaChanged}
                  />
                ))}
                {visibleCount < filteredSucursales.length && (
                  <button
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="w-full bg-white border border-[#D3D1C7] rounded-xl py-3 text-sm text-gray-500 hover:text-gray-900 hover:bg-[#F8F7F2] transition-colors"
                  >
                    Ver más ({filteredSucursales.length - visibleCount} restantes)
                  </button>
                )}
              </>
            )
          ) : (
            filtered.length === 0 ? (
              <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
                <p className="text-gray-500 text-sm">No hay usuarios con estos filtros</p>
              </div>
            ) : (
              <>
                {filtered.slice(0, visibleCount).map((u) => (
                  <UserRow
                    key={u.uid}
                    user={u}
                    currentUser={currentUser}
                    listas={listas}
                    onRoleChange={handleRole}
                    onSubrolChange={handleSubrol}
                    onToggleStatus={handleToggleStatus}
                    onApprove={handleApprove}
                    onListaChange={handleListaChange}
                    onAddressesChanged={handleAddressesChanged}
                    onVisitaChanged={handleVisitaChanged}
                  />
                ))}
                {visibleCount < filtered.length && (
                  <button
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="w-full bg-white border border-[#D3D1C7] rounded-xl py-3 text-sm text-gray-500 hover:text-gray-900 hover:bg-[#F8F7F2] transition-colors"
                  >
                    Ver más ({filtered.length - visibleCount} restantes)
                  </button>
                )}
              </>
            )
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
      {importarModal && (
        <ImportarClientesModal
          onClose={() => setImportarModal(false)}
          onDone={() => { setImportarModal(false); load() }}
        />
      )}
    </div>
  )
}

// ── CrearStaffModal ───────────────────────────────────────────────────────────

function CrearStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nombre,   setNombre]   = useState('')
  const [dni,      setDni]      = useState('')
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
    if (isChofer && !/^\d{11}$/.test(dni.replace(/\D/g, ''))) { setError('El CUIT debe tener 11 dígitos'); return }
    if (!isChofer && !/^\d{8}$/.test(dni.replace(/\D/g, ''))) { setError('El DNI debe tener 8 dígitos'); return }
    setLoading(true)
    setError('')
    try {
      if (isChofer) {
        await createChoferUser({ nombreContacto: nombre, cuit: dni.trim(), pin: password })
      } else {
        await createStaffUser({ dni: dni.trim(), password, nombreContacto: nombre, rol })
      }
      onCreated()
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('Ya existe una cuenta con ese DNI/CUIT')
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
          <label className="text-xs text-gray-500 mb-1 block">Rol</label>
          <select
            value={rol}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setRol(e.target.value as UserRole)}
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        <Input
          label={isChofer ? 'CUIT' : 'DNI'}
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, isChofer ? 11 : 8))}
          required
          placeholder={isChofer ? '20360242871' : '36024287'}
          autoComplete="off"
          inputMode="numeric"
          maxLength={isChofer ? 11 : 8}
        />
        <p className="text-xs text-gray-500 -mt-2">
          {isChofer ? 'El chofer ingresa con su DNI (8 dígitos del medio del CUIT) y PIN.' : 'El usuario ingresa con su DNI y contraseña.'}
        </p>

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
              className="text-lg leading-none text-gray-500 hover:text-gray-700"
            >
              {showPass ? '🙈' : '👁️'}
            </button>
          }
        />
        <p className="text-xs text-gray-500 -mt-2">
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
    const emailFinal = email.trim() || `${cuitDigits}@rolito.app`
    try {
      await createClientUser({ email: emailFinal, password, razonSocial, nombreContacto: nombreContacto || undefined, cuit, telefono, estadoInicial })
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
        {estadoInicial === 'pendiente' ? (
          <p className="text-xs text-yellow-400">
            La cuenta se creará como borrador. El gerente comercial deberá revisar las condiciones y activarla.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
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

// ── SucursalClienteRow ────────────────────────────────────────────────────────
// Una fila por sucursal (dirección) dentro de una cuenta CUIT

function SucursalClienteRow({
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

// ── UserRow ───────────────────────────────────────────────────────────────────

interface UserRowProps {
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

function UserRow({ user, currentUser, listas, onRoleChange, onSubrolChange, onToggleStatus, onApprove, onListaChange, onAddressesChanged, onVisitaChanged }: UserRowProps) {
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
                  disabled={savingVisita}
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
                    disabled={savingVisita}
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
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Clock size={12} /> Historial de precios
        </h3>
        {!visible && (
          <button
            onClick={handleLoad}
            className="text-xs text-accent hover:bg-accent hover:text-gray-700 border border-accent/30 hover:border-accent rounded-lg px-2.5 py-1 transition-colors"
          >
            Ver historial
          </button>
        )}
      </div>

      {/* Desviación vs lista base */}
      {desvios.length > 0 && (
        <div className="bg-[#F8F7F2] rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-gray-500">Desviación respecto a lista base ({lista?.nombre})</p>
          {desvios.map((d) => (
            <div key={d.nombre} className="flex justify-between items-center text-xs">
              <span className="text-gray-500 truncate flex-1">{d.nombre}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-gray-500">${d.listaPrice.toLocaleString('es-AR')}</span>
                <span className="text-gray-900 font-medium">${d.customPrice.toLocaleString('es-AR')}</span>
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
        <p className="text-xs text-gray-400 text-center py-1">Cargá el historial para ver el detalle de cambios</p>
      )}

      {visible && loading && (
        <p className="text-xs text-gray-500 text-center py-2 animate-pulse">Cargando historial…</p>
      )}

      {visible && !loading && historial.length === 0 && (
        <div className="bg-[#F8F7F2] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Sin cambios registrados aún</p>
        </div>
      )}

      {visible && !loading && historial.length > 0 && (
        <>
          {/* Gráfico evolución */}
          {chartData && (
            <div className="bg-[#F8F7F2] rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-2">Evolución de precios</p>
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
                <div key={ev.id} className={`bg-[#F8F7F2] rounded-xl p-3 space-y-1 border ${
                  big ? 'border-red-500/20' : 'border-transparent'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="shrink-0 text-sm mt-0.5">{ev.tipo === 'lista' ? '📋' : '💰'}</span>
                      <div className="min-w-0">
                        {ev.tipo === 'lista' ? (
                          <p className="text-xs">
                            <span className="text-gray-500 line-through">{ev.listaAnteriorNombre ?? '—'}</span>
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
                                <span className="text-gray-500">${(ev.precioAnterior ?? 0).toLocaleString('es-AR')}</span>
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
                        <p className="text-xs text-gray-400">{ev.modificadoPorNombre}</p>
                        {ev.motivo && (
                          <p className="text-xs text-gray-400 italic mt-0.5">"{ev.motivo}"</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500">{relativeTime(fecha)}</p>
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
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-600 text-right flex items-center gap-1">
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
      <p className="text-xs text-gray-500 mb-4">
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
              <span className="text-xs text-gray-500 shrink-0 w-16 text-right">
                Canal: ${item.precio.toLocaleString('es-AR')}
              </span>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
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
                  className={`w-full bg-[#F8F7F2] border rounded-lg pl-6 pr-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent ${
                    hasOverride ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-[#D3D1C7]'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Vigencia y motivo */}
      <div className="mt-4 space-y-3 border-t border-[#D3D1C7]/50 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Válido hasta (opcional)</label>
            <input
              type="date"
              value={vigenciaHasta}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setVigenciaHasta(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Motivo del cambio</label>
            <input
              type="text"
              value={motivo}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMotivo(e.target.value)}
              placeholder="Acuerdo comercial, ajuste..."
              className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent"
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

// ── ImportarClientesModal ─────────────────────────────────────────────────────

interface ClientePreview {
  cuit:            string
  cuitDigits:      string
  email:           string        // Firebase Auth email — siempre sintético cuit@rolito.app
  emailContacto:   string        // email real del Excel, solo guardado en Firestore
  razonSocial:     string
  codigoCliente:   string
  telefono:        string
  notasContacto:   string
  fechaAlta:       Date | null
  addresses:       import('../../types').DeliveryAddress[]
  sucursales:      number
}

function excelSerialToDate(serial: unknown): Date | null {
  if (typeof serial !== 'number' || serial <= 0) return null
  // Excel epoch: Dec 30 1899 (accounts for the 1900 leap-year bug)
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
}

function cleanPhoneDigits(raw: unknown): string {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(0, 20)
}

function buildNotasContacto(t1: unknown, t2: unknown): string {
  const parts = [t1, t2]
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean)
  return parts.join(' / ')
}

function parseExcelFile(file: File): Promise<ClientePreview[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data  = e.target?.result
        const wb    = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

        // Group by CUIT
        const map = new Map<string, typeof rows>()
        for (const row of rows) {
          const cuit = String(row['CUIT'] ?? '').trim()
          if (!cuit) continue
          if (!map.has(cuit)) map.set(cuit, [])
          map.get(cuit)!.push(row)
        }

        const clientes: ClientePreview[] = []
        for (const [cuit, grupo] of map.entries()) {
          const first       = grupo[0]
          const cuitDigits    = cuit.replace(/\D/g, '')
          const emailContacto = String(first['E_MAIL'] ?? '').trim().toLowerCase()
          const email         = `${cuitDigits}@rolito.app`   // Auth siempre sintético

          const addresses: import('../../types').DeliveryAddress[] = grupo.map((row, idx) => {
            const domicilio  = String(row['DOMICILIO']  ?? '').trim()
            const localidad  = String(row['LOCALIDAD']  ?? '').trim()
            const addressStr = [domicilio, localidad].filter(Boolean).join(', ')
            const cod        = String(row['COD_CTE '] ?? row['COD_CTE'] ?? '').trim()
            return {
              id:               cod || `addr-${idx}`,
              nombre:           cod || localidad || `Sucursal ${idx + 1}`,
              address:          addressStr,
              lat:              null,
              lng:              null,
              horarioApertura:  '',
              horarioCierre:    '',
              contactoNombre:   '',
              contactoTelefono: cleanPhoneDigits(row['TELEFONO_1']),
              esPrincipal:      idx === 0,
            }
          })

          clientes.push({
            cuit,
            cuitDigits,
            email,
            emailContacto,
            razonSocial:   String(first['RAZON_SOCI'] ?? '').trim(),
            codigoCliente: String(first['COD_CTE '] ?? first['COD_CTE'] ?? '').trim(),
            telefono:      cleanPhoneDigits(first['TELEFONO_1']),
            notasContacto: buildNotasContacto(first['TELEFONO_1'], first['TELEFONO_2']),
            fechaAlta:     excelSerialToDate(first['FECHA_ALTA'] as unknown),
            addresses,
            sucursales:    grupo.length,
          })
        }
        resolve(clientes)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}

function ImportarClientesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef                         = useRef<HTMLInputElement>(null)
  const [step, setStep]                 = useState<'pick' | 'preview' | 'importing' | 'done'>('pick')
  const [clientes, setClientes]         = useState<ClientePreview[]>([])
  const [parseError, setParseError]     = useState('')
  const [progress, setProgress]         = useState(0)
  const [total, setTotal]               = useState(0)
  const [created, setCreated]           = useState(0)
  const [skipped, setSkipped]           = useState(0)
  const [errors, setErrors]             = useState<string[]>([])
  const abortRef                        = useRef(false)

  const handleFile = async (file: File) => {
    setParseError('')
    try {
      const parsed = await parseExcelFile(file)
      setClientes(parsed)
      setStep('preview')
    } catch {
      setParseError('No se pudo leer el archivo. Verificá que sea un Excel válido (.xlsx).')
    }
  }

  const handleImport = async () => {
    abortRef.current = false
    setStep('importing')
    setProgress(0)
    setTotal(clientes.length)
    setCreated(0)
    setSkipped(0)
    setErrors([])

    let ok = 0, skip = 0
    const errs: string[] = []

    for (let i = 0; i < clientes.length; i++) {
      if (abortRef.current) break
      const c = clientes[i]
      try {
        await createClienteImportado({
          email:         c.email,
          password:      c.cuitDigits,
          razonSocial:   c.razonSocial,
          cuit:          c.cuit,
          telefono:      c.telefono,
          notasContacto: c.notasContacto,
          emailContacto: c.emailContacto,
          codigoCliente: c.codigoCliente,
          fechaAlta:     c.fechaAlta,
          addresses:     c.addresses,
        })
        ok++
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code
        if (code === 'auth/email-already-in-use') {
          skip++
        } else {
          errs.push(`${c.razonSocial} (${c.cuit}): ${(err as Error).message ?? 'Error desconocido'}`)
        }
      }
      setProgress(i + 1)
      setCreated(ok)
      setSkipped(skip)
      setErrors([...errs])
    }

    setStep('done')
  }

  const synCount  = clientes.filter((c) => !c.emailContacto).length
  const branchCount = clientes.reduce((sum, c) => sum + c.sucursales, 0)

  return (
    <Modal open wide onClose={step === 'importing' ? () => {} : onClose} title="Importar clientes desde Excel">
      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Seleccioná el archivo Excel con la nómina de clientes. Se crearán cuentas agrupadas por CUIT.
          </p>
          {parseError && <p className="text-sm text-red-400">{parseError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-[#D3D1C7] rounded-xl p-10 text-center cursor-pointer hover:border-accent transition-colors"
          >
            <p className="text-gray-500 text-sm">Hacé clic para seleccionar el archivo .xlsx</p>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-accent">{clientes.length.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Cuentas a crear</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{branchCount.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Sucursales totales</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{synCount.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Sin email real</p>
            </div>
          </div>

          <div className="bg-white border border-[#D3D1C7] rounded-xl p-3 text-xs text-gray-500 space-y-1">
            <p>• Todos los clientes ingresan con <span className="text-gray-900">CUIT + contraseña</span> (CUIT sin guiones)</p>
            <p>• El email del Excel se guarda solo como dato de contacto</p>
            <p>• {synCount.toLocaleString('es-AR')} clientes sin email de contacto registrado</p>
            <p>• Las cuentas ya existentes se omiten automáticamente</p>
          </div>

          <div className="max-h-48 overflow-y-auto border border-[#D3D1C7] rounded-xl">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#D3D1C7]">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Razón social</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">CUIT</th>
                  <th className="text-center px-3 py-2 text-gray-500 font-medium">Suc.</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Email contacto</th>
                </tr>
              </thead>
              <tbody>
                {clientes.slice(0, 200).map((c) => (
                  <tr key={c.cuit} className="border-b border-[#D3D1C7]/50 hover:bg-white/5">
                    <td className="px-3 py-1.5 text-white truncate max-w-[160px]">{c.razonSocial || '—'}</td>
                    <td className="px-3 py-1.5 text-white font-mono">{c.cuit}</td>
                    <td className="px-3 py-1.5 text-center text-white">{c.sucursales}</td>
                    <td className="px-3 py-1.5 font-mono truncate max-w-[160px]">
                      {c.emailContacto
                        ? <span className="text-gray-900">{c.emailContacto}</span>
                        : <span className="text-gray-500 italic">sin email</span>}
                    </td>
                  </tr>
                ))}
                {clientes.length > 200 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-center text-gray-500 italic">
                      … y {(clientes.length - 200).toLocaleString('es-AR')} más
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('pick')} className="flex-1">Volver</Button>
            <Button onClick={handleImport} className="flex-1">
              Importar {clientes.length.toLocaleString('es-AR')} cuentas
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="space-y-5 py-2">
          <p className="text-sm text-gray-500 text-center">
            Creando cuentas… no cierres esta ventana.
          </p>
          <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-[#D3D1C7]">
            <div
              className="bg-accent h-full transition-all duration-200"
              style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-center text-sm text-white">
            {progress.toLocaleString('es-AR')} / {total.toLocaleString('es-AR')}
            {' · '}
            <span className="text-green-400">{created} ok</span>
            {skipped > 0 && <span className="text-amber-400"> · {skipped} existentes</span>}
            {errors.length > 0 && <span className="text-red-400"> · {errors.length} errores</span>}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{created.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Creadas</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{skipped.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Ya existían</p>
            </div>
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{errors.length.toLocaleString('es-AR')}</p>
              <p className="text-xs text-gray-500 mt-1">Errores</p>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="max-h-36 overflow-y-auto bg-white border border-red-900/40 rounded-xl p-3 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-red-400 font-mono">{e}</p>
              ))}
            </div>
          )}

          <Button onClick={onDone} className="w-full">Cerrar y actualizar lista</Button>
        </div>
      )}
    </Modal>
  )
}
