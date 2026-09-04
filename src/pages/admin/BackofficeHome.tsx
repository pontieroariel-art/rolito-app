import { Link } from 'react-router-dom'
import {
  UserCog, Factory, Settings, Truck, Tag, Layers, ClipboardList, Users2, Package, LayoutDashboard,
  CalendarDays, History, Activity, Cloud, Users, Map, BarChart2, DollarSign, TrendingUp, Clock,
  Navigation, Snowflake, Wrench, ArrowLeftRight, FileText,
} from 'lucide-react'

interface CardLink {
  to:          string
  label:       string
  description: string
  icon:        React.ComponentType<{ size?: number; className?: string }>
}

interface CardSection {
  id:    string
  title: string
  cards: CardLink[]
}

// Punto de entrada del Backoffice: desde acá se llega a cada parte
// administrable de la app. "Usuarios & Roles" y "Ajustes generales" viven
// en este mismo layout (BackofficeLayout). El resto son cross-links a
// pantallas que se quedan en su layout operativo de siempre (las sigue
// usando gente que no es super_admin como parte de su trabajo diario —
// ver plan de migración).
const SECTIONS: CardSection[] = [
  {
    id: 'gerencia', title: 'Gerencia',
    cards: [
      { to: '/gerente', label: 'Panel de directores', description: 'Resumen ejecutivo de solo lectura: logística, heladeras y producción.', icon: LayoutDashboard },
    ],
  },
  {
    id: 'admin', title: 'Administración',
    cards: [
      { to: '/admin/usuarios', label: 'Usuarios & Roles',  description: 'Alta de personal, asignación de rol y permisos por pestaña.', icon: UserCog },
      { to: '/admin/general',  label: 'Ajustes generales', description: 'Configuración global del sistema.',                          icon: Settings },
      { to: '/usuarios',              label: 'Clientes (CRM)', description: 'Alta, edición y ficha de clientes.',      icon: Users },
      { to: '/admin/mapa-clientes',   label: 'Mapa de clientes', description: 'Ubicación geográfica de la cartera.',    icon: Map },
      { to: '/movimientos',           label: 'Movimientos',    description: 'Historial unificado de la operación.',    icon: BarChart2 },
      { to: '/admin/recupero-facturas', label: 'Recupero de facturas', description: 'Reimprime las facturas viejas de Tango con el formato de siempre.', icon: FileText },
      { to: '/sistema',               label: 'Selección de sistema', description: 'Vista del selector que usan los roles con más de un sistema.', icon: ArrowLeftRight },
    ],
  },
  {
    id: 'logistica-operacion', title: 'Logística — Operación',
    cards: [
      { to: '/logistica',                label: 'Despacho',         description: 'Tablero de despacho drag & drop del día.',  icon: CalendarDays },
      { to: '/admin/historial-despacho', label: 'Hist. despacho',   description: 'Despachos de días anteriores.',              icon: History },
      { to: '/admin/monitoreo',          label: 'Monitoreo',        description: 'Seguimiento en vivo de camiones y pedidos.', icon: Activity },
      { to: '/admin/visitas',            label: 'Visitas',          description: 'Planificación de visitas comerciales.',      icon: ClipboardList },
      { to: '/admin/incidencias',        label: 'Incidencias',      description: 'Reporte de incidencias de reparto.',         icon: ClipboardList },
      { to: '/admin/clima',              label: 'Clima',            description: 'Pronóstico para planificar reparto.',        icon: Cloud },
    ],
  },
  {
    id: 'logistica', title: 'Configuración — Logística',
    cards: [
      { to: '/admin/flota',   label: 'Flota',   description: 'Camiones, patentes y canales de reparto.', icon: Truck },
      { to: '/admin/precios', label: 'Precios',  description: 'Listas de precios y catálogo.',            icon: Tag },
    ],
  },
  {
    id: 'comercial', title: 'Comercial',
    cards: [
      { to: '/comercial',                  label: 'Tablero comercial',   description: 'Panel de trabajo del equipo comercial.',      icon: LayoutDashboard },
      { to: '/comercial/mapa',             label: 'Reparto en vivo',     description: 'Mapa de camiones en ruta.',                    icon: Navigation },
      { to: '/comercial/reporte-precios',  label: 'Reporte de precios',  description: 'Precios vigentes y desvíos por cliente.',      icon: DollarSign },
      { to: '/comercial/ventas',           label: 'Ventas',              description: 'Reporte de ventas.',                           icon: TrendingUp },
      { to: '/comercial/historial-precios', label: 'Historial de precios', description: 'Cambios de precio a lo largo del tiempo.',   icon: Clock },
    ],
  },
  {
    id: 'heladeras-operacion', title: 'Heladeras — Operación',
    cards: [
      { to: '/heladeras',                 label: 'Heladeras',          description: 'Hub del módulo de heladeras.',              icon: Snowflake },
      { to: '/heladeras/taller',          label: 'Taller',             description: 'Tickets de service en taller.',             icon: Wrench },
      { to: '/heladeras/asignacion',      label: 'Asignación de equipos', description: 'Asignar heladeras a clientes.',          icon: Package },
      { to: '/heladeras/ranking',         label: 'Ranking de consumo', description: 'Consumo de hielo por heladera/cliente.',    icon: BarChart2 },
      { to: '/heladeras/consulta-service', label: 'Consulta service',  description: 'Buscar el historial de service de un equipo.', icon: ClipboardList },
      { to: '/heladeras/toma-service',    label: 'Toma de service',    description: 'Cargar un nuevo pedido de service.',        icon: ClipboardList },
      { to: '/heladeras/informes',        label: 'Informes',           description: 'Reportes del módulo de heladeras.',         icon: Activity },
      { to: '/heladeras/mapa',            label: 'Mapa de heladeras',  description: 'Ubicación geográfica de los equipos.',      icon: Map },
    ],
  },
  {
    id: 'heladeras', title: 'Configuración — Heladeras',
    cards: [
      { to: '/heladeras/modelos',   label: 'Modelos',            description: 'Catálogo de modelos de heladera.',        icon: Layers },
      { to: '/heladeras/catalogos', label: 'Catálogos de service', description: 'Motivos y tipos de reparación.',        icon: ClipboardList },
      { to: '/heladeras/tecnicos',  label: 'Técnicos',           description: 'Alta y gestión de técnicos de calle.',    icon: Users2 },
      { to: '/heladeras/equipos',   label: 'Padrón de equipos',  description: 'Registro de heladeras (unidades físicas).', icon: Package },
      { to: '/heladeras/panol',     label: 'Pañol de repuestos', description: 'Stock y catálogo de repuestos.',          icon: Package },
    ],
  },
  {
    id: 'produccion', title: 'Configuración — Producción',
    cards: [
      { to: '/produccion/operarios', label: 'Operarios',        description: 'Alta y gestión de operarios de planta.', icon: Factory },
      { to: '/produccion/listado',   label: 'Listado',          description: 'Pallets cargados por planta.',           icon: ClipboardList },
    ],
  },
]

export default function BackofficeHome() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 space-y-8 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backoffice</h1>
          <p className="text-gray-500 text-sm">Administración centralizada de Rolito.</p>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.id} className="space-y-3">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">{section.title}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.cards.map((card) => (
                <Link
                  key={card.to}
                  to={card.to}
                  className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex items-start gap-3 hover:border-accent/50 hover:shadow-sm transition-all"
                >
                  <div className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <card.icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{card.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
