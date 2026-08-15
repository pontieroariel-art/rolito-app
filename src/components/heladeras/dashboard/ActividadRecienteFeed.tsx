import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useHeladeras } from '../../../hooks/useHeladeras'
import { tsToDate } from '../../../utils/helpers'
import { AccionHistorial } from '../../../types'

interface Entrada extends AccionHistorial {
  heladeraId:     string
  heladeraCodigo: string
}

function tiempoRelativo(date: Date): string {
  const min = Math.floor((Date.now() - date.getTime()) / 60000)
  if (min < 1)  return 'recién'
  if (min < 60) return `hace ${min} min`
  const hs = Math.floor(min / 60)
  if (hs < 24) return `hace ${hs} h`
  return `hace ${Math.floor(hs / 24)} d`
}

// Primer feed de actividad cruzado entre heladeras de la app — no existía
// ningún lugar que agregara historialAcciones de más de una heladera a la
// vez (los únicos lectores, FichaHeladeraPage y HeladeraDetailModal, siempre
// muestran la de UNA heladera puntual). Se arma client-side sobre
// useHeladeras() (ya trae hasta 500 heladeras ordenadas por updatedAt desc,
// así que tomar las primeras es un buen proxy de "las que más se tocaron").
export default function ActividadRecienteFeed() {
  const { heladeras, loading } = useHeladeras()

  const entradas = useMemo<Entrada[]>(() => {
    const flat: Entrada[] = []
    for (const h of heladeras.slice(0, 40)) {
      for (const accion of h.historialAcciones ?? []) {
        flat.push({ ...accion, heladeraId: h.id, heladeraCodigo: h.codigoInterno })
      }
    }
    return flat
      .sort((a, b) => tsToDate(b.timestamp).getTime() - tsToDate(a.timestamp).getTime())
      .slice(0, 10)
  }, [heladeras])

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Actividad reciente</h2>

      {loading ? (
        <p className="text-gray-400 text-sm">Cargando…</p>
      ) : entradas.length === 0 ? (
        <p className="text-gray-400 text-sm">Todavía no hay movimientos registrados.</p>
      ) : (
        <ul className="space-y-2.5">
          {entradas.map((e, i) => (
            <li key={`${e.heladeraId}-${i}`}>
              <Link to={`/heladeras/ficha/${e.heladeraId}`} className="flex items-start justify-between gap-3 group">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 group-hover:text-accent transition-colors">
                    <span className="font-medium">{e.heladeraCodigo}</span> — {e.accion.replace(/_/g, ' ')}
                    {e.detalle ? ` — ${e.detalle}` : ''}
                  </p>
                  <p className="text-xs text-gray-400">{e.usuarioNombre}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{tiempoRelativo(tsToDate(e.timestamp))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
