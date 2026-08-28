import { Link } from 'react-router-dom'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ProduccionResumen } from '../../components/produccion/ProduccionResumen'
import { useProduccionPallets } from '../../hooks/useProduccionPallets'
import { PLANTAS } from '../../types'

// Pantalla de entrada del encargado de producción (home del rol, ver
// ROLE_HOME en Landing.tsx): KPIs del período + últimos pallets cargados.
// La gestión (operarios, correlativos) vive en sus propios paneles.
const ULTIMOS_PALLETS = 8

export default function ProduccionResumenPage() {
  // Ya vienen ordenados por createdAt desc (subscribePalletsRecientes)
  const { pallets, loading } = useProduccionPallets(undefined)
  const ultimos = pallets.slice(0, ULTIMOS_PALLETS)

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Producción</h1>
        <p className="text-gray-500 text-sm">Resumen de planta</p>
      </div>

      <ProduccionResumen />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Últimos pallets</h2>
          <Link to="/produccion/listado" className="text-sm text-accent hover:underline">Ver listado completo →</Link>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : ultimos.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-6 text-center">
            <p className="text-gray-400 text-sm">Todavía no hay pallets cargados.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#D3D1C7] rounded-xl divide-y divide-[#D3D1C7]/60">
            {ultimos.map((p) => (
              <div key={p.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link to={`/produccion/ficha/${p.id}`} className="text-sm font-medium text-accent hover:underline">
                    {p.codigo}
                  </Link>
                  <p className="text-xs text-gray-500 truncate">
                    {p.productoNombre} · {p.unidades} u. · {p.operador.nombre}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-600">{PLANTAS[p.plantaId].label}</p>
                  <p className="text-xs text-gray-400">
                    {p.fechaFabricacion.toDate().toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
