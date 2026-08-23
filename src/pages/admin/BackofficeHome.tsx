import { Link } from 'react-router-dom'
import { UserCog, Factory, Settings, Truck, Tag, Layers, ClipboardList, Users2, Package } from 'lucide-react'

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
    id: 'admin', title: 'Administración',
    cards: [
      { to: '/admin/usuarios', label: 'Usuarios & Roles',  description: 'Alta de personal, asignación de rol y permisos por pestaña.', icon: UserCog },
      { to: '/admin/general',  label: 'Ajustes generales', description: 'Configuración global del sistema.',                          icon: Settings },
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
    <div className="min-h-screen bg-[#F1EFE8] text-gray-900">
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
