import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * ENCABEZADO DE PANTALLA canónico (convenciones de diseño, 2026-09-13).
 *
 * Antes cada pantalla armaba el suyo a mano y no había dos iguales: distinto
 * tamaño de título, la bajada a veces en gray-400 y a veces en gray-500, y
 * links de navegación sueltos mezclados con los botones.
 *
 * Reglas:
 *  · El título dice DÓNDE estás; el contexto, de qué día / planta / talonario.
 *  · Los chips son ESTADO ("Caja abierta", "3 camiones en calle"), no destinos.
 *  · A la derecha van ACCIONES. Para ir a otra pantalla está el sidebar del
 *    dominio y el buscador Ctrl/⌘ K, no un link suelto en el encabezado. La
 *    excepción es `volver`, que es la vuelta al padre de una pantalla de
 *    detalle y va a la izquierda, arriba del título.
 *  · La acción que CIERRA un trabajo (firmar, registrar, cerrar caja) va al pie
 *    del formulario, no acá: repetirla en los dos lados hace dudar de si son la
 *    misma.
 */
export default function PageHeader({
  titulo, contexto, icono, chips, acciones, volver,
}: {
  titulo:    string
  /** Fecha, planta, talonario: de qué es esta pantalla ahora mismo. */
  contexto?: ReactNode
  icono?:    ReactNode
  /** Badges de estado. */
  chips?:    ReactNode
  acciones?: ReactNode
  volver?:   { to: string; etiqueta: string }
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {volver && (
          <Link to={volver.to} className="inline-flex items-center gap-1 text-xs text-secundario hover:text-accent mb-1">
            <ArrowLeft size={14} /> {volver.etiqueta}
          </Link>
        )}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight flex items-center gap-2 min-w-0">
            {icono && <span className="text-accent shrink-0">{icono}</span>}
            <span className="truncate" title={titulo}>{titulo}</span>
          </h1>
          {chips && <span className="flex items-center gap-1.5 shrink-0">{chips}</span>}
        </div>
        {contexto && <p className="text-sm text-secundario leading-tight mt-0.5">{contexto}</p>}
      </div>

      {/* En el celular las acciones (a veces filtros) ocupan su renglón y bajan si no entran (relevamiento de responsividad). */}
      {acciones && <div className="flex flex-wrap items-center gap-2 w-full min-w-0 sm:w-auto sm:shrink-0">{acciones}</div>}
    </div>
  )
}
