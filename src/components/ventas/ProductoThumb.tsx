import { useState } from 'react'
import { CatalogProducto } from '../../types'

// Color estable derivado del id, para el placeholder cuando el producto no tiene
// foto cargada. Así cada producto tiene siempre una identidad visual mínima.
const PLACEHOLDER_COLORS = [
  '#2563eb', '#0891b2', '#4f46e5', '#0d9488', '#7c3aed', '#db2777',
  '#ea580c', '#16a34a', '#0ea5e9', '#64748b', '#9333ea', '#0284c7',
]
function colorDeId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PLACEHOLDER_COLORS[h % PLACEHOLDER_COLORS.length]
}

interface Props {
  producto:   Pick<CatalogProducto, 'id' | 'nombre' | 'fotoUrl'>
  size?:      number   // lado en px (modo cuadrado fijo); ignorado si fill
  fill?:      boolean  // ocupa todo el ancho disponible, aspecto cuadrado
  className?: string
}

/** Miniatura del producto: la foto de Storage o, si falta/rompe, la inicial
 *  sobre un color propio. Único lugar que resuelve "foto o fallback". */
export default function ProductoThumb({ producto, size = 48, fill = false, className = '' }: Props) {
  const [error, setError] = useState(false)
  const boxStyle = fill ? undefined : { width: size, height: size }
  const boxClass = fill ? 'w-full aspect-square' : ''

  if (producto.fotoUrl && !error) {
    return (
      <img
        src={producto.fotoUrl}
        alt={producto.nombre}
        loading="lazy"
        onError={() => setError(true)}
        style={boxStyle}
        className={`rounded-lg object-cover bg-[#F0EEE7] shrink-0 ${boxClass} ${className}`}
      />
    )
  }

  const color   = colorDeId(producto.id)
  const inicial = (producto.nombre.trim()[0] || '?').toUpperCase()
  return (
    <div
      style={{ ...boxStyle, backgroundColor: `${color}1a`, color }}
      className={`rounded-lg flex items-center justify-center font-bold shrink-0 ${boxClass} ${className}`}
      aria-hidden
    >
      <span style={fill ? undefined : { fontSize: Math.round(size * 0.42) }} className={fill ? 'text-3xl' : ''}>
        {inicial}
      </span>
    </div>
  )
}
