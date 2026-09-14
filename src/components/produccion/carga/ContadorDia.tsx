import { memo } from 'react'

// Total de pallets del día en tipografía de tres metros (2026-09-14): el
// encargado lo lee desde el pasillo. En `memo` con primitivas: solo se repinta
// cuando cambia el número o el último pallet, no con cada toque en la grilla.
export interface ContadorDiaProps {
  total:    number
  cargando: boolean
  /** Etiqueta grande del producto ("2KG"), hora "14:32" y código del último pallet de hoy. */
  ultimo:   { etiqueta: string; hora: string; codigo: string } | null
}

function ContadorDiaBase({ total, cargando, ultimo }: ContadorDiaProps) {
  return (
    <section className="shrink-0 bg-white border border-[#D3D1C7] rounded-2xl px-6 py-2 flex items-center justify-between gap-4 h-[clamp(6rem,10.5vh,8.75rem)]">
      <div className="flex items-baseline gap-4">
        <span className="text-[clamp(4rem,9vh,7.25rem)] font-black leading-none text-gray-900 tabular-nums tracking-tight">
          {cargando && total === 0 ? '·' : total}
        </span>
        <span className="text-[clamp(1.1rem,2vh,1.625rem)] font-bold text-gray-900 leading-tight">pallets<br />hoy</span>
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <span className="text-xs font-bold tracking-wider text-secundario">ÚLTIMO</span>
        {ultimo ? (
          <>
            <span className="text-[clamp(1.1rem,2vh,1.625rem)] font-extrabold text-gray-900 leading-none">{ultimo.etiqueta} · {ultimo.hora}</span>
            <span className="text-base font-semibold text-secundario">{ultimo.codigo}</span>
          </>
        ) : (
          <span className="text-base font-semibold text-secundario">Todavía nada hoy</span>
        )}
      </div>
    </section>
  )
}

const ContadorDia = memo(ContadorDiaBase)
export default ContadorDia
