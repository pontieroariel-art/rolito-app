import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import TicketsServicioList from '../../components/heladeras/TicketsServicioList'
import { useAuth } from '../../context/AuthContext'
import { getHeladera } from '../../services/heladeraService'
import { getModeloHeladera } from '../../services/modelosHeladeraService'
import { Heladera, ModeloHeladera } from '../../types'
import { ESTADO_HELADERA_LABELS } from '../../utils/heladeraLabels'
import { tsToDate } from '../../utils/helpers'

const ACCION_LABELS: Record<string, string> = {
  creada:                 'Alta del equipo',
  trabajo_registrado:     'Trabajo registrado',
  liberada_por_encargado: 'Liberada por el encargado',
  aprobada_disponible:    'Aprobada — disponible',
  baja:                   'Dada de baja',
  asignada:               'Asignada a cliente',
  retirada:               'Retirada de cliente',
  service_abierto:        'Service abierto',
}

// Página pública dentro de la app (requiere login, pero sin restricción de
// ruta más allá del rol) pensada para abrirse escaneando el QR de la
// etiqueta Zebra — por eso vive en su propia URL en vez de ser un modal.
export default function FichaHeladeraPage() {
  const { heladeraId } = useParams<{ heladeraId: string }>()
  const { user } = useAuth()
  const [heladera, setHeladera] = useState<Heladera | null | undefined>(undefined)
  const [modelo,   setModelo]   = useState<ModeloHeladera | null>(null)

  useEffect(() => {
    if (!heladeraId) return
    getHeladera(heladeraId).then(setHeladera)
  }, [heladeraId])

  useEffect(() => {
    if (heladera?.modeloId) getModeloHeladera(heladera.modeloId).then(setModelo)
  }, [heladera?.modeloId])

  const historial = useMemo(
    () => [...(heladera?.historialAcciones ?? [])].sort((a, b) => tsToDate(b.timestamp).getTime() - tsToDate(a.timestamp).getTime()),
    [heladera?.historialAcciones],
  )

  const puedeGestionar = user && ['heladeras_encargado', 'super_admin', 'gerente_comercial'].includes(user.rol)
  const puedeReportar   = user && ['heladeras_encargado', 'super_admin', 'gerente_comercial'].includes(user.rol)

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-lg mx-auto p-4 space-y-5 pb-10">
        {heladera === undefined ? (
          <LoadingSpinner fullScreen />
        ) : heladera === null ? (
          <p className="text-gray-500 text-sm">No se encontró esta heladera.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{heladera.codigoInterno}</h1>
                <p className="text-gray-500 text-sm">Serie {heladera.numeroSerie}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/25 font-medium">
                {ESTADO_HELADERA_LABELS[heladera.estado]}
              </span>
            </div>

            <section className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap gap-4">
              {modelo?.fotoUrl && (
                <img src={modelo.fotoUrl} alt={modelo.nombre} className="w-28 h-28 object-cover rounded-lg border border-[#D3D1C7]" />
              )}
              <div className="flex-1 min-w-[180px] space-y-1">
                <p className="text-sm font-semibold text-gray-900">{heladera.modelo}</p>
                {modelo && (
                  <p className="text-xs text-gray-500">
                    {modelo.medidas.ancho}×{modelo.medidas.alto}×{modelo.medidas.profundo} cm · {modelo.capacidadBolsas} bolsas
                  </p>
                )}
                <p className="text-xs text-gray-500">Alta: {tsToDate(heladera.createdAt).toLocaleDateString('es-AR')}</p>
                <p className="text-xs text-gray-500">
                  Cliente asignado: <span className={heladera.clienteAsignadoNombre ? 'text-gray-900 font-medium' : 'text-gray-400'}>
                    {heladera.clienteAsignadoNombre ?? 'sin asignar'}
                  </span>
                </p>
                {heladera.motivoBaja && <p className="text-xs text-red-500">Motivo de baja: {heladera.motivoBaja}</p>}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3">
              {puedeGestionar && (
                <Link to="/heladeras/equipos" className="text-xs text-accent hover:underline">
                  Gestionar en Equipos →
                </Link>
              )}
              {puedeReportar && heladera.estado === 'en_comodato' && (
                <Link to={`/heladeras/toma-service?heladeraId=${heladera.id}`}>
                  <Button size="sm" variant="outline" className="text-xs">
                    <Wrench size={12} className="mr-1 inline" /> Reportar problema
                  </Button>
                </Link>
              )}
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-900">Tickets de service</h2>
              <TicketsServicioList heladeraId={heladera.id} />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-900">Historial</h2>
              {historial.length === 0 ? (
                <p className="text-gray-400 text-xs">Sin movimientos registrados.</p>
              ) : (
                <div className="space-y-1.5">
                  {historial.map((a, i) => (
                    <div key={i} className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-gray-900">{ACCION_LABELS[a.accion] ?? a.accion}</p>
                        <p className="text-xs text-gray-500">{a.usuarioNombre}{a.detalle ? ` · ${a.detalle}` : ''}</p>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{tsToDate(a.timestamp).toLocaleString('es-AR')}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
