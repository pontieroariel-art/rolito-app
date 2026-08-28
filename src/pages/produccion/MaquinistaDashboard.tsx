import { useEffect, useState } from 'react'
import { Snowflake, Undo2, WifiOff } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useOnline } from '../../hooks/useOnline'
import {
  abrirParteMaquinas, deshacerUltimaEstampa, estamparCiclo, fechaParteHoy,
  setObservacionesParte, subscribeParteMaquinas, toggleMaquinaria,
} from '../../services/parteMaquinasService'
import { MAQUINARIAS, ROLITERAS, TURNOS, TURNO_LABELS, sugerirTurno } from '../../utils/maquinasCatalogo'
import { ParteMaquinas, PLANTAS, TurnoProduccion } from '../../types'

const hora = (t: { toDate: () => Date } | null) =>
  t ? t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'

// Recuerda el turno elegido en el dispositivo para que un reload (o quedarse
// sin batería a mitad de turno) no obligue a re-elegirlo. Solo vale para hoy.
const TURNO_KEY = 'maquinistaTurnoDevice'
function leerTurnoGuardado(): TurnoProduccion | null {
  try {
    const raw = localStorage.getItem(TURNO_KEY)
    if (!raw) return null
    const { fecha, turno } = JSON.parse(raw) as { fecha: string; turno: TurnoProduccion }
    return fecha === fechaParteHoy() ? turno : null
  } catch { return null }
}
function guardarTurno(turno: TurnoProduccion | null): void {
  try {
    if (turno) localStorage.setItem(TURNO_KEY, JSON.stringify({ fecha: fechaParteHoy(), turno }))
    else localStorage.removeItem(TURNO_KEY)
  } catch { /* sin localStorage no se persiste, no es crítico */ }
}

function CardRolitera({ parte, rolitera }: { parte: ParteMaquinas; rolitera: number }) {
  const ciclos = parte.ciclos.filter((c) => c.rolitera === rolitera)
  const ultimo = ciclos[ciclos.length - 1]
  const proximaEstampa: 'sale' | 'entra' = !ultimo || ultimo.entra ? 'sale' : 'entra'

  return (
    <div className="flex flex-col min-h-0 bg-white border border-[#D3D1C7] rounded-2xl p-3 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <p className="font-bold text-sm text-gray-900">Rolitera N°{rolitera}</p>
        <span className="text-xs text-gray-400">{ciclos.length} {ciclos.length === 1 ? 'ciclo' : 'ciclos'}</span>
      </div>

      {/* Últimos ciclos, el más nuevo arriba — el maquinista solo necesita
          confirmar de un vistazo que la estampa anterior quedó bien. */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {ciclos.length === 0 ? (
          <p className="text-xs text-gray-400">Sin ciclos todavía</p>
        ) : (
          [...ciclos].reverse().slice(0, 6).map((c) => (
            <div key={c.ciclo} className="flex items-center justify-between text-xs bg-[#F8F7F2] rounded-lg px-2 py-1">
              <span className="text-gray-400">#{c.ciclo}</span>
              <span className="text-gray-700 tabular-nums">
                Sale {hora(c.sale)} · Entra {hora(c.entra)}
              </span>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => estamparCiclo(parte, rolitera)}
        className={`shrink-0 rounded-xl py-4 text-xl font-black text-white active:scale-[0.97] transition-transform ${
          proximaEstampa === 'sale' ? 'bg-accent' : 'bg-[#2a78d6]'
        }`}
      >
        {proximaEstampa === 'sale' ? 'SALE' : 'ENTRA'}
        <span className="block text-[11px] font-medium opacity-80">
          {proximaEstampa === 'sale' ? 'empieza a tirar hielo' : 'arranca ciclo nuevo'}
        </span>
      </button>

      {ultimo && (
        <button
          onClick={() => deshacerUltimaEstampa(parte, rolitera)}
          className="shrink-0 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-red-500 py-1"
        >
          <Undo2 size={12} /> Deshacer última
        </button>
      )}
    </div>
  )
}

export default function MaquinistaDashboard() {
  const { user } = useAuth()
  const online = useOnline()
  const [turno, setTurno] = useState<TurnoProduccion | null>(leerTurnoGuardado)
  const [parte, setParte] = useState<ParteMaquinas | null | undefined>(undefined)
  const [obs, setObs] = useState('')
  const [obsDirty, setObsDirty] = useState(false)

  const planta = user?.planta

  useEffect(() => {
    if (!planta || !turno) return
    return subscribeParteMaquinas(planta, fechaParteHoy(), turno, setParte)
  }, [planta, turno])

  // Observaciones: editable local, sincroniza del server solo mientras no
  // haya edición pendiente (para no pisar lo que está tipeando).
  useEffect(() => {
    if (parte && !obsDirty) setObs(parte.observaciones)
  }, [parte, obsDirty])

  if (!user) return <LoadingSpinner fullScreen />
  if (!planta) {
    return <p className="p-6 text-sm text-gray-500">Tu cuenta no tiene planta asignada. Avisá al encargado.</p>
  }

  const elegirTurno = (t: TurnoProduccion) => {
    abrirParteMaquinas(planta, t, { uid: user.uid, nombre: user.nombre })
    guardarTurno(t)
    setParte(undefined)
    setTurno(t)
  }

  // ── Selector de turno ──
  if (!turno) {
    const sugerido = sugerirTurno(new Date().getHours())
    return (
      <div className="min-h-dvh bg-[#F8F7F2] text-gray-900">
        <Navbar />
        <main className="max-w-md mx-auto p-4 pt-10 space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold">Parte de máquinas</h1>
            <p className="text-gray-500 text-sm">{PLANTAS[planta].label} · ¿Qué turno arranca?</p>
          </div>
          <div className="space-y-3">
            {TURNOS.map((t) => (
              <button
                key={t.id}
                onClick={() => elegirTurno(t.id)}
                className={`w-full rounded-2xl border-[3px] py-6 text-2xl font-black transition-colors ${
                  t.id === sugerido
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-[#D3D1C7] bg-white text-gray-700'
                }`}
              >
                {t.label}
                {t.id === sugerido && <span className="block text-[11px] font-medium">sugerido por horario</span>}
              </button>
            ))}
          </div>
        </main>
      </div>
    )
  }

  if (parte === undefined) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-dvh bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto p-3 space-y-3 pb-10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold leading-tight flex items-center gap-2">
              <Snowflake size={16} className="text-accent" /> Parte de máquinas — {TURNO_LABELS[turno]}
            </h1>
            <p className="text-gray-500 text-xs">{PLANTAS[planta].label} · {user.nombre?.split(' ')[0]}</p>
          </div>
          <div className="flex items-center gap-2">
            {!online && (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <WifiOff size={13} /> Sin conexión — se guarda igual
              </span>
            )}
            <button
              onClick={() => { guardarTurno(null); setTurno(null) }}
              className="text-xs text-gray-500 border border-[#D3D1C7] rounded-lg px-3 py-1.5 hover:border-accent hover:text-accent transition-colors"
            >
              Cambiar turno
            </button>
          </div>
        </div>

        {parte === null ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Roliteras — el corazón de la pantalla: un botón grande por
                máquina que estampa la hora del momento (pedido de Ariel:
                cero tipeo de horas). */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ROLITERAS.map((r) => <CardRolitera key={r} parte={parte} rolitera={r} />)}
            </div>

            {/* Maquinarias encendidas — se tilda una vez al inicio del turno */}
            <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 space-y-3">
              <h2 className="text-sm font-semibold">Maquinarias encendidas</h2>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {MAQUINARIAS.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <p className="text-sm text-gray-700">{m.label}</p>
                    <div className="flex gap-1.5">
                      {Array.from({ length: m.cantidad }, (_, i) => i + 1).map((n) => {
                        const activa = (parte.maquinarias[m.id] ?? []).includes(n)
                        return (
                          <button
                            key={n}
                            onClick={() => toggleMaquinaria(parte, m.id, n)}
                            className={`w-10 h-10 rounded-lg border text-sm font-bold transition-colors ${
                              activa
                                ? 'bg-accent text-white border-accent'
                                : 'bg-[#F8F7F2] text-gray-500 border-[#D3D1C7]'
                            }`}
                          >
                            {n}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Observaciones — ej. "máquinas 1 y 3 paradas por diamante lleno" */}
            <section className="bg-white border border-[#D3D1C7] rounded-2xl p-4 space-y-2">
              <h2 className="text-sm font-semibold">Observaciones</h2>
              <textarea
                value={obs}
                onChange={(e) => { setObs(e.target.value); setObsDirty(true) }}
                onBlur={() => { if (obsDirty) { setObservacionesParte(parte, obs); setObsDirty(false) } }}
                rows={3}
                placeholder="Paradas, fallas, cambios de máquina…"
                className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
