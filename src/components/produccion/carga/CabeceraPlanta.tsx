import { memo } from 'react'
import { Bluetooth, Printer, WifiOff } from 'lucide-react'
import { hayImpresoraGuardada, type EstadoImpresora } from '@/services/zebraBleService'

// Cabecera mínima de la tablet de planta (2026-09-14): en vez del Navbar
// completo, que en una tablet lenta suma nodos y suscripciones que acá no se
// usan. Nombre, planta, conexión, impresora y salir.
export interface CabeceraPlantaProps {
  nombre:  string
  planta:  string
  online:  boolean
  /** Zebra por Bluetooth: estado, nombre del dispositivo y las dos acciones. */
  impresora: { estado: EstadoImpresora; nombre: string | null; onConectar: () => void; onProbar: () => void }
  onSalir: () => void
}

function CabeceraPlantaBase({ nombre, planta, online, impresora, onSalir }: CabeceraPlantaProps) {
  const conectada = impresora.estado === 'conectada' || impresora.estado === 'imprimiendo'
  // Ya se usó la Zebra en esta tablet y se cayó: se reconecta sola, pero se avisa en ámbar.
  const caida = !conectada && hayImpresoraGuardada()
  return (
    <header className="shrink-0 flex items-center justify-between gap-3 h-12">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 leading-tight truncate">Hola, {nombre}</h1>
        <p className="text-sm text-secundario leading-tight">{planta}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!online && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-500/40 px-3 py-1.5 text-sm font-semibold text-amber-700">
            <WifiOff size={16} /> Sin conexión
          </span>
        )}
        {/* Impresora: sin Bluetooth web no se muestra nada (se imprime por el
            diálogo de siempre); sin conectar es un botón grande; conectada es
            un chip verde con "Prueba" al lado para calibrar el rollo. */}
        {impresora.estado === 'sin_soporte' ? null : conectada ? (
          <>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#E6F5EF] px-3 h-11 text-sm font-semibold text-[#0F6B4E]" title={impresora.nombre ?? undefined}>
              <Printer size={16} /> {impresora.estado === 'imprimiendo' ? 'Imprimiendo…' : 'Impresora lista'}
            </span>
            <button type="button" onClick={impresora.onProbar}
              className="h-11 px-3 rounded-xl border border-[#D3D1C7] bg-white text-sm font-bold text-secundario touch-manipulation active:bg-gray-50">
              Prueba
            </button>
          </>
        ) : (
          <button type="button" onClick={impresora.onConectar} disabled={impresora.estado === 'conectando'}
            className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl text-white text-base font-bold touch-manipulation active:opacity-90 disabled:opacity-60 ${caida ? 'bg-amber-600' : 'bg-accent'}`}>
            <Bluetooth size={18} /> {impresora.estado === 'conectando' ? 'Conectando…' : caida ? 'Impresora desconectada' : 'Conectar impresora'}
          </button>
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
