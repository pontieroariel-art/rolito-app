import { useState } from 'react'
import { CatalogProducto } from '../../types'
import ProductoThumb from './ProductoThumb'
import CalculadoraCantidad from './CalculadoraCantidad'
import { colorDe, etiquetaDe } from '../../utils/productoVisual'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

interface Props {
  catalogo:   CatalogProducto[]
  precioDe:   (productoId: string) => number
  cantidades: Record<string, number>
  onChange:   (next: Record<string, number>) => void
  /** Producto sin precio en Tango para este cliente: se muestra deshabilitado, no se puede vender. */
  sinPrecio?: (productoId: string) => boolean
}

/** Botonera de productos en grilla, con foto por producto. Tocar una tarjeta abre
 *  la calculadora para cargar la cantidad. Compartida por ventanilla y chofer.
 *  No guarda nada: mantiene el estado `cantidades` y lo emite por `onChange`. */
export default function BotoneraProductos({ catalogo, precioDe, cantidades, onChange, sinPrecio }: Props) {
  const [calcProd, setCalcProd] = useState<CatalogProducto | null>(null)

  const setCantidad = (id: string, n: number) => {
    const next = { ...cantidades }
    if (n > 0) next[id] = n
    else delete next[id]
    onChange(next)
  }

  const destacados = catalogo.filter((p) => p.destacado)
  const resto      = catalogo.filter((p) => !p.destacado)

  const grid = (items: CatalogProducto[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {items.map((p) => (
        <ProductoCard
          key={p.id}
          producto={p}
          cantidad={cantidades[p.id] ?? 0}
          precio={precioDe(p.id)}
          deshabilitado={sinPrecio?.(p.id) === true}
          onClick={() => setCalcProd(p)}
        />
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      {destacados.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Frecuentes</p>
          {grid(destacados)}
          {resto.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-1">Más productos</p>
          )}
        </>
      )}
      {resto.length > 0 && grid(resto)}

      {calcProd && (
        <CalculadoraCantidad
          open={!!calcProd}
          onClose={() => setCalcProd(null)}
          producto={calcProd}
          precioUnitario={precioDe(calcProd.id)}
          cantidadActual={cantidades[calcProd.id] ?? 0}
          onConfirm={(n) => setCantidad(calcProd.id, n)}
        />
      )}
    </div>
  )
}

// Badge de la tarjeta: lo que distingue al producto (peso "10 kg" o tipo "Picado").
// El número va grande y la unidad chica; una palabra va en mayúsculas.
function EtiquetaBadge({ text, color }: { text: string; color: string }) {
  const size = text.match(/^(\d+)\s*([a-zA-Z]+)$/)
  return (
    <span
      className="absolute top-1.5 left-1.5 flex items-baseline gap-0.5 rounded-lg px-2 py-0.5 text-white shadow"
      style={{ backgroundColor: color }}
    >
      {size ? (
        <>
          <span className="text-2xl font-black leading-none tracking-tight">{size[1]}</span>
          <span className="text-[11px] font-extrabold">{size[2]}</span>
        </>
      ) : (
        <span className="text-[15px] font-black uppercase tracking-wide leading-none py-0.5">{text}</span>
      )}
    </span>
  )
}

function ProductoCard({ producto, cantidad, precio, deshabilitado = false, onClick }: {
  producto: CatalogProducto
  cantidad: number
  precio:   number
  deshabilitado?: boolean
  onClick:  () => void
}) {
  const activo   = cantidad > 0
  const color    = colorDe(producto)
  const etiqueta = etiquetaDe(producto)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      style={{ borderTopColor: color, borderTopWidth: '4px' }}
      className={`relative text-left bg-white rounded-xl border border-[#D3D1C7] p-2.5 flex flex-col gap-2 active:scale-[0.98] transition-transform ${
        activo ? 'ring-2 ring-accent shadow-sm' : ''
      } ${deshabilitado ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
    >
      <div className="relative">
        <ProductoThumb producto={producto} fill />
        {etiqueta && <EtiquetaBadge text={etiqueta} color={color} />}
        {activo && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[26px] h-[26px] px-1.5 rounded-full bg-accent text-white text-sm font-extrabold flex items-center justify-center tabular-nums shadow">
            {cantidad}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 leading-tight">{producto.nombre}</p>
        <p className="text-xs text-gray-400">{money(precio)} <span className="text-gray-300">/ {producto.unidad}</span></p>
      </div>
      {deshabilitado
        ? <p className="text-[11px] font-semibold text-red-500">Sin precio en Tango</p>
        : activo
          ? <p className="text-xs font-bold text-accent tabular-nums">{money(precio * cantidad)} · {cantidad} u.</p>
          : <p className="text-[11px] text-gray-300">tocá para cantidad</p>}
    </button>
  )
}
