import { memo, type PointerEvent, type KeyboardEvent } from 'react'
import { Printer, Snowflake } from 'lucide-react'
import type { ProductoHieloDef } from '@/utils/produccionCatalogo'
import type { ProductoHieloId } from '@/types'

// Tarjeta de un producto en la grilla de carga (2026-09-14). Pensada para una
// tablet vieja y manos con guantes:
// - responde en `pointerdown` (no espera al click), sin animación en JS;
// - está en `memo` con props primitivas (+ el producto, que es una constante
//   del catálogo) para que un snapshot o un tick no la repinte si nada suyo
//   cambió;
// - `armado` = primer toque dado: la tarjeta muestra la banda CONFIRMAR E
//   IMPRIMIR y el segundo toque confirma. Decisión de Ariel (14/09): la
//   confirmación vive en la misma tarjeta, sin modal ni barra abajo.
export interface TileProductoProps {
  producto:      ProductoHieloDef
  /** Pallets de este producto cargados hoy. */
  hoy:           number
  armado:        boolean
  /** Código que va a salir si se confirma (solo cuando está armada). */
  codigoProximo: string | null
  disabled:      boolean
  /** El último producto ocupa las dos columnas cuando la cuenta es impar. */
  spanDos:       boolean
  onTap:         (id: ProductoHieloId) => void
}

function TileProductoBase({ producto: p, hoy, armado, codigoProximo, disabled, spanDos, onTap }: TileProductoProps) {
  const tocar = (e: PointerEvent<HTMLButtonElement>) => {
    // Solo el botón principal del mouse; en táctil `button` es 0 siempre.
    if (e.button !== 0 || disabled) return
    e.preventDefault()
    onTap(p.id)
  }
  const teclado = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); onTap(p.id) }
  }

  const base = 'relative flex flex-col items-center justify-center rounded-2xl select-none touch-manipulation active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none focus:outline-none'
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={tocar}
      onKeyDown={teclado}
      aria-pressed={armado}
      aria-label={armado ? `${p.nombre}: confirmar e imprimir` : `${p.nombre}, ${hoy} hoy`}
      className={`${base} ${spanDos ? 'col-span-2' : ''} ${armado ? 'gap-2 px-3 bg-white border-[8px]' : 'gap-0.5 border-[4px]'}`}
      style={{
        borderColor: p.color,
        backgroundColor: armado ? '#ffffff' : `${p.color}14`,
        boxShadow: armado ? `0 0 0 6px ${p.color}55` : undefined,
      }}
    >
      {/* Conteo del día de ESTE producto, en la esquina: dato, no adorno. */}
      <span className="absolute top-2 right-3 flex flex-col items-center leading-none">
        <span className="text-[clamp(1.6rem,3.4vh,2.5rem)] font-black text-gray-900 tabular-nums">{hoy}</span>
        <span className="text-[11px] font-bold tracking-wider text-secundario">HOY</span>
      </span>

      {armado ? (
        <>
          <span className="flex items-baseline gap-3">
            <span className="text-[clamp(1.6rem,4.6vh,3.25rem)] font-black leading-none" style={{ color: p.color }}>{p.etiquetaGrilla}</span>
            <span className="text-[clamp(0.85rem,1.9vh,1.125rem)] font-bold text-gray-900">{p.nombre}</span>
          </span>
          <span className="flex w-full items-center justify-center gap-3 rounded-xl bg-accent text-white h-[clamp(3.25rem,7vh,4.75rem)]">
            <Printer size={30} />
            <span className="text-[clamp(1.1rem,2.4vh,1.625rem)] font-black tracking-wide leading-none">CONFIRMAR E IMPRIMIR</span>
          </span>
          <span className="text-[clamp(0.75rem,1.5vh,0.95rem)] font-semibold text-secundario text-center leading-tight">
            {codigoProximo ? `Sale como ${codigoProximo} · ` : ''}tocá otro producto para cambiar
          </span>
        </>
      ) : (
        <>
          <Snowflake size={18} style={{ color: p.color }} />
          <span className="text-[clamp(1.1rem,5.2vh,3.75rem)] font-black leading-none" style={{ color: p.color }}>{p.etiquetaGrilla}</span>
          <span className="text-[clamp(0.75rem,2.1vh,1.25rem)] font-bold text-gray-900 text-center leading-tight px-3">{p.nombre}</span>
          <span className="text-[clamp(0.6rem,1.6vh,1rem)] font-semibold text-secundario">{p.unidadesPorPallet} {p.unidadLabel} / pallet</span>
        </>
      )}
    </button>
  )
}

const TileProducto = memo(TileProductoBase)
export default TileProducto
