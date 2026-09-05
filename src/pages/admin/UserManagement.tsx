import { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react'
import { coincideBusqueda } from '@/utils/busqueda'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNavigate, useLocation } from 'react-router-dom'
import { MapPin } from 'lucide-react'
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
import { registrarAccionAlto } from '../../services/historialAdminService'
import { UserProfile, UserRole, UserStatus, DeliveryAddress } from '../../types'
import { SucursalFlat, ALL_STATUSES, STATUS_LABELS, ROLE_LABELS } from './user-management/shared'
import { CrearStaffModal } from './user-management/CrearStaffModal'
import { CrearClienteModal } from './user-management/CrearClienteModal'
import { ImportarClientesModal } from './user-management/ImportarClientesModal'
import { SucursalClienteRow } from './user-management/SucursalClienteRow'
import { UserRow } from './user-management/UserRow'
import { FichaClienteModal } from './user-management/FichaClienteModal'
import { reportError } from '@/services/observability'

const PAGE_SIZE = 50

export default function UserManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  // Clientes y Usuarios son dos entradas de sidebar separadas (/usuarios,
  // operativa, en LogisticaLayout; /admin/usuarios, Backoffice, solo
  // super_admin) que renderizan este mismo componente — la vista activa
  // se deriva de la ruta en vez de un estado de tab manejado con botones.
  const tab: 'clientes' | 'equipo' = location.pathname === '/admin/usuarios' ? 'equipo' : 'clientes'
  const { user: currentUser }           = useAuth()
  const [clientes, setClientes]         = useState<UserProfile[]>([])
  const [equipo, setEquipo]             = useState<UserProfile[]>([])
  const [loadingClientes, setLoadingClientes] = useState(false)
  const [loadingEquipo, setLoadingEquipo]     = useState(false)
  const clientesLoadedRef               = useRef(false)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [sectorFilter, setSectorFilter] = useState<string>('all')
  const [rolFilter, setRolFilter]       = useState<UserRole | 'all'>('all')
  const [visibleCount, setVisibleCount]           = useState(PAGE_SIZE)
  const [crearModal, setCrearModal]               = useState(false)
  const [crearClienteModal, setCrearClienteModal] = useState(false)
  const [importarModal, setImportarModal]         = useState(false)
  // Ficha abierta desde "Ir a la ficha de..." en CrearClienteModal (CUIT
  // repetido) — independiente del fichaModal local de cada SucursalClienteRow.
  const [fichaModalTarget, setFichaModalTarget]   = useState<UserProfile | null>(null)

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

  // Al navegar entre /usuarios y /admin/usuarios se resetean filtros y
  // paginado, igual que hacía el viejo handleTabChange al clickear una tab.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setSearch('')
    setSectorFilter('all')
    setRolFilter('all')
  }, [tab])

  const sectors = useMemo(() => {
    const set = new Set<string>()
    clientes.filter((u) => u.sector).forEach((u) => set.add(u.sector!))
    return Array.from(set).sort()
  }, [clientes])

  // Funciones (roles) presentes en el equipo — solo las que hay, no el
  // catálogo completo de roles del sistema.
  const roles = useMemo(() => {
    const set = new Set<UserRole>()
    equipo.forEach((u) => set.add(u.rol))
    return Array.from(set).sort((a, b) => ROLE_LABELS[a].localeCompare(ROLE_LABELS[b]))
  }, [equipo])

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
      const matchSearch = coincideBusqueda(q, u.razonSocial, u.nombre, u.cuit, u.codigoCliente, addr?.id, addr?.nombre, addr?.address)
      const matchStatus = statusFilter === 'all' || u.estado === statusFilter
      const matchSector = sectorFilter === 'all' || u.sector === sectorFilter
      return matchSearch && matchStatus && matchSector
    })
  }, [sucursalesFlat, search, statusFilter, sectorFilter])

  const loading = tab === 'clientes' ? loadingClientes : loadingEquipo

  // filtered sólo se usa para el tab equipo
  const filtered = equipo.filter((u) => {
    const q           = search.toLowerCase()
    const matchSearch = coincideBusqueda(q, u.nombre, u.razonSocial, u.email)
    const matchStatus = statusFilter === 'all' || u.estado === statusFilter
    const matchSector = sectorFilter === 'all' || u.sector === sectorFilter
    const matchRol     = rolFilter === 'all' || u.rol === rolFilter
    return matchSearch && matchStatus && matchSector && matchRol
  })

  const handleRole = async (uid: string, rol: UserRole) => {
    const anterior = equipo.find((u) => u.uid === uid)
    await updateUserRole(uid, rol)
    setEquipo((prev) => prev.map((u) => u.uid === uid ? { ...u, rol } : u))
    setClientes((prev) => prev.map((u) => u.uid === uid ? { ...u, rol } : u))
    if (currentUser && anterior) {
      registrarAccionAlto({
        coleccion: 'users',
        docId:     uid,
        accion:    'rol_cambiado',
        detalle:   `${anterior.nombreContacto || anterior.nombre} — ${ROLE_LABELS[anterior.rol]} → ${ROLE_LABELS[rol]}`,
        actor:     { uid: currentUser.uid, nombre: currentUser.nombre, rol: currentUser.rol },
      }).catch((err) => reportError(err, { origen: 'UserManagement', accion: 'no se pudo registrar rol_cambiado' }))
    }
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
    // Solo se audita la baja de personal (equipo) — desactivar un cliente es
    // rutina comercial, no una acción administrativa de riesgo.
    if (currentUser && tab === 'equipo' && newEstado === 'inactivo') {
      registrarAccionAlto({
        coleccion: 'users',
        docId:     u.uid,
        accion:    'usuario_desactivado',
        detalle:   `${u.nombreContacto || u.nombre} (${ROLE_LABELS[u.rol]})`,
        actor:     { uid: currentUser.uid, nombre: currentUser.nombre, rol: currentUser.rol },
      }).catch((err) => reportError(err, { origen: 'UserManagement', accion: 'no se pudo registrar usuario_desactivado' }))
    }
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
  )

  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{tab === 'clientes' ? 'Clientes' : 'Usuarios'}</h1>
            <p className="text-gray-500 text-sm">
              {tab === 'clientes' ? `${sucursalesFlat.length} sucursales` : `${equipo.length} personas del equipo`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 && ['super_admin', 'gerente_comercial'].includes(currentUser?.rol ?? '') && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 text-sm text-amber-700">
                {pendingCount} borrador{pendingCount > 1 ? 'es' : ''}
              </div>
            )}
            {tab === 'equipo' && currentUser?.rol === 'super_admin' && (
              <Button variant="outline" onClick={() => navigate('/produccion/operarios')} className="text-sm">
                Operarios de producción →
              </Button>
            )}
            {tab === 'equipo' && currentUser?.rol === 'super_admin' && (
              <Button onClick={() => setCrearModal(true)} className="text-sm">
                + Crear usuario
              </Button>
            )}
            {tab === 'clientes' && ['super_admin', 'gerente_comercial', 'comercial', 'logistica'].includes(currentUser?.rol ?? '') && (
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
            {tab === 'equipo' && roles.length > 0 && (
              <Select value={rolFilter} onValueChange={(v) => { setRolFilter(v as UserRole | 'all'); setVisibleCount(PAGE_SIZE) }}>
                <SelectTrigger className="flex-1 min-w-[130px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las funciones</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(search || statusFilter !== 'all' || sectorFilter !== 'all' || rolFilter !== 'all') && (
              <button
                onClick={() => { setSearch(''); setStatusFilter('all'); setSectorFilter('all'); setRolFilter('all'); setVisibleCount(PAGE_SIZE) }}
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
                    onToggleStatus={handleToggleStatus}
                    onApprove={handleApprove}
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
                    onRoleChange={handleRole}
                    onSubrolChange={handleSubrol}
                    onToggleStatus={handleToggleStatus}
                    onApprove={handleApprove}
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
          existingClientes={clientes}
          onGoToExisting={(u) => { setCrearClienteModal(false); setFichaModalTarget(u) }}
        />
      )}
      {fichaModalTarget && (
        <FichaClienteModal
          user={fichaModalTarget}
          currentUser={currentUser}
          onClose={() => setFichaModalTarget(null)}
          onAddressesChanged={(addresses) => handleAddressesChanged(fichaModalTarget.uid, addresses)}
          onVisitaChanged={(esVisita, frecuenciaVisita) => handleVisitaChanged(fichaModalTarget.uid, esVisita, frecuenciaVisita)}
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
