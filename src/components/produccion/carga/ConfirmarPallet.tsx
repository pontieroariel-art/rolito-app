import { useRef, type PointerEvent } from 'react'
import { AlertTriangle, Printer, X } from 'lucide-react'
import type { ProductoHieloDef } from '@/utils/produccionCatalogo'
import { ANTI_DOBLE_TOQUE_MS } from '@/utils/cargaPallets'

// Ventana de confirmación del pallet (2026-09-25, decisión de Ariel: "prefiero
// que se abra una ventana"). Un toque en la tarjeta la abre; un toque en
// CONFIRMAR carga e imprime. Ocupa la pantalla, así que todo entra con la
// tablet en vertical o en horizontal y el botón es enorme para los guantes.
// - Un segundo toque demasiado pegado al que la abrió es un dedo que rebotó:
//   se ignora (ANTI_DOBLE_TOQUE_MS), así nadie confirma sin querer.
// - Tocar afuera o CANCELAR la cierra. Si nadie toca nada, la cierra la
//   pantalla sola a los 8 s (el armado vence).
// - Responde en `pointerdown`, igual que las tarjetas.
export interface ConfirmarPalletProps {
  producto:      ProductoHieloDef
  /** Código con el que va a salir, si ya hay número reservado. */
  codigoProximo: string | null
  /** epoch ms del toque que la abrió. */
  abiertaDesde:  number
  /**
   * Si el mismo producto se cargó hace menos de un minuto, hace cuántos
   * segundos (2026-09-25): casi seguro es un doble cargado, se pregunta.
   */
  repetidoHaceSeg: number | null
  onConfirmar:   () => void
  onCancelar:    () => void
}

export default function ConfirmarPallet({ producto: p, codigoProximo, abiertaDesde, repetidoHaceSeg, onConfirmar, onCancelar }: ConfirmarPalletProps) {
  const hecho = useRef(false)
  const muyPronto = () => Date.now() - abiertaDesde < ANTI_DOBLE_TOQUE_MS

  const confirmar = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (muyPronto() || hecho.current) return
    hecho.current = true
    onConfirmar()
  }
  const cancelar = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (muyPronto()) return
    onCancelar()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 print:hidden select-none"
      onPointerDown={cancelar}
      role="dialog"
      aria-modal="true"
      aria-label={`Confirmar pallet de ${p.nombre}`}
    >
      <div
        className="w-full max-w-xl rounded-3xl bg-white border-[6px] shadow-2xl p-5 flex flex-col gap-4"
        style={{ borderColor: p.color }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-center leading-none">
          <p className="text-[clamp(3rem,9vh,5.5rem)] font-black" style={{ color: p.color }}>{p.etiquetaGrilla}</p>
          <p className="mt-2 text-[clamp(1.25rem,2.6vh,1.75rem)] font-bold text-gray-900 leading-tight">{p.nombre}</p>
          <p className="mt-1 text-[clamp(1.1rem,2.2vh,1.5rem)] font-bold text-secundario tabular-nums">
            {p.unidadesPorPallet} {p.unidadLabel}
            {codigoProximo ? ` · sale como ${codigoProximo}` : ''}
          </p>
        </div>

        {/* Mismo producto hace menos de un minuto: casi seguro es un doble
            cargado. No bloquea (puede ser real), pero lo pregunta en grande. */}
        {repetidoHaceSeg !== null && (
          <div className="flex items-center gap-3 rounded-2xl border-[3px] border-amber-500 bg-amber-50 px-4 py-3">
            <AlertTriangle size={36} className="shrink-0 text-amber-600" />
            <p className="text-[clamp(1.1rem,2.4vh,1.5rem)] font-bold text-amber-900 leading-snug">
              ¿Otro pallet de {p.etiquetaGrilla}? El último fue hace {repetidoHaceSeg} segundo{repetidoHaceSeg === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        <button
          type="button"
          onPointerDown={confirmar}
          className="flex items-center justify-center gap-4 w-full rounded-2xl bg-accent text-white h-[clamp(5.5rem,13vh,8rem)] touch-manipulation active:opacity-90"
        >
          <Printer size={40} className="shrink-0" />
          <span className="text-[clamp(1.5rem,3.4vh,2.25rem)] font-black tracking-wide leading-tight">
            {repetidoHaceSeg !== null ? 'SÍ, CARGAR OTRO' : 'CONFIRMAR E IMPRIMIR'}
          </span>
        </button>

        <button
          type="button"
          onPointerDown={cancelar}
          className="flex items-center justify-center gap-2 w-full rounded-2xl border-2 border-[#D3D1C7] bg-white text-secundario h-16 text-xl font-bold touch-manipulation active:bg-gray-50"
        >
          <X size={24} /> Cancelar
        </button>
      </div>
    </div>
  )
}
