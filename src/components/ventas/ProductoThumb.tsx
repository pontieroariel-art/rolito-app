import { useState } from 'react'
import { CatalogProducto } from '../../types'
import { colorDe } from '../../utils/productoVisual'

interface Props {
  producto:   Pick<CatalogProducto, 'id' | 'nombre' | 'fotoUrl' | 'color'>
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
        className={`rounded-lg object-contain bg-white shrink-0 ${boxClass} ${className}`}
      />
    )
  }

  const color   = colorDe(producto)
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
