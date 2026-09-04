// Placeholder — futuro home de configuración global del sistema y, cuando
// esté el bridge Node hacia Tango Gestión, del estado de esa sincronización
// (última corrida, errores, mapeos). Por ahora no hay ajustes globales que
// mostrar acá; se agregan a medida que aparecen.
export default function AjustesGeneralesPage() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-5xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ajustes generales</h1>
          <p className="text-gray-500 text-sm">Configuración global del sistema.</p>
        </div>
        <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">Todavía no hay ajustes generales configurables acá.</p>
        </div>
      </main>
    </div>
  )
}
