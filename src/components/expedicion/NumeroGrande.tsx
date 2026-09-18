import { ReactNode } from 'react'

/**
 * El número que alguien tiene que leer de parado y anotar a mano (2026-09-18):
 * el del remito que acaba de nacer (para dárselo al chofer) y el de la descarga
 * (para escribirlo en el sobre). Va gigante a propósito: la tablet del muelle se
 * mira desde un metro, con poca luz, y el dato se copia en un papel.
 *
 * Mientras el número no está —lo asigna el servidor— NO se inventa uno
 * provisorio: se dice que falta y qué hacer mientras tanto.
 */
export default function NumeroGrande({
  titulo, codigo, esperando, instruccion, detalle, children,
}: {
  titulo:       string
  /** El código definitivo. Vacío/undefined = todavía no llegó. */
  codigo?:      string
  /** Qué decir mientras no hay número (obligatorio si puede faltar). */
  esperando?:   string
  /** Qué hacer con el número, en una línea. */
  instruccion?: string
  detalle?:     ReactNode
  children?:    ReactNode
}) {
  return (
    <section className="bg-white rounded-2xl border-2 border-accent shadow-sm p-4 space-y-3">
      <p className="text-xs uppercase tracking-wide text-secundario">{titulo}</p>
      {codigo
        ? (
          <p className="text-4xl sm:text-5xl font-black tabular-nums text-gray-900 break-all leading-tight">
            {codigo}
          </p>
        )
        : (
          <p className="text-xl font-semibold text-secundario leading-snug">
            {esperando ?? 'Guardado. Esperando el número…'}
          </p>
        )}
      {instruccion && codigo && <p className="text-base text-gray-900">{instruccion}</p>}
      {detalle && <div className="text-base text-secundario space-y-1">{detalle}</div>}
      {children}
    </section>
  )
}
