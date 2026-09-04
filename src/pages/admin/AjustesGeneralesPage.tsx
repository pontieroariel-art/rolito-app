import SyncPreciosTangoPanel from '../../components/admin/SyncPreciosTangoPanel'

// Home de configuración global. Por ahora: estado de las sincronizaciones con
// Tango (clientes, precios, saldos) y sus botones de "Sincronizar ahora".
// Los mapeos (artículos, depósitos, vendedores, talonarios) siguen en
// config/tango vía scripts/tango/configurar-ventas-tango.mjs.
export default function AjustesGeneralesPage() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ajustes generales</h1>
          <p className="text-gray-500 text-sm">Configuración global del sistema.</p>
        </div>
        <SyncPreciosTangoPanel />
      </main>
    </div>
  )
}
