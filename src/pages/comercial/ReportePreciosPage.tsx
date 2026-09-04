import { preciosClienteTango } from '@/utils/precioTango'
import { useState, useMemo } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Button from '../../components/ui/Button'
import { getAllUsers } from '../../services/userService'
import { PRODUCTS } from '../../utils/constants'
import { UserProfile } from '../../types'

// Precio del cliente para un producto: el que dejó la sync de Tango en su
// ficha (especial del cliente > su lista de Redonhielo). Las listas propias
// de la app se eliminaron el 2026-09-03.
function precioTango(cliente: UserProfile, productoId: string): number | null {
  return preciosClienteTango(cliente, 'redonhielo')?.[productoId] ?? null
}

function formatPrecio(n: number): string {
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── Lógica de exportación ─────────────────────────────────────────────────────

// xlsx (484K) se carga recién acá, al exportar — no al abrir la pantalla
async function exportarExcel(
  clientes: UserProfile[],
  productosActivos: typeof PRODUCTS,
) {
  const XLSX = await import('xlsx')
  const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g, '-')

  // Encabezados
  const headers = [
    'Cliente',
    'Razón social',
    'Lista asignada',
    ...productosActivos.map((p) => p.name),
  ]

  // Filas de clientes
  const rows = clientes.map((c) => {
    const listaNombre = c.listaTangoNombre?.redonhielo ?? 'Sin lista'
    const precios = productosActivos.map((p) => precioTango(c, p.id) ?? '')
    return [c.nombreContacto || c.nombre || c.email, c.razonSocial || '—', listaNombre, ...precios]
  })

  // Fila de promedio
  const promedios = productosActivos.map((p) => {
    const precios = clientes
      .map((c) => precioTango(c, p.id))
      .filter((v): v is number => v !== null)
    if (precios.length === 0) return ''
    const avg = precios.reduce((a, b) => a + b, 0) / precios.length
    return Math.round(avg)
  })
  const filaPromedio = ['PRECIO PROMEDIO', '', '', ...promedios]

  const wsData = [headers, ...rows, [], filaPromedio]

  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Anchos de columna
  ws['!cols'] = [
    { wch: 22 }, { wch: 28 }, { wch: 20 },
    ...productosActivos.map(() => ({ wch: 18 })),
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Precios')

  // Hoja de leyenda
  const leyenda = XLSX.utils.aoa_to_sheet([
    ['Leyenda'],
    ['Precios', 'De Tango: lista de Redonhielo del cliente, con su precio especial si lo tiene'],
    ['', ''],
    ['Exportado el', new Date().toLocaleString('es-AR')],
  ])
  XLSX.utils.book_append_sheet(wb, leyenda, 'Leyenda')

  XLSX.writeFile(wb, `reporte-precios-${fecha}.xlsx`)
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function ReportePreciosPage() {
  const [exporting, setExporting] = useState(false)

  const { data: todosUsuarios, isLoading: loadingUsuarios, refetch: refetchUsuarios } = useQuery({
    queryKey:  ['users', 'all'],
    queryFn:   () => getAllUsers(),
    staleTime: 300_000,
  })

  const refetch = () => { refetchUsuarios() }

  const clientes = useMemo(
    () => (todosUsuarios ?? []).filter((u) => u.rol === 'cliente' && u.estado === 'activo'),
    [todosUsuarios],
  )

  // Productos con precio de Tango para al menos un cliente.
  const productosActivos = useMemo(
    () => PRODUCTS.filter((p) => clientes.some((c) => precioTango(c, p.id) !== null)),
    [clientes],
  )

  // Promedio por producto
  const promedios = useMemo(() => {
    const map: Record<string, number | null> = {}
    for (const p of productosActivos) {
      const precios = clientes
        .map((c) => precioTango(c, p.id))
        .filter((v): v is number => v !== null)
      map[p.id] = precios.length > 0
        ? Math.round(precios.reduce((a, b) => a + b, 0) / precios.length)
        : null
    }
    return map
  }, [clientes, productosActivos])

  const handleExportar = async () => {
    setExporting(true)
    try { await exportarExcel(clientes, productosActivos) }
    finally { setExporting(false) }
  }

  const loading = loadingUsuarios

  return (
    <div className="min-h-screen min-h-dvh bg-[#F1EFE8] text-gray-900">
      <main className="max-w-full px-4 pb-10 space-y-6">

        {/* Header */}
        <div className="max-w-5xl mx-auto pt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Reporte de precios</h1>
            <p className="text-gray-500 text-sm mt-1">
              {clientes.length} clientes activos · {productosActivos.length} productos
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="text-gray-500 hover:text-gray-900 transition-colors"
              title="Actualizar"
            >
              <RefreshCw size={16} />
            </button>
            <Button
              onClick={handleExportar}
              loading={exporting}
              disabled={loading || clientes.length === 0}
              className="flex items-center gap-2"
            >
              <Download size={15} />
              Exportar Excel
            </Button>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner fullScreen />
        ) : (
          <>
            {/* Stats rápidas */}
            <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Clientes activos"      value={clientes.length} />
              <StatCard label="Con lista en Tango"    value={clientes.filter((c) => c.listaTango?.redonhielo).length} />
              <StatCard label="Con precios cargados"  value={clientes.filter((c) => productosActivos.some((p) => precioTango(c, p.id) !== null)).length} />
              <StatCard label="Listas distintas"      value={new Set(clientes.map((c) => c.listaTango?.redonhielo).filter(Boolean)).size} />
            </div>

            {/* Tabla */}
            <div className="overflow-x-auto rounded-2xl border border-[#D3D1C7]">
              <table className="text-sm border-collapse min-w-max w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-900 whitespace-nowrap border-r border-gray-200">
                      Cliente
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap border-r border-gray-200">
                      Lista
                    </th>
                    {productosActivos.map((p) => (
                      <th key={p.id} className="px-4 py-3 text-right font-semibold text-gray-500 whitespace-nowrap">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c, i) => {
                    const listaNombre = c.listaTangoNombre?.redonhielo
                    return (
                      <tr
                        key={c.uid}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                        }`}
                      >
                        <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap border-r border-gray-200">
                          <div>
                            <p className="text-sm">{c.razonSocial || c.nombreContacto || c.email}</p>
                            {c.razonSocial && c.nombreContacto && (
                              <p className="text-xs text-gray-500">{c.nombreContacto}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap border-r border-gray-100">
                          {listaNombre ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                              {listaNombre}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">Sin lista</span>
                          )}
                        </td>
                        {productosActivos.map((p) => {
                          const precio = precioTango(c, p.id)
                          return (
                            <td
                              key={p.id}
                              className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${precio !== null ? 'text-gray-900' : 'text-gray-200'}`}
                            >
                              {precio !== null ? formatPrecio(precio) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}

                  {/* Fila de promedio */}
                  <tr className="border-t-2 border-accent/30 bg-accent/5">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 font-bold text-accent whitespace-nowrap border-r border-gray-200">
                      Precio promedio
                    </td>
                    <td className="px-4 py-3 border-r border-gray-100" />
                    {productosActivos.map((p) => (
                      <td key={p.id} className="px-4 py-3 text-right font-bold text-accent tabular-nums whitespace-nowrap">
                        {promedios[p.id] !== null ? formatPrecio(promedios[p.id]!) : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500 text-center">
              Precios de Tango (lista de Redonhielo del cliente, con su precio especial si lo tiene). Se actualizan con la sincronización diaria.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}
