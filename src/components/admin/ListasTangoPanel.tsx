import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import LoadingSpinner from '../ui/LoadingSpinner'
import { useCatalogo } from '../../hooks/useCatalogo'
import { usePreciosTango } from '../../hooks/usePreciosTango'
import type { EmpresaTango } from '../../utils/precioTango'

const money = (n: number) => `$${n.toLocaleString('es-AR')}`

const EMPRESAS: { id: EmpresaTango; label: string }[] = [
  { id: 'redonhielo', label: 'Redonhielo (contado / cta. cte.)' },
  { id: 'rolito',     label: 'Rolito (promo)' },
]

// Solo lectura: las listas de precios tal como están en Tango (preciosTango/{empresa}).
// Se editan en Tango; acá se ven para controlar que la sync trajo lo esperado.
export default function ListasTangoPanel() {
  const [empresa, setEmpresa] = useState<EmpresaTango>('redonhielo')
  const [filtro, setFiltro]   = useState('')
  const { precios, loading }  = usePreciosTango(empresa)
  const { catalogo }          = useCatalogo()

  // Columnas: los productos del catálogo que la sync mapeó a un artículo de Tango.
  const productos = useMemo(() => {
    const mapeados = new Set(Object.keys(precios?.productos ?? {}))
    return catalogo.filter((p) => mapeados.has(p.id))
  }, [catalogo, precios])

  const listas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return Object.entries(precios?.listas ?? {})
      .map(([nro, l]) => ({ nro: Number(nro), ...l }))
      .filter((l) => !q || String(l.nro) === q || l.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nro - b.nro)
  }, [precios, filtro])

  const conPrecios = listas.filter((l) => Object.values(l.precios).some((p) => p > 0)).length
  const especiales = Object.keys(precios?.especiales ?? {}).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-white border border-[#D3D1C7] rounded-xl p-1">
          {EMPRESAS.map((e) => (
            <button
              key={e.id}
              onClick={() => setEmpresa(e.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                empresa === e.id ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar lista por número o nombre…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {loading ? <LoadingSpinner /> : !precios ? (
        <p className="text-sm text-amber-600">Todavía no se sincronizaron los precios de esta empresa. Usá "Sincronizar ahora".</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {listas.length} listas en Tango ({conPrecios} con algún precio cargado para los productos de la app) · {especiales} clientes con precio especial.
            Los precios se editan en Tango; acá solo se ven. Las listas sin ningún precio no sirven para vender por la app.
          </p>
          <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 font-medium px-3 py-2.5 whitespace-nowrap">Nº · Lista</th>
                  {productos.map((p) => (
                    <th key={p.id} className="text-right text-xs text-gray-500 font-medium px-2 py-2.5 whitespace-nowrap">{p.nombre}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listas.map((l) => (
                  <tr key={l.nro} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="text-gray-400 tabular-nums mr-1.5">{l.nro}</span>
                      <span className="font-medium text-gray-900">{l.nombre}</span>
                      {l.incluyeIva && <span className="ml-1.5 text-[10px] text-gray-400">IVA inc.</span>}
                    </td>
                    {productos.map((p) => {
                      const precio = l.precios[p.id]
                      return (
                        <td key={p.id} className="px-2 py-2 text-right tabular-nums">
                          {precio > 0 ? <span className="text-gray-900">{money(precio)}</span> : <span className="text-gray-300">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {listas.length === 0 && (
                  <tr><td colSpan={productos.length + 1} className="px-3 py-6 text-center text-gray-400">Ninguna lista coincide con la búsqueda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
