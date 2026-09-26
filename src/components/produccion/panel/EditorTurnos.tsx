import { useEffect, useMemo, useState } from 'react'
import { Crown, Plus, Save, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useOperariosProduccion } from '@/hooks/useOperariosProduccion'
import { useFirestoreSubscription } from '@/hooks/useFirestoreSubscription'
import { guardarTurnosPlanta, subscribeTurnosPlanta } from '@/services/produccionPanelService'
import { reportError } from '@/services/observability'
import { erroresTurnos, TURNOS_POR_DEFECTO, type TurnoProduccionDef } from '@/utils/turnosProduccion'
import { PLANTAS, type PersonaTurno, type PlantaId } from '@/types'

// Turnos de una planta (2026-09-25, pedido de Ariel): horarios editables
// porque cambian con la temporada, los operarios de cada turno y su capitán
// (uno por turno). Cada pallet guarda la foto de su turno al cargarse, así
// que cambiar esto no reescribe la historia.
export default function EditorTurnos({ planta }: { planta: PlantaId }) {
  const { user } = useAuth()
  const { operarios } = useOperariosProduccion()
  const { data: guardados } = useFirestoreSubscription<TurnoProduccionDef[]>((cb) => subscribeTurnosPlanta(planta, cb), [planta], TURNOS_POR_DEFECTO)
  const [turnos, setTurnos] = useState<TurnoProduccionDef[]>(guardados)
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState('')
  useEffect(() => { if (!sucio) setTurnos(guardados) }, [guardados, sucio])

  const dePlanta = useMemo(
    () => operarios.filter((o) => o.planta === planta && o.estado !== 'inactivo')
      .map((o) => ({ uid: o.uid, nombre: o.nombre ?? o.uid }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [operarios, planta],
  )
  const errores = erroresTurnos(turnos)

  const cambiar = (i: number, cambio: Partial<TurnoProduccionDef>) => {
    setTurnos((prev) => prev.map((t, j) => (j === i ? { ...t, ...cambio } : t)))
    setSucio(true); setAviso('')
  }
  const alternarOperario = (i: number, o: PersonaTurno) => {
    const t = turnos[i]!
    const ya = (t.operarios ?? []).some((x) => x.uid === o.uid)
    const operariosNuevos = ya ? (t.operarios ?? []).filter((x) => x.uid !== o.uid) : [...(t.operarios ?? []), o]
    // Si se saca al capitán de la dotación, deja de ser capitán.
    cambiar(i, { operarios: operariosNuevos, ...(ya && t.capitan?.uid === o.uid ? { capitan: null } : {}) })
  }
  const elegirCapitan = (i: number, o: PersonaTurno) => {
    const t = turnos[i]!
    const esCapitan = t.capitan?.uid === o.uid
    const enDotacion = (t.operarios ?? []).some((x) => x.uid === o.uid)
    cambiar(i, { capitan: esCapitan ? null : o, ...(enDotacion || esCapitan ? {} : { operarios: [...(t.operarios ?? []), o] }) })
  }

  const guardar = async () => {
    if (!user || errores.length) return
    setGuardando(true)
    try {
      await guardarTurnosPlanta(planta, turnos, user.uid)
      setSucio(false); setAviso('Turnos guardados.')
    } catch (err) {
      reportError(err, { origen: 'EditorTurnos', accion: 'guardar', planta })
      setAviso('No se pudieron guardar los turnos. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-gray-900">Turnos · {PLANTAS[planta].label}</h2>
          <p className="text-sm text-secundario">Horarios, operarios y capitán de cada turno. Cambian con la temporada.</p>
        </div>
        <button type="button" onClick={() => void guardar()} disabled={!sucio || guardando || errores.length > 0}
          className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-accent text-white font-bold disabled:opacity-40">
          <Save size={18} /> {guardando ? 'Guardando…' : 'Guardar turnos'}
        </button>
      </div>

      {errores.length > 0 && <ul className="text-sm text-red-700 font-semibold list-disc pl-5">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
      {aviso && <p className="text-sm font-semibold text-[#0F6B4E]">{aviso}</p>}

      <div className="grid gap-3 lg:grid-cols-3">
        {turnos.map((t, i) => (
          <div key={i} className="rounded-2xl border-2 border-[#E7E5DC] p-3 space-y-3">
            <div className="flex items-center gap-2">
              <input value={t.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="Nombre"
                className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-[#D3D1C7] font-bold" />
              <button type="button" aria-label="Sacar turno" onClick={() => { setTurnos((p) => p.filter((_, j) => j !== i)); setSucio(true) }}
                disabled={turnos.length === 1} className="h-11 w-11 flex items-center justify-center rounded-xl border border-[#D3D1C7] text-secundario disabled:opacity-30">
                <Trash2 size={18} />
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-secundario">
              De <input type="time" value={t.desde} onChange={(e) => cambiar(i, { desde: e.target.value })} className="h-11 px-2 rounded-xl border border-[#D3D1C7] text-gray-900" />
              a <input type="time" value={t.hasta} onChange={(e) => cambiar(i, { hasta: e.target.value })} className="h-11 px-2 rounded-xl border border-[#D3D1C7] text-gray-900" />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secundario mb-2"><Users size={14} /> Operarios · tocá la corona para el capitán</p>
              {dePlanta.length === 0 ? <p className="text-sm text-secundario">No hay operarios de esta planta.</p> : (
                <ul className="space-y-1">
                  {dePlanta.map((o) => {
                    const asignado = (t.operarios ?? []).some((x) => x.uid === o.uid)
                    const capitan = t.capitan?.uid === o.uid
                    return (
                      <li key={o.uid} className={`flex items-center gap-2 rounded-xl px-2 py-1 ${asignado ? 'bg-[#E6F5EF]' : ''}`}>
                        <label className="flex-1 flex items-center gap-2 cursor-pointer min-w-0">
                          <input type="checkbox" checked={asignado} onChange={() => alternarOperario(i, o)} className="w-5 h-5 accent-[#1D9E75]" />
                          <span className={`truncate ${asignado ? 'font-bold text-gray-900' : 'text-secundario'}`}>{o.nombre}</span>
                        </label>
                        <button type="button" onClick={() => elegirCapitan(i, o)} aria-label={capitan ? `Sacar a ${o.nombre} de capitán` : `Hacer capitán a ${o.nombre}`}
                          className={`h-9 w-9 flex items-center justify-center rounded-lg ${capitan ? 'bg-amber-100 text-amber-800' : 'text-[#C9C6BA] hover:text-amber-700'}`}>
                          <Crown size={18} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="mt-2 text-sm font-semibold text-gray-900">
                Capitán: {t.capitan ? <span className="text-amber-800">{t.capitan.nombre}</span> : <span className="text-secundario">sin elegir</span>}
                {' · '}{(t.operarios ?? []).length} operario{(t.operarios ?? []).length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => { setTurnos((p) => [...p, { nombre: '', desde: '06:00', hasta: '14:00', capitan: null, operarios: [] }]); setSucio(true) }}
        disabled={turnos.length >= 6} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-[#D3D1C7] font-bold text-gray-900 disabled:opacity-40">
        <Plus size={18} /> Agregar turno
      </button>
    </section>
  )
}
