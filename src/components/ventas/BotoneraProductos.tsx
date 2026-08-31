import { useState } from 'react'
import { CatalogProducto } from '../../types'
import ProductoThumb from './ProductoThumb'
import CalculadoraCantidad from './CalculadoraCantidad'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

interface Props {
  catalogo:   CatalogProducto[]
  precioDe:   (productoId: string) => number
  cantidades: Record<string, number>
  onChange:   (next: Record<string, number>) => void
}

/** Botonera de productos en grilla, con foto por producto. Tocar una tarjeta abre
 *  la calculadora para cargar la cantidad. Compartida por ventanilla y chofer.
 *  No guarda nada: mantiene el estado `cantidades` y lo emite por `onChange`. */
export default function BotoneraProductos({ catalogo, precioDe, cantidades, onChange }: Props) {
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

function ProductoCard({ producto, cantidad, precio, onClick }: {
  producto: CatalogProducto
  cantidad: number
  precio:   number
  onClick:  () => void
}) {
  const activo = cantidad > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left bg-white rounded-xl border p-2.5 flex flex-col gap-2 active:scale-[0.98] transition-transform ${
        activo ? 'border-accent shadow-sm' : 'border-[#D3D1C7]'
      }`}
    >
      <div className="relative">
        <ProductoThumb producto={producto} fill />
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
      {activo
        ? <p className="text-xs font-bold text-accent tabular-nums">{money(precio * cantidad)} · {cantidad} u.</p>
        : <p className="text-[11px] text-gray-300">tocá para cantidad</p>}
    </button>
  )
}
