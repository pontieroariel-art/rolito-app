import { useMemo, useState } from 'react'
import { Tag } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import AsignarEquipoModal from './AsignarEquipoModal'
import RetirarEquipoModal from './RetirarEquipoModal'
import TicketsServicioList from './TicketsServicioList'
import { useAuth } from '../../context/AuthContext'
import { useModelosHeladera } from '../../hooks/useModelosHeladera'
import { usePasosTaller } from '../../hooks/usePasosTaller'
import { marcarBaja } from '../../services/heladeraService'
import { pasoActual } from '../../utils/heladeraPipeline'
import { Heladera } from '../../types'
import { tsToDate } from '../../utils/helpers'
import { ESTADO_HELADERA_LABELS, TIPO_OPERACION_LABELS, TIPO_PIPELINE_LABELS } from '../../utils/heladeraLabels'

const ACCION_LABELS: Record<string, string> = {
  creada:                  'Alta del equipo',
  paso_completado:         'Paso completado',
  paso_aprobado:           'Paso aprobado',
  paso_rechazado:          'Paso rechazado',
  liberada_por_encargado:  'Liberada por el encargado',
  baja:                    'Dada de baja',
  asignada:                'Asignada a cliente',
  retirada:                'Retirada de cliente',
  service_abierto:         'Service abierto',
}

export default function HeladeraDetailModal({ heladera, onClose }: { heladera: Heladera; onClose: () => void }) {
  const { user } = useAuth()
  const { modelos } = useModelosHeladera()
  const { pasos: catalogo } = usePasosTaller()
  const modelo = useMemo(() => modelos.find((m) => m.id === heladera.modeloId), [modelos, heladera.modeloId])
  const paso = useMemo(() => pasoActual(heladera, catalogo), [heladera, catalogo])

  const [bajaAbierta,    setBajaAbierta]    = useState(false)
  const [motivoBaja,     setMotivoBaja]     = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')
  const [asignarAbierto, setAsignarAbierto] = useState(false)
  const [retirarAbierto, setRetirarAbierto] = useState(false)

  const historial = useMemo(
    () => [...heladera.historialAcciones].sort((a, b) => tsToDate(b.timestamp).getTime() - tsToDate(a.timestamp).getTime()),
    [heladera.historialAcciones],
  )

  const handleBaja = async () => {
    if (!motivoBaja.trim() || !user) { setError('Contá el motivo de la baja'); return }
    setSaving(true)
    setError('')
    try {
      await marcarBaja(heladera.id, { uid: user.uid, nombre: user.nombre }, motivoBaja.trim())
      setBajaAbierta(false)
      onClose()
    } catch {
      setError('No se pudo dar de baja. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={heladera.codigoInterno} wide>
      <div className="space-y-5">

        {/* Ficha técnica */}
        <section className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap gap-4">
          {modelo?.fotoUrl && (
            <img src={modelo.fotoUrl} alt={modelo.nombre} className="w-28 h-28 object-cover rounded-lg border border-[#D3D1C7]" />
          )}
          <div className="flex-1 min-w-[180px] space-y-1">
            <p className="text-sm font-semibold text-gray-900">{heladera.modelo}</p>
            <p className="text-xs text-gray-500">Serie {heladera.numeroSerie}</p>
            {modelo && (
              <p className="text-xs text-gray-500">
                {modelo.medidas.ancho}×{modelo.medidas.alto}×{modelo.medidas.profundo} cm · {modelo.capacidadBolsas} bolsas
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Cliente asignado: <span className={heladera.clienteAsignadoNombre ? 'text-gray-900 font-medium' : 'text-gray-400'}>
                {heladera.clienteAsignadoNombre ?? 'sin asignar'}
              </span>
            </p>
            <p className="text-xs text-gray-500">
              Ingreso: <span className="text-gray-700">
                {heladera.motivoIngresoNombre && heladera.tipoOperacion
                  ? `${heladera.motivoIngresoNombre} · ${TIPO_OPERACION_LABELS[heladera.tipoOperacion]}`
                  : TIPO_PIPELINE_LABELS[heladera.tipoPipeline]}
              </span>
              {heladera.cicloActual > 1 && <span className="text-amber-600"> · ciclo {heladera.cicloActual}</span>}
            </p>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/25 font-medium h-fit">
            {heladera.estado === 'en_taller' ? (paso?.nombre ?? 'En taller') : ESTADO_HELADERA_LABELS[heladera.estado]}
          </span>
        </section>

        {heladera.motivoBaja && (
          <p className="text-xs text-red-500">Motivo de baja: {heladera.motivoBaja}</p>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="text-sm"
            onClick={() => window.open(`/heladeras/etiqueta/${heladera.id}`, '_blank')}
          >
            <Tag size={14} className="mr-1.5 inline" /> Imprimir etiqueta
          </Button>
          {heladera.estado === 'disponible' && (
            <Button className="text-sm" onClick={() => setAsignarAbierto(true)}>Asignar a cliente</Button>
          )}
          {heladera.estado === 'en_comodato' && (
            <Button variant="outline" className="text-sm" onClick={() => setRetirarAbierto(true)}>Retirar del cliente</Button>
          )}
          {heladera.estado !== 'baja' && (
            <Button variant="outline" className="text-sm text-red-500 border-red-200 hover:bg-red-50" onClick={() => setBajaAbierta((v) => !v)}>
              Dar de baja
            </Button>
          )}
        </div>

        {bajaAbierta && (
          <div className="bg-red-500/5 border border-red-200 rounded-xl p-4 space-y-3">
            <label className="text-xs text-gray-500 block">Motivo de la baja (destrucción del equipo, irreparable, etc.)</label>
            <textarea
              value={motivoBaja}
              onChange={(e) => setMotivoBaja(e.target.value)}
              rows={2}
              className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-sm" onClick={() => setBajaAbierta(false)}>Cancelar</Button>
              <Button className="flex-1 text-sm bg-red-500 hover:bg-red-600" loading={saving} onClick={handleBaja}>Confirmar baja</Button>
            </div>
          </div>
        )}

        {/* Tickets de service */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Tickets de service</h3>
          <TicketsServicioList heladeraId={heladera.id} />
        </section>

        {/* Historial */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Historial</h3>
          {historial.length === 0 ? (
            <p className="text-gray-400 text-xs">Sin movimientos registrados.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {historial.map((a, i) => (
                <div key={i} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-1.5 last:border-0">
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
      </div>

      {asignarAbierto && user && (
        <AsignarEquipoModal
          heladera={heladera}
          actor={{ uid: user.uid, nombre: user.nombre }}
          onClose={() => setAsignarAbierto(false)}
        />
      )}
      {retirarAbierto && user && (
        <RetirarEquipoModal
          heladera={heladera}
          actor={{ uid: user.uid, nombre: user.nombre }}
          onClose={() => setRetirarAbierto(false)}
        />
      )}
    </Modal>
  )
}
