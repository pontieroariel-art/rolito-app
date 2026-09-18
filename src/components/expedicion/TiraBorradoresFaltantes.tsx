import { AlarmClock, CheckCircle2, Truck } from 'lucide-react'
import type { CamionDelDia } from '@/utils/borradoresFaltantes'

// "Faltan borradores para mañana" (2026-09-18), arriba de todo en /caja/remitos.
//
// Lo que caja necesita ver a las 17 no es lo que ya armó: es lo que falta. Cada
// camión sin borrador es un camión que mañana a las 4 se queda parado esperando
// que alguien de caja aparezca. Por eso la tira lista los que FALTAN, los de
// madrugada primero y en rojo, y a los que ya están los resume en una línea.

export default function TiraBorradoresFaltantes({ faltan, listos, paraFecha, onArmar }: {
  faltan:     CamionDelDia[]
  listos:     CamionDelDia[]
  /** Día que se está planificando (yyyy-MM-dd), para que el título no mienta si caja cambió la fecha. */
  paraFecha:  string
  /** Precarga el formulario con ese camión y repartidor. */
  onArmar:    (camion: CamionDelDia) => void
}) {
  const total = faltan.length + listos.length
  if (total === 0) return null

  const dia = etiquetaDia(paraFecha)
  const madrugada = faltan.filter((f) => f.madrugada).length

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">
        Faltan borradores para {dia}
      </h2>
      <div className={`bg-white border rounded-xl overflow-hidden ${faltan.length ? 'border-[#F0C7C2]' : 'border-[#D3D1C7]'}`}>
        {faltan.length === 0 ? (
          <p className="px-3.5 py-3 text-sm text-[#0B5A3C] flex items-center gap-2">
            <CheckCircle2 size={16} /> Los {listos.length} camiones que salieron hoy ya tienen su carga armada para {dia}.
          </p>
        ) : (
          <>
            <div className="px-3.5 py-2 bg-[#FDF3F2] border-b border-[#F0C7C2] flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold tabular-nums leading-none text-[#97241F]">{faltan.length}</span>
              <span className="text-sm text-[#97241F]">
                camión{faltan.length === 1 ? '' : 'es'} de los {total} que salieron hoy sin carga armada para {dia}
                {madrugada > 0 && <> · <b>{madrugada}</b> sale{madrugada === 1 ? '' : 'n'} de madrugada</>}
              </span>
            </div>
            <ul className="divide-y divide-[#E7E5DC]">
              {faltan.map((c) => (
                <li key={c.camionId} className="px-3.5 py-2 flex items-center gap-3">
                  <span className={c.madrugada ? 'text-[#C0392F]' : 'text-secundario'}>
                    {c.madrugada ? <AlarmClock size={16} /> : <Truck size={16} />}
                  </span>
                  <span className={`w-16 text-sm font-semibold tabular-nums text-right shrink-0 ${c.madrugada ? 'text-[#97241F]' : 'text-secundario'}`}>
                    {c.horaSalida || '—'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-900 truncate" title={c.camionLabel}>{c.camionLabel}</span>
                    <span className="block text-xs text-secundario truncate" title={c.choferNombre}>{c.choferNombre}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onArmar(c)}
                    className="text-xs font-semibold text-accent border border-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 shrink-0"
                  >
                    Armar carga
                  </button>
                </li>
              ))}
            </ul>
            {listos.length > 0 && (
              <p className="px-3.5 py-2 text-xs text-secundario bg-[#F8F7F2] border-t border-[#E7E5DC]">
                Ya armados: {listos.map((c) => `${c.camionLabel.split(' · ')[0]}${c.horaSalida ? ` (${c.horaSalida})` : ''}`).join(' · ')}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** "mañana" cuando lo es; si no, el día escrito, que es lo que caja mira. */
function etiquetaDia(paraFecha: string): string {
  const hoy = new Date()
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1)
  const clave = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`
  if (paraFecha === clave) return 'mañana'
  const [a, m, d] = paraFecha.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}
