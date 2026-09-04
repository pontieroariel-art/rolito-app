import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { subscribeVentanillaDelDia } from '../../services/ventaVentanillaService'
import {
  DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA, PLANTAS, RemitoCarga, VentaVentanilla,
} from '../../types'

// Tablero de TV del muelle (/muelle/tv) — diseño "E1 Neón oscuro" elegido por
// Ariel (2026-08-30) sobre la info de la variante E "Operativo": los
// clarkistas y el personal NO tienen tablet en mano, así que las cantidades
// viven acá, enormes (nombre corto + número gigante por dársena, legibles
// desde el autoelevador), con el PARA JUNTAR (suma de turnos sin preparar =
// un solo viaje a la cámara) y la cola SIGUEN abajo. Se dibuja a 1920x1080
// lógicos y se escala entero a la pantalla real. Suena una campanilla cuando
// entra alguien nuevo (turno de ventanilla o carga de camión) — el sonido se
// activa una vez al montar el TV (los navegadores exigen un toque humano).
export default function MuelleTvPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const totalDarsenas = DARSENAS_POR_PLANTA[plantaId]
  const dVentanilla   = DARSENAS_VENTANILLA[plantaId]
  const fecha = useFechaDelDia()

  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  const [ventanillas, setVentanillas] = useState<VentaVentanilla[]>([])
  const [ahora,  setAhora]  = useState(Date.now())
  const [escala, setEscala] = useState(1)
  const [sonido, setSonido] = useState(false)

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, fecha, setRemitos), [plantaId, fecha])
  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentanillas), [plantaId, fecha])
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  // Auto-escala: el tablero entra SIEMPRE completo, sea el TV que sea.
  useEffect(() => {
    const ajustar = () => setEscala(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
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

  // ── Bocina de llegada ── el muelle tiene MUCHO ruido ambiente (dato de
  // Ariel): esto no es una campanita, es una alarma industrial — onda
  // CUADRADA (llena de armónicos, corta el ruido de máquinas) alternando dos
  // frecuencias en la zona más sensible del oído, 3 ráfagas largas a volumen
  // máximo, más un destello de toda la pantalla como baliza (por si igual no
  // se escucha). Los navegadores solo dejan sonar tras un gesto humano: el
  // botón de abajo a la derecha arma el audio una vez al instalar el TV.
  const audioRef = useRef<AudioContext | null>(null)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bocina = useCallback(() => {
    const ctx = audioRef.current
    if (!ctx) return
    const t = ctx.currentTime
    // 3 ráfagas de 0.45s alternando 1000/1500Hz (dos osciladores por ráfaga
    // = más grueso), con 0.2s de silencio entre ráfagas. ~1.8s total.
    for (let r = 0; r < 3; r++) {
      const inicio = t + r * 0.65
      ;[1000, 1500].forEach((freq) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(freq, inicio)
        gain.gain.setValueAtTime(0.0001, inicio)
        gain.gain.exponentialRampToValueAtTime(0.9, inicio + 0.02)
        gain.gain.setValueAtTime(0.9, inicio + 0.4)
        gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.45)
        osc.connect(gain).connect(ctx.destination)
        osc.start(inicio)
        osc.stop(inicio + 0.5)
      })
    }
  }, [])
  // Baliza visual: toda la pantalla destella unos segundos junto con la bocina.
  const balizar = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(true)
    flashTimer.current = setTimeout(() => setFlash(false), 5_000)
  }, [])
  const alarmaLlegada = useCallback(() => { bocina(); balizar() }, [bocina, balizar])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])
  const activarSonido = () => {
    try {
      if (!audioRef.current) audioRef.current = new AudioContext()
      audioRef.current.resume()
      setSonido(true)
      alarmaLlegada()   // ráfaga de prueba, para calibrar el volumen del TV
    } catch { /* sin soporte de audio */ }
  }
  const apagarSonido = () => setSonido(false)

  // Suena cuando aparece un id NUEVO (nunca en la carga inicial de la página).
  const idsVistos = useRef<{ remitos: Set<string> | null; ventanillas: Set<string> | null }>({ remitos: null, ventanillas: null })
  useEffect(() => {
    const previos = idsVistos.current.remitos
    if (previos && sonido && remitos.some((r) => !previos.has(r.id))) alarmaLlegada()
    idsVistos.current.remitos = new Set(remitos.map((r) => r.id))
  }, [remitos, sonido, alarmaLlegada])
  useEffect(() => {
    const previos = idsVistos.current.ventanillas
    if (previos && sonido && ventanillas.some((v) => !previos.has(v.id))) alarmaLlegada()
    idsVistos.current.ventanillas = new Set(ventanillas.map((v) => v.id))
  }, [ventanillas, sonido, alarmaLlegada])

  // ── Datos derivados ──
  const camionEnDarsena = (n: number) => remitos.find((r) => r.estado === 'emitido' && r.darsena === n)
  const turnoEnDarsena  = (n: number) =>
    ventanillas.find((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'llamado' && v.darsena === n)

  const camionesEnEspera = remitos.filter((r) => r.estado === 'emitido' && !r.darsena)
  const listosParaSalir  = remitos.filter((r) => r.estado === 'entregado')
  const colaTurnos = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && ['en_espera', 'preparado'].includes(v.turnoEstado))
    .sort((a, b) => a.turno - b.turno)
  const ausentes = ventanillas.filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'ausente')

  const paraJuntar = useMemo(() => {
    const m = new Map<string, { productoId: string; nombre: string; cantidad: number }>()
    colaTurnos.filter((v) => v.turnoEstado === 'en_espera').forEach((v) =>
      v.items.forEach((i) => {
        const f = m.get(i.productoId) ?? { productoId: i.productoId, nombre: i.nombre, cantidad: 0 }
        f.cantidad += i.cantidad
        m.set(i.productoId, f)
      }),
    )
    return [...m.values()]
  }, [colaTurnos])

  const llamadoReciente = ventanillas.find((v) =>
    v.turnoEstado === 'llamado' && v.llamadoAt && (ahora - v.llamadoAt.toMillis()) < 45_000)

  const patente = (label: string) => label.split('·')[0].trim()

  // Nombre corto de producto, para leerse desde el autoelevador.
  const ETIQUETAS: Record<string, string> = {
    bolsa_2kg: '2kg', bolsa_3kg: '3kg', bolsa_10kg: '10kg',
    picado_10kg: 'PICADO', escamas_10kg: 'ESCAMA', barra: 'BARRA',
    anticorrosivo: 'ANTIC.', agua_6l: 'AGUA',
  }
  const corto = (productoId: string, nombre: string) =>
    ETIQUETAS[productoId] ?? (nombre.match(/\d+\s?kg/i)?.[0].replace(/\s/g, '') ?? nombre.split(' ')[0].toUpperCase().slice(0, 7))

  const filaProducto = (key: string, etiqueta: string, cantidad: number, borde: string) => (
    <div key={key} className="flex justify-between items-baseline pb-1" style={{ borderBottom: `2px solid ${borde}` }}>
      <span className="text-[44px] font-bold text-gray-200 leading-none">{etiqueta}</span>
      <span className="text-[76px] font-black leading-none tabular-nums">{cantidad}</span>
    </div>
  )

  return (
    <div className="h-screen h-dvh w-screen overflow-hidden bg-gray-950 relative">
    <div
      className="bg-gray-950 text-white p-6 flex flex-col gap-[18px] absolute left-1/2 top-1/2"
      style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${escala})` }}
    >
      {/* Header + llamado */}
      <div className="flex items-center gap-[18px] h-[84px] shrink-0">
        <p className="text-2xl font-bold text-gray-400 shrink-0">MUELLE · {PLANTAS[plantaId].label.toUpperCase().replace('PLANTA ', '')}</p>
        {llamadoReciente ? (
          <div className="flex-1 bg-green-600 rounded-2xl text-center py-2 animate-pulse" style={{ boxShadow: '0 0 40px rgba(22,163,74,0.45)' }}>
            <span className="text-[54px] font-black leading-none">TURNO {llamadoReciente.turno} → DÁRSENA {llamadoReciente.darsena}</span>
          </div>
        ) : <div className="flex-1" />}
        <p className="text-[40px] font-black tabular-nums shrink-0">
          {new Date(ahora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Dársenas */}
      <div className="grid gap-4 flex-1 min-h-0" style={{ gridTemplateColumns: `repeat(${totalDarsenas}, minmax(0, 1fr))` }}>
        {Array.from({ length: totalDarsenas }, (_, i) => i + 1).map((n) => {
          const esVentanilla = dVentanilla.includes(n)
          const tag = (
            <div className="flex justify-between items-baseline">
              <span className="text-5xl font-black text-gray-500">{n}</span>
              <span className={`text-lg font-bold tracking-[3px] ${esVentanilla ? 'text-sky-400' : 'text-amber-500'}`}>
                {esVentanilla ? 'VENTANILLA' : 'CAMIÓN'}
              </span>
            </div>
          )
          if (esVentanilla) {
            const v = turnoEnDarsena(n)
            return v ? (
              <div key={n} className="rounded-[20px] p-[18px] flex flex-col gap-2.5 border-[5px] border-green-500 bg-green-500/10" style={{ boxShadow: '0 0 32px rgba(34,197,94,0.3)' }}>
                {tag}
                <p className="text-[110px] font-black leading-none text-green-400">T-{v.turno}</p>
                <div className="flex flex-col gap-2 mt-1.5 min-h-0 overflow-hidden">
                  {v.items.map((i) => filaProducto(i.productoId, corto(i.productoId, i.nombre), i.cantidad, 'rgba(34,197,94,0.3)'))}
                </div>
                <p className="mt-auto text-[26px] text-gray-400 truncate">{v.clienteNombre}</p>
              </div>
            ) : (
              <div key={n} className="rounded-[20px] p-[18px] flex flex-col border-[5px] border-gray-800 bg-[#0b1220]">
                {tag}
                <p className="flex-1 flex items-center justify-center text-[44px] font-black text-gray-700">LIBRE</p>
              </div>
            )
          }
          const r = camionEnDarsena(n)
          return r ? (
            <div key={n} className="rounded-[20px] p-[18px] flex flex-col gap-2.5 border-[5px] border-amber-400 bg-amber-400/10" style={{ boxShadow: '0 0 32px rgba(251,191,36,0.25)' }}>
              {tag}
              <p className="text-[64px] font-black leading-none tracking-tight">{patente(r.camionLabel)}</p>
              <div className="flex flex-col gap-2 mt-1.5 min-h-0 overflow-hidden">
                {r.items.map((i) => filaProducto(i.productoId, corto(i.productoId, i.nombre), i.cantidad, 'rgba(251,191,36,0.25)'))}
              </div>
              <div className="mt-auto flex justify-between items-baseline">
                <span className="text-[26px] text-gray-400 truncate">{r.choferNombre}</span>
                {r.palletsCarga > 0 && <span className="text-[34px] font-black text-amber-300 shrink-0">{r.palletsCarga} PAL</span>}
              </div>
            </div>
          ) : (
            <div key={n} className="rounded-[20px] p-[18px] flex flex-col border-[5px] border-gray-800 bg-[#0b1220]">
              {tag}
              <p className="flex-1 flex items-center justify-center text-[44px] font-black text-gray-700">LIBRE</p>
            </div>
          )
        })}
      </div>

      {/* Fila inferior: PARA JUNTAR + SIGUEN */}
      <div className="flex gap-4 h-[250px] shrink-0">
        <div className="flex-[3] bg-gray-900 border-[5px] border-amber-700 rounded-[20px] px-[30px] py-5 flex flex-col min-w-0">
          <p className="text-[34px] font-black text-amber-400 tracking-[3px] mb-3">PARA JUNTAR → PRÓXIMO VIAJE</p>
          <div className="flex gap-10 items-baseline flex-1 overflow-hidden">
            {paraJuntar.length === 0 && <p className="text-[44px] font-black text-gray-700">—</p>}
            {paraJuntar.map((p) => (
              <div key={p.productoId} className="flex items-baseline gap-3.5 shrink-0">
                <span className="text-[110px] font-black text-amber-300 leading-none tabular-nums">{p.cantidad}</span>
                <span className="text-[44px] font-bold">{corto(p.productoId, p.nombre)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-[2] bg-gray-900 border-[5px] border-sky-900 rounded-[20px] px-[30px] py-5 flex flex-col min-w-0">
          <p className="text-[34px] font-black text-sky-400 tracking-[3px] mb-3">SIGUEN</p>
          <div className="flex gap-[18px] items-center flex-1 overflow-hidden">
            {colaTurnos.length === 0 && <p className="text-[44px] font-black text-gray-700">—</p>}
            {colaTurnos.slice(0, 6).map((v) => (
              <span key={v.id} className={`rounded-2xl px-[26px] py-2 text-[84px] font-black leading-none shrink-0 ${
                v.turnoEstado === 'preparado' ? 'bg-green-700' : 'bg-gray-800'
              }`}>
                {v.turno}
              </span>
            ))}
          </div>
          <p className="text-[26px] font-bold truncate">
            {ausentes.length > 0 && <span className="text-red-400">AUSENTE: {ausentes.map((v) => `T-${v.turno}`).join(', ')}</span>}
            {ausentes.length > 0 && (camionesEnEspera.length > 0 || listosParaSalir.length > 0) && <span className="text-gray-600"> · </span>}
            {camionesEnEspera.length > 0 && <span className="text-gray-400">ESPERA: {camionesEnEspera.map((r) => patente(r.camionLabel)).join(', ')}</span>}
            {camionesEnEspera.length > 0 && listosParaSalir.length > 0 && <span className="text-gray-600"> · </span>}
            {listosParaSalir.length > 0 && <span className="text-green-400">SALE: {listosParaSalir.map((r) => patente(r.camionLabel)).join(', ')}</span>}
          </p>
        </div>
      </div>
    </div>

    {/* Baliza: marco de toda la pantalla destellando mientras suena la bocina. */}
    {flash && (
      <div className="absolute inset-0 pointer-events-none animate-pulse z-50" style={{ boxShadow: 'inset 0 0 0 30px #f59e0b' }} />
    )}

    {/* Sonido de llegada: se arma con un toque al instalar el TV. */}
    <button
      onClick={sonido ? apagarSonido : activarSonido}
      className={`absolute bottom-3 right-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        sonido ? 'text-gray-600 hover:text-gray-400' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
      }`}
    >
      {sonido ? <Volume2 size={16} /> : <VolumeX size={16} />}
      {sonido ? 'Sonido activado' : 'Activar sonido'}
    </button>
    </div>
  )
}
