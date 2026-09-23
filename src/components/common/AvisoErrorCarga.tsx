/**
 * Franja de "no pudimos cargar" con botón Reintentar (2026-09-22). Es el
 * mismo bloque que ya usaba el home del chofer, sacado a un componente para
 * que las pantallas grandes (logística, monitoreo, mapa de clientes) muestren
 * el error en vez de quedarse vacías como si no hubiera nada.
 *
 * Sin `onReintentar` recarga la página: es lo único que reengancha una
 * suscripción de Firestore que se cayó.
 */
interface Props {
  mensaje:       string
  onReintentar?: () => void
  className?:    string
}

export default function AvisoErrorCarga({ mensaje, onReintentar, className = '' }: Props) {
  const reintentar = onReintentar ?? (() => window.location.reload())
  return (
    <div role="alert" className={`bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${className}`}>
      <p className="text-sm text-red-700">{mensaje}</p>
      <button
        type="button"
        onClick={reintentar}
        className="text-xs font-semibold text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors shrink-0"
      >
        Reintentar
      </button>
    </div>
  )
}
