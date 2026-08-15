import { Link } from 'react-router-dom'
import { useHeladeras } from '../../../hooks/useHeladeras'
import { usePasosTaller } from '../../../hooks/usePasosTaller'
import { pasosOrdenados } from '../../../utils/heladeraPipeline'
import { TIPO_PIPELINE_LABELS } from '../../../utils/heladeraLabels'
import { TipoPipelineHeladera } from '../../../types'
import { tsToDate } from '../../../utils/helpers'

const TIPOS_PIPELINE: TipoPipelineHeladera[] = ['fabricacion', 'reacondicionamiento']

// Resumen de solo lectura de las heladeras esperando el primer paso de cada
// pipeline (esperando diagnóstico/repuestos) — no repite las acciones
// Agarrar/Soltar/Baja de HeladerasPage.tsx (atadas a actor/área/modales de
// esa página); para actuar, el link "Ver tablero" lleva ahí.
export default function ColaTallerResumen() {
  const { heladeras, loading }              = useHeladeras()
  const { pasos: catalogo, isLoading: loadingPasos } = usePasosTaller()

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Cola de taller</h2>
        <Link to="/heladeras/taller" className="text-xs text-accent hover:underline">Ver tablero</Link>
      </div>

      {loading || loadingPasos ? (
        <p className="text-gray-400 text-sm">Cargando…</p>
      ) : (
        TIPOS_PIPELINE.map((tipo) => {
          const primerPaso = pasosOrdenados(catalogo, tipo)[0]
          if (!primerPaso) return null
          const esperando = heladeras
            .filter((h) => h.tipoPipeline === tipo && h.pasoActualId === primerPaso.id && !h.enProceso)
            .sort((a, b) => tsToDate(a.updatedAt).getTime() - tsToDate(b.updatedAt).getTime())

          return (
            <div key={tipo}>
              <p className="text-xs font-medium text-gray-500 mb-1.5">
                {TIPO_PIPELINE_LABELS[tipo]} · esperando {primerPaso.nombre.toLowerCase()} ({esperando.length})
              </p>
              {esperando.length === 0 ? (
                <p className="text-gray-400 text-xs">Nada esperando.</p>
              ) : (
                <ul className="space-y-1">
                  {esperando.slice(0, 5).map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-sm text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-50">
                      <span className="font-medium">{h.codigoInterno}</span>
                      <span className="text-xs text-gray-400">{h.modelo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
