import { useMemo, useState, ChangeEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { subscribePartesRecientes } from '../../services/parteMaquinasService'
import { useFirestoreSubscription } from '../../hooks/useFirestoreSubscription'
import { MAQUINARIAS, ROLITERAS, TURNO_LABELS } from '../../utils/maquinasCatalogo'
import { Timestamp } from 'firebase/firestore'
import { ParteMaquinas, PLANTAS, PlantaId } from '../../types'

const hora = (t: Timestamp | null) =>
  t ? t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'

// Duración promedio del ciclo de producción de una rolitera: de ENTRA (arranca
// el ciclo) al SALE siguiente (empieza a tirar el hielo).
function duracionPromedioMin(parte: ParteMaquinas, rolitera: number): number | null {
  const ciclos = parte.ciclos.filter((c) => c.rolitera === rolitera)
  const duraciones: number[] = []
  for (let i = 0; i < ciclos.length - 1; i++) {
    const entra = ciclos[i].entra
    const saleSiguiente = ciclos[i + 1].sale
    if (entra && saleSiguiente) duraciones.push((saleSiguiente.toMillis() - entra.toMillis()) / 60000)
  }
  if (duraciones.length === 0) return null
  return Math.round(duraciones.reduce((s, d) => s + d, 0) / duraciones.length)
}

function DetalleParte({ parte }: { parte: ParteMaquinas }) {
  return (
    <div className="space-y-4 pt-3 border-t border-[#D3D1C7]/60">
      <div className="grid sm:grid-cols-3 gap-3">
        {ROLITERAS.map((r) => {
          const ciclos = parte.ciclos.filter((c) => c.rolitera === r)
          const promedio = duracionPromedioMin(parte, r)
          return (
            <div key={r} className="bg-[#F8F7F2] rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-900">Rolitera N°{r}</p>
                <p className="text-xs text-gray-400">
                  {ciclos.length} ciclos{promedio !== null ? ` · ~${promedio} min/ciclo` : ''}
                </p>
              </div>
              {ciclos.length === 0 ? (
                <p className="text-xs text-gray-400">Sin actividad</p>
              ) : (
                ciclos.map((c) => (
                  <div key={c.ciclo} className="flex justify-between text-xs text-gray-600 tabular-nums">
                    <span className="text-gray-400">#{c.ciclo}</span>
                    <span>Sale {hora(c.sale)} · Entra {hora(c.entra)}</span>
                  </div>
                ))
              )}
            </div>
          )
        })}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Maquinarias encendidas</p>
        <div className="flex flex-wrap gap-1.5">
          {MAQUINARIAS.map((m) => {
            const nums = parte.maquinarias?.[m.id] ?? []
            if (nums.length === 0) return null
            return (
              <span key={m.id} className="text-xs bg-accent/10 text-accent rounded-full px-2.5 py-1">
                {m.label}: {nums.join(', ')}
              </span>
            )
          })}
          {MAQUINARIAS.every((m) => (parte.maquinarias?.[m.id] ?? []).length === 0) && (
            <span className="text-xs text-gray-400">Sin tildar</span>
          )}
        </div>
      </div>

      {parte.observaciones && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Observaciones</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{parte.observaciones}</p>
        </div>
      )}
    </div>
  )
}

export default function PartesMaquinasPage() {
  const { data: partes, loading } = useFirestoreSubscription<ParteMaquinas[]>(
    (cb) => subscribePartesRecientes(cb), [], [],
  )
  const [planta, setPlanta] = useState<PlantaId | ''>('')
  const [fecha, setFecha] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  const filtrados = useMemo(() => partes.filter((p) => {
    if (planta && p.plantaId !== planta) return false
    if (fecha && p.fecha !== fecha) return false
    return true
  }), [partes, planta, fecha])

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Partes de máquinas</h1>
        <p className="text-gray-500 text-sm">Planilla del maquinista por turno — ciclos de roliteras y maquinarias</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={planta}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setPlanta(e.target.value as PlantaId | '')}
          className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Todas las plantas</option>
          {Object.entries(PLANTAS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900"
        />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtrados.length === 0 ? (
        <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No hay partes cargados{planta || fecha ? ' con ese filtro' : ' todavía'}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((p) => (
            <div key={p.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4">
              <button
                onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                className="w-full flex flex-wrap items-center justify-between gap-2 text-left"
              >
                <div>
                  <p className="font-bold text-sm text-gray-900">
                    {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}{TURNO_LABELS[p.turno]} · {PLANTAS[p.plantaId].label}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.maquinista.nombre} · {p.ciclos.length} ciclos
                    {p.observaciones ? ' · con observaciones' : ''}
                  </p>
                </div>
                {abierto === p.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>
              {abierto === p.id && <DetalleParte parte={p} />}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
