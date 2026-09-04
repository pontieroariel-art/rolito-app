import { useMemo, useState, ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import ProduccionLayout from '../../components/produccion/ProduccionLayout'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useProduccionPallets } from '../../hooks/useProduccionPallets'
import { ProduccionResumen } from '../../components/produccion/ProduccionResumen'
import { usaShellProduccion } from '../../utils/produccionNav'
import { PLANTAS, PlantaId } from '../../types'
import { PRODUCTOS_HIELO_LIST } from '../../utils/produccionCatalogo'
import { toDateStr } from '../../utils/helpers'

// Pantalla compartida: el encargado (y super_admin) la ven dentro del shell
// de producción (sidebar), gerencia/logística/comercial con su Navbar de
// siempre. La ruta es una sola (/produccion/listado) y no puede vivir anidada
// bajo la <Route> de ProduccionLayout sin arrastrar el sidebar a todos, por
// eso el shell se elige acá por rol.
export default function ProduccionListadoPage() {
  const { user } = useAuth()
  const { pallets, loading } = useProduccionPallets(undefined)
  const [planta,   setPlanta]   = useState<PlantaId | ''>('')
  const [producto, setProducto] = useState('')
  const [fecha,    setFecha]    = useState('')

  const filtrados = useMemo(() => pallets.filter((p) => {
    if (planta && p.plantaId !== planta) return false
    if (producto && p.productoId !== producto) return false
    if (fecha && toDateStr(p.fechaFabricacion.toDate()) !== fecha) return false
    return true
  }), [pallets, planta, producto, fecha])

  const contenido = (
      <main className="max-w-3xl mx-auto p-4 space-y-4 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Producción de hielo</h1>
          <p className="text-gray-500 text-sm">Últimos pallets cargados</p>
        </div>

        <ProduccionResumen />

        <div className="flex flex-wrap gap-3">
          <select
            value={planta}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setPlanta(e.target.value as PlantaId | '')}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Todas las plantas</option>
            {Object.entries(PLANTAS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
          </select>
          <select
            value={producto}
            onChange={(e) => setProducto(e.target.value)}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Todos los productos</option>
            {PRODUCTOS_HIELO_LIST.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900"
          />
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : filtrados.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
            <p className="text-gray-500 text-sm">No hay pallets que coincidan con el filtro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto bg-white border border-[#D3D1C7] rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-[#D3D1C7]">
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Planta</th>
                  <th className="px-4 py-2">Producto</th>
                  <th className="px-4 py-2">Unidades</th>
                  <th className="px-4 py-2">Operario</th>
                  <th className="px-4 py-2">Fabricación</th>
                  <th className="px-4 py-2" aria-label="Etiqueta" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id} className="border-b border-[#D3D1C7]/60 last:border-0">
                    <td className="px-4 py-2">
                      <Link to={`/produccion/ficha/${p.id}`} className="text-accent hover:underline">{p.codigo}</Link>
                    </td>
                    <td className="px-4 py-2">{PLANTAS[p.plantaId].label}</td>
                    <td className="px-4 py-2">{p.productoNombre}</td>
                    <td className="px-4 py-2">{p.unidades}</td>
                    <td className="px-4 py-2">{p.operador.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {p.fechaFabricacion.toDate().toLocaleString('es-AR')}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to={`/produccion/ticket/${p.id}`}
                        target="_blank"
                        title="Reimprimir etiqueta"
                        className="inline-flex text-gray-400 hover:text-accent transition-colors p-1"
                      >
                        <Printer size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
  )

  if (usaShellProduccion(user?.rol)) {
    return <ProduccionLayout>{contenido}</ProduccionLayout>
  }
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <Navbar />
      {contenido}
    </div>
  )
}
