import { memo, type PointerEvent, type KeyboardEvent } from 'react'
import { Snowflake } from 'lucide-react'
import type { ProductoHieloDef } from '@/utils/produccionCatalogo'
import type { ProductoHieloId } from '@/types'

// Tarjeta de un producto en la grilla de carga (2026-09-14). Pensada para una
// tablet vieja y manos con guantes:
// - responde en `pointerdown` (no espera al click), sin animación en JS;
// - está en `memo` con props primitivas (+ el producto, que es una constante
//   del catálogo) para que un snapshot o un tick no la repinte si nada suyo
//   cambió.
// Desde el 2026-09-25 (decisión de Ariel) el toque abre la VENTANA de
// confirmación (ConfirmarPallet): la confirmación adentro de la tarjeta no
// entraba en media pantalla con la tablet en vertical. `seleccionada` solo
// marca cuál se tocó mientras la ventana está abierta.
export interface TileProductoProps {
  producto:     ProductoHieloDef
  /** Pallets de este producto cargados hoy. */
  hoy:          number
  seleccionada: boolean
  disabled:     boolean
  /** El último producto ocupa las dos columnas cuando la cuenta es impar. */
  spanDos:      boolean
  onTap:        (id: ProductoHieloId) => void
}

function TileProductoBase({ producto: p, hoy, seleccionada, disabled, spanDos, onTap }: TileProductoProps) {
  const tocar = (e: PointerEvent<HTMLButtonElement>) => {
    // Solo el botón principal del mouse; en táctil `button` es 0 siempre.
    if (e.button !== 0 || disabled) return
    e.preventDefault()
    onTap(p.id)
  }
  const teclado = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); onTap(p.id) }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={tocar}
      onKeyDown={teclado}
      aria-label={`${p.nombre}, ${hoy} hoy`}
      className={`relative flex flex-col items-center justify-center gap-0.5 rounded-2xl border-[4px] px-3 select-none touch-manipulation active:opacity-80 disabled:opacity-60 disabled:pointer-events-none focus:outline-none ${spanDos ? 'col-span-2' : ''}`}
      style={{
        borderColor: p.color,
        backgroundColor: seleccionada ? `${p.color}33` : `${p.color}14`,
      }}
    >
      {/* Conteo del día de ESTE producto, en la esquina: dato, no adorno. */}
      <span className="absolute top-2 right-3 flex flex-col items-center leading-none">
        <span className="text-[clamp(1.6rem,3.4vh,2.5rem)] font-black text-gray-900 tabular-nums">{hoy}</span>
        <span className="text-[11px] font-bold tracking-wider text-secundario">HOY</span>
      </span>

      <Snowflake size={18} style={{ color: p.color }} className="[@media(max-height:560px)]:hidden" />
      <span className="text-[clamp(1.1rem,5.2vh,3.75rem)] font-black leading-none" style={{ color: p.color }}>{p.etiquetaGrilla}</span>
      <span className="text-[clamp(0.75rem,2.1vh,1.25rem)] font-bold text-gray-900 text-center leading-tight px-3">{p.nombre}</span>
      <span className="text-[clamp(0.6rem,1.6vh,1rem)] font-semibold text-secundario [@media(max-height:560px)]:hidden">{p.unidadesPorPallet} {p.unidadLabel} / pallet</span>
    </button>
  )
}

const TileProducto = memo(TileProductoBase)
export default TileProducto
