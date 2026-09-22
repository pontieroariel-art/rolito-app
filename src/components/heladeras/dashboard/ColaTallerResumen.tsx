import { Link } from 'react-router-dom'
import { useFirestoreSubscription } from '../../../hooks/useFirestoreSubscription'
import { usePasosTaller } from '../../../hooks/usePasosTaller'
import { subscribeHeladerasEsperandoPaso } from '../../../services/heladeraService'
import { pasosOrdenados } from '../../../utils/heladeraPipeline'
import { TIPO_PIPELINE_LABELS } from '../../../utils/heladeraLabels'
import { Heladera, PasoTaller, TipoPipelineHeladera } from '../../../types'
import { tsToDate } from '../../../utils/helpers'

const VACIO: Heladera[] = []

// Una consulta por paso (auditoría 2026-09-22): antes el widget abría la
// colección entera para quedarse con las que esperan el primer paso.
function ColaDeTipo({ tipo, primerPaso }: { tipo: TipoPipelineHeladera; primerPaso: PasoTaller }) {
  const { data, loading } = useFirestoreSubscription<Heladera[]>(
    (cb, onError) => subscribeHeladerasEsperandoPaso(primerPaso.id, cb, onError), [primerPaso.id], VACIO,
  )
  const esperando = data
    .filter((h) => h.tipoPipeline === tipo)
    .sort((a, b) => tsToDate(a.updatedAt).getTime() - tsToDate(b.updatedAt).getTime())
  return (
    <div>
      <p className="text-xs font-medium text-secundario mb-1.5">
        {TIPO_PIPELINE_LABELS[tipo]} · esperando {primerPaso.nombre.toLowerCase()} ({esperando.length})
      </p>
      {loading ? (
        <p className="text-secundario text-xs">Cargando…</p>
      ) : esperando.length === 0 ? (
        <p className="text-secundario text-xs">Nada esperando.</p>
      ) : (
        <ul className="space-y-1">
          {esperando.slice(0, 5).map((h) => (
            <li key={h.id} className="flex items-center justify-between text-sm text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-50">
              <span className="font-medium">{h.codigoInterno}</span>
              <span className="text-xs text-secundario">{h.modelo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const TIPOS_PIPELINE: TipoPipelineHeladera[] = ['fabricacion', 'reacondicionamiento']

// Resumen de solo lectura de las heladeras esperando el primer paso de cada
// pipeline (esperando diagnóstico/repuestos) — no repite las acciones
// Agarrar/Soltar/Baja de HeladerasPage.tsx (atadas a actor/área/modales de
// esa página); para actuar, el link "Ver tablero" lleva ahí.
export default function ColaTallerResumen() {
  const { pasos: catalogo, isLoading: loadingPasos } = usePasosTaller()

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Cola de taller</h2>
        <Link to="/heladeras/taller" className="text-xs text-accent hover:underline">Ver tablero</Link>
      </div>

      {loadingPasos ? (
        <p className="text-secundario text-sm">Cargando…</p>
      ) : (
        TIPOS_PIPELINE.map((tipo) => {
          const primerPaso = pasosOrdenados(catalogo, tipo)[0]
          return primerPaso ? <ColaDeTipo key={tipo} tipo={tipo} primerPaso={primerPaso} /> : null
        })
      )}
    </section>
  )
}
