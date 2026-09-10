import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { subscribeClientesConDeuda } from '@/services/saldosTangoService'
import { coincideBusqueda, normalizarBusqueda, INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { formatoARS } from '@/utils/money'

const MAX_RESULTADOS = 50

// Buscador de TODOS los clientes activos (no solo los que deben) para abrir su
// ficha: datos, contacto, domicilios, saldo. Busca por razón social, contacto,
// CUIT, código de Tango (de cualquier empresa) y dirección.
export default function SupervisorBuscarPage() {
  const { clientes, loading } = useClientesIndex()
  const [busqueda, setBusqueda] = useState('')
  const [deudas, setDeudas] = useState<Map<string, number>>(new Map())

  useEffect(() => subscribeClientesConDeuda((s) => setDeudas(new Map(s.map((x) => [x.id, x.saldoTotal])))), [])

  const resultados = useMemo(() => {
    const q = normalizarBusqueda(busqueda)
    const base = q
      ? clientes.filter((c) => coincideBusqueda(q, c.razonSocial, c.nombreContacto, c.cuit, c.codigos.join(' '), c.sucursales.join(' '), c.direccion, c.localidad))
      : clientes
    return base
      .slice()
      .sort((a, b) => (a.razonSocial ?? '').localeCompare(b.razonSocial ?? '', 'es'))
      .slice(0, MAX_RESULTADOS)
  }, [clientes, busqueda])

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Buscar cliente" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            {...INPUT_BUSQUEDA_PROPS}
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre, código, CUIT o dirección…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 text-center pt-8">Cargando clientes…</p>
        ) : resultados.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Ningún cliente coincide.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 px-1">
              {resultados.length === MAX_RESULTADOS ? `Primeros ${MAX_RESULTADOS} de ${clientes.length} clientes: afiná la búsqueda` : `${resultados.length} ${resultados.length === 1 ? 'cliente' : 'clientes'}`}
            </p>
            <div className="space-y-2">
              {resultados.map((c) => {
                const deuda = deudas.get(c.uid) ?? 0
                const dir = c.direccion ? { address: c.direccion } : null
                return (
                  <Link key={c.uid} to={`/supervisor/cliente/${c.uid}`}
                    className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.razonSocial}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {c.codigos.length ? `${c.codigos[0]}${c.codigos.length > 1 ? ` +${c.codigos.length - 1}` : ''}` : 'Sin código de Tango'}{c.cuit ? ` · CUIT ${c.cuit}` : ''}
                        </p>
                        {dir?.address && <p className="text-xs text-gray-400 truncate">{dir.address}</p>}
                      </div>
                      {deuda > 0 && (
                        <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                          Debe {formatoARS(deuda)}
                        </span>
                      )}
                      <ChevronRight size={16} className="text-gray-300 shrink-0" />
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
