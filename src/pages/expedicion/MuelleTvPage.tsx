import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { subscribeVentanillaDelDia } from '../../services/ventaVentanillaService'
import {
  DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA, PLANTAS, RemitoCarga, VentaVentanilla,
} from '../../types'

// Tablero de TV del muelle (/muelle/tv): pantalla grande de solo lectura que
// muestra en vivo las dársenas (las de camiones con su carga completa; las de
// ventanilla con el TURNO llamado), la cola de turnos, el panel PARA JUNTAR
// (suma por producto de los turnos sin preparar → un solo viaje de
// autoelevador a la cámara) y los ausentes. Pensada para un TV con Chrome en
// kiosco, logueado UNA vez con el usuario de muelle — se actualiza sola
// (onSnapshot), sin interacción. Wake-lock para que no se apague la pantalla.
export default function MuelleTvPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const totalDarsenas = DARSENAS_POR_PLANTA[plantaId]
  const dVentanilla   = DARSENAS_VENTANILLA[plantaId]

  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  const [ventanillas, setVentanillas] = useState<VentaVentanilla[]>([])
  const [ahora, setAhora] = useState(Date.now())

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, new Date(), setRemitos), [plantaId])
  useEffect(() => subscribeVentanillaDelDia(plantaId, new Date(), setVentanillas), [plantaId])
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  // Que el TV no apague la pantalla (si el navegador lo soporta).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const pedir = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen')
      } catch { /* sin soporte o sin permiso: se configura en el aparato */ }
    }
    pedir()
    const rearmar = () => { if (document.visibilityState === 'visible') pedir() }
    document.addEventListener('visibilitychange', rearmar)
    return () => {
      document.removeEventListener('visibilitychange', rearmar)
      lock?.release().catch(() => { /* ya liberado */ })
    }
  }, [])

  const camionEnDarsena = (n: number) => remitos.find((r) => r.estado === 'emitido' && r.darsena === n)
  const turnoEnDarsena  = (n: number) =>
    ventanillas.find((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'llamado' && v.darsena === n)

  const camionesEnEspera = remitos.filter((r) => r.estado === 'emitido' && !r.darsena)
  const listosParaSalir  = remitos.filter((r) => r.estado === 'entregado')
  const colaTurnos = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && ['en_espera', 'preparado'].includes(v.turnoEstado))
    .sort((a, b) => a.turno - b.turno)
  const ausentes = ventanillas.filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'ausente')

  // PARA JUNTAR: suma por producto de los turnos todavía SIN preparar — la
  // lista del próximo viaje de autoelevador a la cámara.
  const paraJuntar = useMemo(() => {
    const m = new Map<string, { nombre: string; cantidad: number }>()
    colaTurnos.filter((v) => v.turnoEstado === 'en_espera').forEach((v) =>
      v.items.forEach((i) => {
        const f = m.get(i.productoId) ?? { nombre: i.nombre, cantidad: 0 }
        f.cantidad += i.cantidad
        m.set(i.productoId, f)
      }),
    )
    return [...m.values()]
  }, [colaTurnos])

  // Llamado reciente (< 45s): banner gigante arriba de todo.
  const llamadoReciente = ventanillas.find((v) =>
    v.turnoEstado === 'llamado' && v.llamadoAt && (ahora - v.llamadoAt.toMillis()) < 45_000)

  const minutos = (v: VentaVentanilla) => Math.max(0, Math.round((ahora - v.fecha.toMillis()) / 60_000))
  const patente = (label: string) => label.split('·')[0].trim()

  return (
    <div className="min-h-screen bg-gray-950 text-white p-5 flex flex-col gap-4">
      {/* Header + llamado */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <img src="/logo-rolito.png" alt="Rolito" className="h-9 w-auto brightness-0 invert" />
          <p className="text-xl font-bold text-gray-300">Muelle · {PLANTAS[plantaId].label}</p>
        </div>
        {llamadoReciente ? (
          <div className="flex-1 bg-green-600 rounded-xl px-6 py-2 text-center animate-pulse">
            <p className="text-4xl font-black">TURNO {llamadoReciente.turno} → DÁRSENA {llamadoReciente.darsena}</p>
          </div>
        ) : <div className="flex-1" />}
        <p className="text-3xl font-black tabular-nums shrink-0">
          {new Date(ahora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Dársenas */}
      <div className="grid gap-3 flex-1" style={{ gridTemplateColumns: `repeat(${totalDarsenas}, minmax(0, 1fr))` }}>
        {Array.from({ length: totalDarsenas }, (_, i) => i + 1).map((n) => {
          const esVentanilla = dVentanilla.includes(n)
          if (esVentanilla) {
            const v = turnoEnDarsena(n)
            return (
              <div key={n} className={`rounded-2xl border-4 p-3 flex flex-col ${
                v ? 'border-sky-400 bg-sky-400/10' : 'border-gray-800 bg-gray-900'
              }`}>
                <div className="flex items-baseline justify-between">
                  <p className="text-4xl font-black text-gray-500">{n}</p>
                  <p className="text-xs font-bold text-sky-500 tracking-widest">VENTANILLA</p>
                </div>
                {v ? (
                  <div className="flex-1 flex flex-col">
                    <p className="text-6xl font-black text-sky-300 leading-none my-2">T-{v.turno}</p>
                    <p className="text-base text-gray-300 truncate">{v.clienteNombre}</p>
                    <div className="space-y-0.5 pt-1">
                      {v.items.map((i) => (
                        <div key={i.productoId} className="flex justify-between gap-2 text-lg leading-tight">
                          <span className="text-gray-200 truncate">{i.nombre}</span>
                          <span className="font-black tabular-nums">{i.cantidad}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xl text-gray-700 font-bold flex-1 flex items-center justify-center">LIBRE</p>
                )}
              </div>
            )
          }
          const r = camionEnDarsena(n)
          return (
            <div key={n} className={`rounded-2xl border-4 p-3 flex flex-col ${
              r ? 'border-amber-400 bg-amber-400/10' : 'border-gray-800 bg-gray-900'
            }`}>
              <div className="flex items-baseline justify-between">
                <p className="text-4xl font-black text-gray-500">{n}</p>
                <p className="text-xs font-bold text-amber-500 tracking-widest">CAMIONES</p>
              </div>
              {r ? (
                <div className="space-y-1 flex-1">
                  <p className="text-2xl font-black leading-tight">{patente(r.camionLabel)}</p>
                  <p className="text-sm text-gray-300">{r.choferNombre}</p>
                  <div className="space-y-0.5 pt-1">
                    {r.items.map((i) => (
                      <div key={i.productoId} className="flex justify-between gap-2 text-lg leading-tight">
                        <span className="text-gray-200 truncate">{i.nombre}</span>
                        <span className="font-black tabular-nums">{i.cantidad}</span>
                      </div>
                    ))}
                  </div>
                  {r.palletsCarga > 0 && (
                    <p className="text-sm text-amber-200 font-bold">{r.palletsCarga} pallets</p>
                  )}
                </div>
              ) : (
                <p className="text-xl text-gray-700 font-bold flex-1 flex items-center justify-center">LIBRE</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Fila inferior */}
      <div className="grid grid-cols-4 gap-3">
        {/* Cola de turnos */}
        <div className="rounded-2xl bg-gray-900 border-2 border-sky-900 p-3">
          <p className="text-lg font-bold text-sky-400 mb-1.5">TURNOS EN COLA ({colaTurnos.length})</p>
          <div className="flex flex-wrap gap-2">
            {colaTurnos.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {colaTurnos.slice(0, 8).map((v) => (
              <span key={v.id} className={`rounded-lg px-3 py-1 text-xl font-black ${
                v.turnoEstado === 'preparado' ? 'bg-green-700 text-green-100' : 'bg-gray-800 text-gray-200'
              }`}>
                {v.turno}
                <span className="text-xs font-medium text-gray-400 ml-1.5">{minutos(v)}m</span>
              </span>
            ))}
          </div>
          {ausentes.length > 0 && (
            <p className="text-sm text-red-400 font-bold mt-2">
              AUSENTES: {ausentes.map((v) => `T-${v.turno}`).join(' · ')}
            </p>
          )}
        </div>

        {/* Para juntar */}
        <div className="rounded-2xl bg-gray-900 border-2 border-amber-800 p-3">
          <p className="text-lg font-bold text-amber-400 mb-1.5">PARA JUNTAR (próx. viaje)</p>
          {paraJuntar.length === 0 && <p className="text-gray-700 text-lg">—</p>}
          <div className="space-y-0.5">
            {paraJuntar.map((p) => (
              <div key={p.nombre} className="flex justify-between gap-2 text-xl leading-tight">
                <span className="text-gray-200 truncate">{p.nombre}</span>
                <span className="font-black tabular-nums text-amber-200">{p.cantidad}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Camiones en espera */}
        <div className="rounded-2xl bg-gray-900 border-2 border-gray-800 p-3">
          <p className="text-lg font-bold text-gray-400 mb-1.5">CAMIONES EN ESPERA ({camionesEnEspera.length})</p>
          <div className="space-y-0.5">
            {camionesEnEspera.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {camionesEnEspera.slice(0, 4).map((r) => (
              <p key={r.id} className="text-xl font-bold leading-tight">
                {patente(r.camionLabel)} <span className="text-gray-400 text-sm font-medium">{r.choferNombre}</span>
              </p>
            ))}
          </div>
        </div>

        {/* Listos para salir */}
        <div className="rounded-2xl bg-gray-900 border-2 border-green-900 p-3">
          <p className="text-lg font-bold text-green-400 mb-1.5">LISTOS PARA SALIR ({listosParaSalir.length})</p>
          <div className="space-y-0.5">
            {listosParaSalir.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {listosParaSalir.slice(0, 4).map((r) => (
              <p key={r.id} className="text-xl font-bold leading-tight text-green-200">
                {patente(r.camionLabel)} <span className="text-gray-400 text-sm font-medium">{r.choferNombre}</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
