import { useMemo, useState } from 'react'
import { coincideBusqueda, normalizarBusqueda } from '@/utils/busqueda'
import { Search } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import AsignarEquipoModal from '../../components/heladeras/AsignarEquipoModal'
import RetirarEquipoModal from '../../components/heladeras/RetirarEquipoModal'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useHeladeras } from '../../hooks/useHeladeras'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { puedeGestionarHeladeras } from '../../utils/heladeraLabels'
import { Heladera, UserProfile } from '../../types'

export default function AsignacionEquiposPage() {
  const { user } = useAuth()
  const { clientes, loading: loadingClientes } = useClientesActivos()
  const { heladeras, loading: loadingHeladeras } = useHeladeras()
  const { pasos: catalogoPasos } = usePasosTaller()

  const [busqueda,   setBusqueda]   = useState('')
  const [cliente,    setCliente]    = useState<UserProfile | null>(null)
  const [asignarAbierto, setAsignarAbierto] = useState(false)
  const [retirarObjetivo, setRetirarObjetivo] = useState<Heladera | null>(null)

  const puedeGestionar = puedeGestionarHeladeras(user?.rol)

  const resultados = useMemo(() => {
    if (!normalizarBusqueda(busqueda) || cliente) return []
    return clientes
      .filter((c) => coincideBusqueda(busqueda, c.razonSocial, c.nombreContacto, c.cuit, c.codigoCliente, ...(c.addresses ?? []).map((a) => a.id)))
      .slice(0, 8)
  }, [clientes, busqueda, cliente])

  const heladerasDelCliente = useMemo(
    () => (cliente ? heladeras.filter((h) => h.clienteAsignadoId === cliente.uid) : []),
    [heladeras, cliente],
  )
  const heladerasDisponibles = useMemo(() => heladeras.filter((h) => h.estado === 'disponible'), [heladeras])

  if (loadingClientes || loadingHeladeras) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asignación de equipos</h1>
          <p className="text-gray-500 text-sm">Buscá un cliente para ver o gestionar sus heladeras</p>
        </div>

        {!cliente ? (
          <div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por razón social, contacto, CUIT o código de cliente…"
                className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            {resultados.length > 0 && (
              <div className="bg-white border border-[#D3D1C7] rounded-lg mt-1.5 divide-y divide-gray-100">
                {resultados.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => { setCliente(c); setBusqueda('') }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-900">{c.razonSocial}</p>
                    <p className="text-xs text-gray-500">
                      {c.codigoCliente ? `Código ${c.codigoCliente} · ` : ''}CUIT {c.cuit}{c.nombreContacto ? ` · ${c.nombreContacto}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-sm font-semibold text-gray-900">{cliente.razonSocial}</p>
                <p className="text-xs text-gray-500">
                  {cliente.codigoCliente ? `Código ${cliente.codigoCliente} · ` : ''}CUIT {cliente.cuit}
                </p>
              </div>
              <button onClick={() => setCliente(null)} className="text-xs text-gray-500 hover:text-accent">
                Buscar otro
              </button>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Heladeras asignadas</h2>
              {puedeGestionar && (
                <Button onClick={() => setAsignarAbierto(true)} className="text-sm">+ Asignar heladera</Button>
              )}
            </div>

            {heladerasDelCliente.length === 0 ? (
              <p className="text-gray-400 text-sm">Este cliente no tiene heladeras asignadas.</p>
            ) : (
              <div className="space-y-2">
                {heladerasDelCliente.map((h) => (
                  <div key={h.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm text-gray-900">{h.codigoInterno}</p>
                      <p className="text-gray-500 text-xs">{h.modelo} · serie {h.numeroSerie}</p>
                      {h.clienteAsignadoDireccion && (
                        <p className="text-accent text-xs">{h.clienteAsignadoDireccion}</p>
                      )}
                    </div>
                    {puedeGestionar && (
                      <Button variant="outline" className="text-sm" onClick={() => setRetirarObjetivo(h)}>Retirar</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {asignarAbierto && cliente && user && (
        <AsignarEquipoModal
          clienteFijo={cliente}
          heladerasDisponibles={heladerasDisponibles}
          actor={{ uid: user.uid, nombre: user.nombre }}
          onClose={() => setAsignarAbierto(false)}
        />
      )}
      {retirarObjetivo && user && (
        <RetirarEquipoModal
          heladera={retirarObjetivo}
          actor={{ uid: user.uid, nombre: user.nombre }}
          catalogo={catalogoPasos}
          onClose={() => setRetirarObjetivo(null)}
        />
      )}
    </div>
  )
}
