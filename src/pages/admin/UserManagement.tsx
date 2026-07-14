import { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNavigate } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
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
} from '../../services/userService'
import { useAllListasPrecios } from '../../hooks/useListasPrecios'
import { UserProfile, UserRole, UserStatus, DeliveryAddress } from '../../types'
import { SucursalFlat, ALL_STATUSES, STATUS_LABELS } from './user-management/shared'
import { CrearStaffModal } from './user-management/CrearStaffModal'
import { CrearClienteModal } from './user-management/CrearClienteModal'
import { ImportarClientesModal } from './user-management/ImportarClientesModal'
import { SucursalClienteRow } from './user-management/SucursalClienteRow'
import { UserRow } from './user-management/UserRow'

const PAGE_SIZE = 50

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
    // El email de aprobación lo envía el trigger onUserApproved server-side.
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

        {/* Tabs — Equipo solo para quienes gestionan staff/choferes */}
        <div className="flex border-b border-gray-200 gap-1">
          {(['super_admin', 'logistica'].includes(currentUser?.rol ?? '')
            ? (['clientes', 'equipo'] as const)
            : (['clientes'] as const)
          ).map((t) => (
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
                : `Equipo (${equipo.length})`}
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
