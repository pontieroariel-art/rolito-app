import { memo } from 'react'
import { Printer } from 'lucide-react'

// Total de pallets del día en tipografía de tres metros (2026-09-14): el
// encargado lo lee desde el pasillo. En `memo` con primitivas: solo se repinta
// cuando cambia el número o el último pallet, no con cada toque en la grilla.
//
// Desde el 2026-09-25 el último pallet tiene su botón REIMPRIMIR (la etiqueta
// se trabó, se rompió, se cayó) y dice qué hacer si se cargó mal: antes el
// mensaje mandaba al "listado", que el operario no tiene.
export interface ContadorDiaProps {
  total:    number
  cargando: boolean
  /** Etiqueta grande del producto ("2KG"), hora "14:32" y código del último pallet de hoy. */
  ultimo:   { etiqueta: string; hora: string; codigo: string } | null
  onReimprimir: () => void
}

function ContadorDiaBase({ total, cargando, ultimo, onReimprimir }: ContadorDiaProps) {
  return (
    <section className="shrink-0 bg-white border border-[#D3D1C7] rounded-2xl pl-6 pr-3 py-2 flex items-center justify-between gap-4 h-[clamp(6rem,10.5vh,8.75rem)]">
      <div className="flex items-baseline gap-4">
        <span className="text-[clamp(4rem,9vh,7.25rem)] font-black leading-none text-gray-900 tabular-nums tracking-tight">
          {cargando && total === 0 ? '·' : total}
        </span>
        <span className="text-[clamp(1.1rem,2vh,1.625rem)] font-bold text-gray-900 leading-tight">{total === 1 ? 'pallet' : 'pallets'}<br />hoy</span>
      </div>
      {ultimo ? (
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col items-end gap-0.5 text-right min-w-0">
            <span className="text-xs font-bold tracking-wider text-secundario">ÚLTIMO</span>
            <span className="text-[clamp(1.1rem,2vh,1.625rem)] font-extrabold text-gray-900 leading-none">{ultimo.etiqueta} · {ultimo.hora}</span>
            <span className="text-base font-semibold text-secundario tabular-nums">{ultimo.codigo}</span>
            <span className="text-xs font-semibold text-secundario">¿Se cargó mal? Avisale al encargado</span>
          </div>
          <button
            type="button"
            onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); onReimprimir() } }}
            className="shrink-0 flex flex-col items-center justify-center gap-1 w-[clamp(5.5rem,9vh,7rem)] h-[clamp(4.5rem,8vh,6.5rem)] rounded-xl border-2 border-[#D3D1C7] bg-white text-gray-900 touch-manipulation select-none active:bg-gray-100"
            aria-label={`Reimprimir la etiqueta de ${ultimo.codigo}`}
          >
            <Printer size={26} />
            <span className="text-sm font-black leading-none">REIMPRIMIR</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-xs font-bold tracking-wider text-secundario">ÚLTIMO</span>
          <span className="text-base font-semibold text-secundario">Todavía nada hoy</span>
        </div>
      )}
    </section>
  )
}

const ContadorDia = memo(ContadorDiaBase)
export default ContadorDia
