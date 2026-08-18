import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useHeladeras } from '../../hooks/useHeladeras'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { crearHeladera } from '../../services/heladeraService'
import { EstadoHeladera, TipoPipelineHeladera } from '../../types'
import { ESTADO_HELADERA_LABELS } from '../../utils/heladeraLabels'
import HeladeraDetailModal from '../../components/heladeras/HeladeraDetailModal'
import CrearHeladeraModal from '../../components/heladeras/CrearHeladeraModal'

const ESTADO_STYLES: Record<EstadoHeladera, string> = {
  en_taller:   'bg-amber-100 text-amber-700 border-amber-200',
  disponible:  'bg-green-100 text-green-700 border-green-200',
  en_comodato: 'bg-blue-100 text-blue-700 border-blue-200',
  baja:        'bg-red-100 text-red-700 border-red-200',
}

export default function EquiposPage() {
  const { user } = useAuth()
  const { heladeras, loading } = useHeladeras()
  const { pasos: catalogo } = usePasosTaller()
  const [searchParams] = useSearchParams()
  const [busqueda, setBusqueda] = useState(() => searchParams.get('q') ?? '')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoHeladera | 'todos'>('todos')
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null)
  // null = cerrado. El tipo de ingreso lo decide qué botón se tocó, no se
  // vuelve a preguntar dentro del modal (ver CrearHeladeraModal).
  const [crearModal, setCrearModal] = useState<TipoPipelineHeladera | null>(null)

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return heladeras.filter((h) => {
      if (estadoFiltro !== 'todos' && h.estado !== estadoFiltro) return false
      if (!q) return true
      return h.codigoInterno?.toLowerCase().includes(q) || h.numeroSerie?.toLowerCase().includes(q)
    })
  }, [heladeras, busqueda, estadoFiltro])

  // Se busca por id en el listado en vivo (no se guarda el objeto tal cual)
  // así el modal de detalle refleja al toque un asignar/retirar/baja.
  const seleccionada = useMemo(() => heladeras.find((h) => h.id === seleccionadaId) ?? null, [heladeras, seleccionadaId])

  if (loading) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Equipos</h1>
            <p className="text-gray-500 text-sm">{heladeras.length} heladeras cargadas</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setCrearModal('fabricacion')} className="text-sm">+ Fabricar heladera nueva</Button>
            <button
              onClick={() => setCrearModal('reacondicionamiento')}
              className="text-xs text-gray-500 hover:text-accent underline-offset-2 hover:underline"
            >
              Registrar equipo usado no cargado
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código o número de serie…"
              className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <select
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value as EstadoHeladera | 'todos')}
            className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="todos">Todos los estados</option>
            {Object.entries(ESTADO_HELADERA_LABELS).map(([estado, label]) => (
              <option key={estado} value={estado}>{label}</option>
            ))}
          </select>
        </div>

        {filtradas.length === 0 ? (
          <div className="text-sm">
            <p className="text-gray-400">No se encontraron heladeras con ese criterio.</p>
            {busqueda.trim() && (
              <p className="text-gray-400 mt-1">
                ¿Es un equipo usado que nunca se cargó?{' '}
                <button onClick={() => setCrearModal('reacondicionamiento')} className="text-accent hover:underline">
                  Registralo acá
                </button>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtradas.map((h) => (
              <button
                key={h.id}
                onClick={() => setSeleccionadaId(h.id)}
                className="w-full text-left bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 hover:border-accent transition-colors"
              >
                <div>
                  <p className="font-bold text-sm text-gray-900">{h.codigoInterno}</p>
                  <p className="text-gray-500 text-xs">{h.modelo} · serie {h.numeroSerie}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs ${h.clienteAsignadoNombre ? 'text-gray-600' : 'text-gray-400'}`}>
                    {h.clienteAsignadoNombre ?? 'Sin cliente asignado'}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${ESTADO_STYLES[h.estado]}`}>
                    {ESTADO_HELADERA_LABELS[h.estado]}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {seleccionada && (
        <HeladeraDetailModal heladera={seleccionada} onClose={() => setSeleccionadaId(null)} />
      )}

      {crearModal && user && (
        <CrearHeladeraModal
          tipoPipeline={crearModal}
          onClose={() => setCrearModal(null)}
          onSave={(data) => crearHeladera(data, { uid: user.uid, nombre: user.nombre }, catalogo)}
        />
      )}
    </div>
  )
}
