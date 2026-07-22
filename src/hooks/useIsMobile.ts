import { useState, useEffect } from 'react'

// Mismo breakpoint que Tailwind `md` (768px), usado en toda la app para
// alternar entre layout de escritorio y mobile.
const QUERY = '(max-width: 767px)'

// Para vistas con drag&drop (dnd-kit) NO alcanza con esconder la versión
// desktop/mobile por CSS (`hidden md:flex`) — React igual monta las dos, y
// dos `useDraggable`/`useDroppable` con el mismo id se pisan en el registro
// interno de dnd-kit (termina midiendo la copia oculta, de tamaño cero).
// Este hook permite renderizar una sola de las dos variantes por vez.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isMobile
}
