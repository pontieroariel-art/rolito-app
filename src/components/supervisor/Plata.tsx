import { useEffect, useState } from 'react'
import { usePrivacidad } from '@/hooks/usePrivacidad'
import { formatoARS } from '@/utils/money'

/**
 * Importe que respeta el modo privacidad del supervisor: con el ojo activado se
 * muestra tapado y se revela unos segundos al tocarlo.
 *
 * Usarlo SOLO en pantallas de consulta (agenda de clientes, saldo de la ficha,
 * cobrado del día). La pantalla de cobro muestra siempre los números: ahí se
 * está moviendo plata y tapar importes es pedir un error.
 */
export default function Plata({ n, className = '' }: { n: number; className?: string }) {
  const { privado } = usePrivacidad()
  const [revelado, setRevelado] = useState(false)

  useEffect(() => {
    if (!revelado) return
    const t = setTimeout(() => setRevelado(false), 4000)
    return () => clearTimeout(t)
  }, [revelado])

  // Al apagar el modo, el estado de revelado deja de tener sentido.
  useEffect(() => { if (!privado) setRevelado(false) }, [privado])

  if (!privado || revelado) return <span className={`tabular-nums ${className}`}>{formatoARS(n)}</span>
  return (
    <button type="button" aria-label="Mostrar importe"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevelado(true) }}
      className={`tabular-nums tracking-widest ${className}`}>
      $&nbsp;•••••
    </button>
  )
}
