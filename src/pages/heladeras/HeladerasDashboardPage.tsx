import { useMemo, useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Truck, Wrench, Search } from 'lucide-react'
import Button from '../../components/ui/Button'
import KpiCard from '../../components/heladeras/dashboard/KpiCard'
import ColaTallerResumen from '../../components/heladeras/dashboard/ColaTallerResumen'
import ActividadRecienteFeed from '../../components/heladeras/dashboard/ActividadRecienteFeed'
import CrearHeladeraModal, { CrearHeladeraData } from '../../components/heladeras/CrearHeladeraModal'
import { useAuth } from '../../context/AuthContext'
import { useHeladeras } from '../../hooks/useHeladeras'
import { useTicketsServicio } from '../../hooks/useTicketsServicio'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { crearHeladera } from '../../services/heladeraService'

// Centro de control operativo del módulo heladeras — reemplaza la grilla
// estática de HeladerasHubPage. Todos los conteos son client-side sobre las
// mismas suscripciones que ya usa InformesDashboardPage.tsx (useHeladeras +
// useTicketsServicio), sin filtros server-side nuevos.
export default function HeladerasDashboardPage() {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const { heladeras }             = useHeladeras()
  const { tickets }               = useTicketsServicio()
  const { pasos: catalogo }       = usePasosTaller()
  const [crearModal, setCrearModal] = useState(false)
  const [busqueda, setBusqueda]     = useState('')

  const actor = user ? { uid: user.uid, nombre: user.nombre } : null

  const kpis = useMemo(() => {
    const disponibles = heladeras.filter((h) => h.estado === 'disponible').length
    const enTaller     = heladeras.filter((h) => h.estado === 'en_taller').length
    const enComodato   = heladeras.filter((h) => h.estado === 'en_comodato').length
    const pendientes = tickets.filter((t) => ['abierto', 'asignado_tecnico', 'asignado_chofer'].includes(t.estado))
    const urgentes = pendientes.filter((t) => t.urgente)
    return { disponibles, enTaller, enComodato, pendientes: pendientes.length, urgentes: urgentes.length }
  }, [heladeras, tickets])

  const handleBuscar = (e: FormEvent) => {
    e.preventDefault()
    const q = busqueda.trim()
    navigate(q ? `/heladeras/equipos?q=${encodeURIComponent(q)}` : '/heladeras/equipos')
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Heladeras</h1>
        <p className="text-gray-500 text-sm">Centro de control operativo</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCard to="/heladeras/informes" value={kpis.disponibles} label="Disponibles en depósito" tone="good" />
        <KpiCard to="/heladeras/taller" value={kpis.enTaller} label="En taller" />
        <KpiCard
          to="/heladeras/consulta-service"
          value={kpis.pendientes}
          label="Tickets pendientes"
          tone={kpis.urgentes > 0 ? 'warn' : undefined}
          subtitle={kpis.urgentes > 0 ? `${kpis.urgentes} urgentes` : undefined}
        />
        <KpiCard to="/heladeras/asignacion" value={kpis.enComodato} label="En comodato activo" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCrearModal(true)} className="text-sm flex items-center gap-1.5">
          <Plus size={15} /> Ingreso a depósito
        </Button>
        <Button variant="outline" onClick={() => navigate('/heladeras/asignacion')} className="text-sm flex items-center gap-1.5">
          <Truck size={15} /> Asignar comodato
        </Button>
        <Button variant="outline" onClick={() => navigate('/heladeras/toma-service')} className="text-sm flex items-center gap-1.5">
          <Wrench size={15} /> Nuevo ticket de service
        </Button>
        <form onSubmit={handleBuscar} className="flex-1 min-w-[220px] relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o serie…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </form>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ColaTallerResumen />
        <ActividadRecienteFeed />
      </div>

      {crearModal && actor && (
        <CrearHeladeraModal
          onClose={() => setCrearModal(false)}
          onSave={(data: CrearHeladeraData) => crearHeladera(data, actor, catalogo)}
        />
      )}
    </div>
  )
}
