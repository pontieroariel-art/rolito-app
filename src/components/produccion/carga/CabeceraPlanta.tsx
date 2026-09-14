import { memo } from 'react'
import { WifiOff } from 'lucide-react'

// Cabecera mínima de la tablet de planta (2026-09-14): en vez del Navbar
// completo, que en una tablet lenta suma nodos y suscripciones que acá no se
// usan. Nombre, planta, estado de conexión y salir.
export interface CabeceraPlantaProps {
  nombre:  string
  planta:  string
  online:  boolean
  onSalir: () => void
}

function CabeceraPlantaBase({ nombre, planta, online, onSalir }: CabeceraPlantaProps) {
  return (
    <header className="shrink-0 flex items-center justify-between gap-3 h-12">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 leading-tight truncate">Hola, {nombre}</h1>
        <p className="text-sm text-secundario leading-tight">{planta}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {online ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-[#E6F5EF] px-3 py-1.5 text-sm font-semibold text-[#0F6B4E]">
            <span className="h-2 w-2 rounded-full bg-accent" /> Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-500/40 px-3 py-1.5 text-sm font-semibold text-amber-700">
            <WifiOff size={16} /> Sin conexión
          </span>
        )}
        <button
          type="button"
          onClick={onSalir}
          className="h-11 px-4 rounded-xl border border-[#D3D1C7] bg-white text-base font-bold text-secundario touch-manipulation active:bg-gray-50"
        >
          Salir
        </button>
      </div>
    </header>
  )
}

const CabeceraPlanta = memo(CabeceraPlantaBase)
export default CabeceraPlanta
