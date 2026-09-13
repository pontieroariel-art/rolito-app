import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCatalogo } from '@/hooks/useCatalogo'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { useRemitosCargaDelDia, useVentanillaDelDia } from '@/hooks/useExpedicionDia'
import { subscribeDescargasDelDia } from '@/services/descargaCamionService'
import {
  DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA, DescargaCamion, PLANTAS, RemitoCarga, VentaVentanilla,
} from '@/types'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import {
  SONIDOS, guardarSonidoElegido, leerSonidoElegido, tocarSonido, type SonidoMuelle,
} from '@/utils/bocinaMuelle'

// Tablero de TV del muelle (/muelle/tv) — diseño "E1 Neón oscuro" elegido por
// Ariel (2026-08-30) sobre la info de la variante E "Operativo": los
// clarkistas y el personal NO tienen tablet en mano, así que las cantidades
// viven acá, enormes, legibles desde el autoelevador. Se dibuja a 1920x1080
// lógicos y se escala entero a la pantalla real. Suena una alarma cuando entra
// trabajo nuevo — el sonido se activa una vez al montar el TV (los navegadores
// exigen un toque humano).
//
// CUATRO ZONAS (rediseño 2026-09-13, maqueta aprobada en el televisor real):
//  1. Dársenas de camión, con PALLETS + BOLSAS SUELTAS y cronómetro de boca.
//  2. Ventanilla: turno, bultos y cliente.
//  3. VOLVIERON — FALTA CONTAR: la mitad que faltaba. El tablero avisaba de
//     todo lo que entra y nada de lo que vuelve, que es justo el control contra
//     las fugas. NUNCA muestra cantidades teóricas: el conteo de la descarga es
//     ciego y el TV no puede filtrar lo que esconde.
//  4. Anticipación de cámara: PARA JUNTAR (un solo viaje) y la cola SIGUEN.
export default function MuelleTvPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const totalDarsenas = DARSENAS_POR_PLANTA[plantaId]
  const dVentanilla   = DARSENAS_VENTANILLA[plantaId]
  const fecha = useFechaDelDia()

  const remitos = useRemitosCargaDelDia(plantaId, fecha)
  const ventanillas = useVentanillaDelDia(plantaId, fecha)
  const { catalogo } = useCatalogo()
  // Descargas del día: para saber a qué camión que volvió YA le contaron.
  const [descargas, setDescargas] = useState<DescargaCamion[]>([])
  useEffect(() => subscribeDescargasDelDia(plantaId, fecha, setDescargas), [plantaId, fecha])
  const [ahora,  setAhora]  = useState(Date.now())
  const [escala, setEscala] = useState(1)
  const [sonido, setSonido] = useState(false)

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

  // ── Aviso de llegada ── el muelle tiene MUCHO ruido ambiente (dato de
  // Ariel): esto no es una campanita de escritorio, tiene que cortar el ruido
  // de las máquinas y escucharse a diez metros. Hay CINCO sonidos para elegir
  // (utils/bocinaMuelle.ts) porque lo que funciona en una planta molesta en
  // otra: se prueban desde el propio TV, con el ruido real, y la elección queda
  // guardada en el aparato. Va con un destello de toda la pantalla como baliza,
  // por si igual no se escucha.
  //
  // Los navegadores solo dejan sonar tras un gesto humano: el botón de abajo a
  // la derecha arma el audio una vez al instalar el TV.
  const audioRef = useRef<AudioContext | null>(null)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cuál de los sonidos suena, elegido en el propio TV y guardado en el
  // aparato: lo que corta el ruido de una planta molesta en otra, así que se
  // prueba ahí con el ruido real (SONIDOS en utils/bocinaMuelle.ts).
  const [sonidoElegido, setSonidoElegido] = useState<SonidoMuelle>(leerSonidoElegido)
  const [eligiendo, setEligiendo] = useState(false)
  const bocina = useCallback(() => tocarSonido(audioRef.current, sonidoElegido), [sonidoElegido])
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
  const idsVistos = useRef<{ remitos: Set<string> | null; ventanillas: Set<string> | null; regresos: Set<string> | null }>(
    { remitos: null, ventanillas: null, regresos: null },
  )
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
  // Un camión que vuelve también es trabajo nuevo para el muelle: hay que ir a
  // contarle la descarga.
  useEffect(() => {
    const conRegreso = remitos.filter((r) => r.regreso).map((r) => r.id)
    const previos = idsVistos.current.regresos
    if (previos && sonido && conRegreso.some((id) => !previos.has(id))) alarmaLlegada()
    idsVistos.current.regresos = new Set(conRegreso)
  }, [remitos, sonido, alarmaLlegada])

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

  // Volvieron y falta contarles la descarga. El regreso lo marca seguridad en
  // el portón o el propio chofer (`remitosCarga.regreso`, 2026-09-13); ya
  // contado = hay una descarga de ese chofer hoy.
  const contados = useMemo(() => new Set(descargas.map((d) => d.choferId)), [descargas])
  const retornos = useMemo(() => remitos
    .filter((r) => r.regreso && !contados.has(r.choferId))
    .sort((a, b) => (a.regreso!.hora.toMillis() - b.regreso!.hora.toMillis())),
  [remitos, contados])

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
  const minutosDesde = (t: { toMillis(): number }) => Math.max(0, Math.round((ahora - t.toMillis()) / 60_000))
  const horaDe = (t: { toDate(): Date }) => t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

  // Nombre corto de producto, para leerse desde el autoelevador.
  const ETIQUETAS: Record<string, string> = {
    bolsa_2kg: '2kg', bolsa_3kg: '3kg', bolsa_10kg: '10kg',
    picado_10kg: 'PICADO', escamas_10kg: 'ESCAMA', barra: 'BARRA',
    anticorrosivo: 'ANTIC.', agua_6l: 'AGUA',
  }
  const corto = (productoId: string, nombre: string) =>
    ETIQUETAS[productoId] ?? (nombre.match(/\d+\s?kg/i)?.[0].replace(/\s/g, '') ?? nombre.split(' ')[0].toUpperCase().slice(0, 7))

  // Pallets completos + bolsas sueltas: el clarkista levanta pallets con la uña
  // y estiba a mano el resto, así que 920 bolsas de 2kg son "3 PAL + 200
  // sueltas" y no "920" (el remito ya trae `pallets`, pero es el REDONDEO HACIA
  // ARRIBA de los que ocupa — sirve para el camión, no para la uña).
  const porPallet = (productoId: string) => catalogo.find((p) => p.id === productoId)?.unidadesPorPallet ?? 0
  const desglose = (productoId: string, cantidad: number) => {
    const upp = porPallet(productoId)
    return upp > 0
      ? { pallets: Math.floor(cantidad / upp), sueltas: cantidad % upp }
      : { pallets: 0, sueltas: cantidad }
  }

  return (
    <div className="h-screen h-dvh w-screen overflow-hidden bg-gray-950 relative">
    <div
      className="bg-gray-950 text-white p-6 flex flex-col gap-4 absolute left-1/2 top-1/2"
      style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${escala})` }}
    >
      {/* Header + llamado */}
      <div className="flex items-center gap-4 h-[84px] shrink-0">
        <p className="text-2xl font-bold text-gray-500 shrink-0">MUELLE · {PLANTAS[plantaId].label.toUpperCase().replace('PLANTA ', '')}</p>
        {llamadoReciente ? (
          <div className="flex-1 bg-green-600 rounded-2xl text-center py-2 animate-pulse" style={{ boxShadow: '0 0 40px rgba(22,163,74,0.45)' }}>
            <span className="text-[54px] font-black leading-none">TURNO {llamadoReciente.turno} → DÁRSENA {llamadoReciente.darsena}</span>
          </div>
        ) : <div className="flex-1" />}
        <p className="text-[40px] font-black tabular-nums shrink-0">
          {new Date(ahora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </p>
      </div>

      {/* Zona 1 (dársenas de camión) + Zona 3 (retornos) */}
      <div className="flex gap-4" style={{ height: 516 }}>
        <div className="flex-1 grid gap-4 min-w-0"
          style={{ gridTemplateColumns: `repeat(${totalDarsenas - dVentanilla.length}, minmax(0, 1fr))` }}>
          {Array.from({ length: totalDarsenas }, (_, i) => i + 1)
            .filter((n) => !dVentanilla.includes(n))
            .map((n) => {
              const r = camionEnDarsena(n)
              return <DarsenaCamion key={n} n={n} r={r} corto={corto} desglose={desglose} minutos={r ? minutosDesde(r.fecha) : 0} />
            })}
        </div>
        <Retornos retornos={retornos} patente={patente} minutosDesde={minutosDesde} horaDe={horaDe} />
      </div>

      {/* Zona 2: ventanilla */}
      <div className="grid gap-4" style={{ height: 168, gridTemplateColumns: `repeat(${dVentanilla.length}, minmax(0, 1fr))` }}>
        {dVentanilla.map((n) => <DarsenaVentanilla key={n} n={n} v={turnoEnDarsena(n)} corto={corto} />)}
      </div>

      {/* Zona 4: anticipación de cámara */}
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-[3] bg-gray-900 border-[5px] border-amber-700 rounded-[20px] px-7 py-4 flex flex-col min-w-0">
          <p className="text-[30px] font-black text-amber-400 tracking-[3px] mb-2">PARA JUNTAR → PRÓXIMO VIAJE</p>
          <div className="flex gap-10 items-baseline flex-1 overflow-hidden">
            {paraJuntar.length === 0 && <p className="text-[40px] font-black text-gray-700">—</p>}
            {paraJuntar.map((p) => (
              <div key={p.productoId} className="flex items-baseline gap-3 shrink-0">
                <span className="text-[72px] font-black text-amber-300 leading-none tabular-nums">{p.cantidad}</span>
                <span className="text-[38px] font-bold">{corto(p.productoId, p.nombre)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-[2] bg-gray-900 border-[5px] border-sky-900 rounded-[20px] px-7 py-4 flex flex-col min-w-0">
          <p className="text-[30px] font-black text-sky-400 tracking-[3px] mb-2">SIGUEN</p>
          <div className="flex gap-3 items-center flex-1 overflow-hidden">
            {colaTurnos.length === 0 && <p className="text-[40px] font-black text-gray-700">—</p>}
            {colaTurnos.slice(0, 5).map((v) => (
              <span key={v.id} className={`rounded-2xl px-6 py-1.5 text-[70px] font-black leading-none shrink-0 ${
                v.turnoEstado === 'preparado' ? 'bg-green-700' : 'bg-gray-800'
              }`}>
                {v.turno}
              </span>
            ))}
          </div>
          <p className="text-[22px] font-bold truncate">
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

    {/* Sonido de llegada: se arma con un toque al instalar el TV, y ahí mismo se
        elige cuál suena — probándolo con el ruido de la planta, que es la única
        forma de saber si se escucha. */}
    <div className="absolute bottom-3 right-3 flex items-end gap-2">
      {eligiendo && sonido && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 w-[420px] space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Sonido del aviso</p>
          {SONIDOS.map((s) => (
            <button key={s.id} onClick={() => { setSonidoElegido(s.id); guardarSonidoElegido(s.id); tocarSonido(audioRef.current, s.id) }}
              className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                sonidoElegido === s.id ? 'bg-accent/20 border border-accent' : 'bg-gray-800 border border-transparent hover:bg-gray-700'
              }`}>
              <p className="text-sm font-semibold text-gray-100">{s.nombre}{sonidoElegido === s.id ? ' ✓' : ''}</p>
              <p className="text-xs text-gray-400">{s.detalle}</p>
            </button>
          ))}
          <p className="text-[11px] text-gray-600 pt-1">Tocá cualquiera para escucharla. Queda guardada en este televisor.</p>
        </div>
      )}
      <div className="flex flex-col items-end gap-1">
        {sonido && (
          <button onClick={() => setEligiendo((v) => !v)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-400">
            {eligiendo ? 'Listo' : 'Cambiar sonido'}
          </button>
        )}
        <button
          onClick={sonido ? apagarSonido : activarSonido}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            sonido ? 'text-gray-600 hover:text-gray-500' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
          }`}
        >
          {sonido ? <Volume2 size={16} /> : <VolumeX size={16} />}
          {sonido ? 'Sonido activado' : 'Activar sonido'}
        </button>
      </div>
    </div>
    </div>
  )
}

// Minutos en la dársena a partir de los cuales el cronómetro pasa a rojo.
const TOPE_DARSENA_MIN = 25

function DarsenaCamion({ n, r, corto, desglose, minutos }: {
  n: number
  r?: RemitoCarga
  corto: (id: string, nombre: string) => string
  desglose: (id: string, cantidad: number) => { pallets: number; sueltas: number }
  minutos: number
}) {
  const tag = (
    <div className="flex justify-between items-baseline">
      <span className="text-4xl font-black text-gray-500">{n}</span>
      <span className={`text-base font-bold tracking-[3px] ${r ? 'text-amber-500' : 'text-gray-700'}`}>
        {r ? 'CARGANDO' : 'LIBRE'}
      </span>
    </div>
  )
  if (!r) {
    return (
      <div className="rounded-[20px] p-4 flex flex-col border-[5px] border-gray-800 bg-[#0b1220]">
        {tag}
        <p className="flex-1 flex items-center justify-center text-[40px] font-black text-gray-700">LIBRE</p>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] p-4 flex flex-col border-[5px] border-amber-400 bg-amber-400/10 min-w-0"
      style={{ boxShadow: '0 0 32px rgba(251,191,36,0.25)' }}>
      {tag}
      <p className="text-[56px] font-black leading-none tracking-tight mt-1">{r.camionLabel.split('·')[0].trim()}</p>
      <div className="flex flex-col gap-2 mt-3 flex-1 min-h-0 overflow-hidden">
        {r.items.map((i) => {
          const { pallets, sueltas } = desglose(i.productoId, i.cantidad)
          return (
            <div key={i.productoId} className="pb-1.5" style={{ borderBottom: '2px solid rgba(251,191,36,0.25)' }}>
              <div className="flex justify-between items-baseline">
                <span className="text-[34px] font-bold text-gray-200 leading-none">{corto(i.productoId, i.nombre)}</span>
                {pallets > 0
                  ? <span className="text-[52px] font-black leading-none tabular-nums text-amber-300">{pallets}<span className="text-[26px] ml-1">PAL</span></span>
                  : <span className="text-[52px] font-black leading-none tabular-nums">{i.cantidad}</span>}
              </div>
              {pallets > 0 && sueltas > 0 && (
                <p className="text-[30px] font-bold text-gray-300 leading-tight tabular-nums">+ {sueltas} sueltas</p>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-between items-baseline mt-auto pt-2">
        <span className="text-[22px] text-gray-400 truncate min-w-0" title={r.choferNombre}>{r.choferNombre}</span>
        {/* Cuánto hace que ocupa la boca: en rojo cuando se pasa. */}
        <span className={`text-[30px] font-black tabular-nums shrink-0 ml-2 ${minutos >= TOPE_DARSENA_MIN ? 'text-red-400' : 'text-gray-400'}`}>
          {minutos}′
        </span>
      </div>
    </div>
  )
}

function DarsenaVentanilla({ n, v, corto }: {
  n: number; v?: VentaVentanilla; corto: (id: string, nombre: string) => string
}) {
  return (
    <div className={`rounded-[20px] px-4 py-3 flex items-center gap-5 border-[5px] min-w-0 ${
      v ? 'border-green-500 bg-green-500/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={v ? { boxShadow: '0 0 32px rgba(34,197,94,0.3)' } : undefined}>
      <div className="flex flex-col items-center shrink-0">
        <span className="text-3xl font-black text-gray-500 leading-none">{n}</span>
        <span className="text-[13px] font-bold tracking-[3px] text-sky-400 mt-1">VENTANILLA</span>
      </div>
      {!v ? (
        <p className="flex-1 text-center text-[40px] font-black text-gray-700">LIBRE</p>
      ) : (
        <>
          <p className="text-[76px] font-black leading-none text-green-400 shrink-0">T-{v.turno}</p>
          <div className="flex gap-6 items-baseline flex-1 min-w-0 overflow-hidden shrink-0">
            {v.items.map((i) => (
              <div key={i.productoId} className="flex items-baseline gap-2 shrink-0">
                <span className="text-[52px] font-black leading-none tabular-nums">{i.cantidad}</span>
                <span className="text-[28px] font-bold text-gray-300">{corto(i.productoId, i.nombre)}</span>
              </div>
            ))}
          </div>
          <span className="text-[20px] text-gray-400 truncate max-w-[260px] shrink-0" title={nombreClienteVenta(v)}>
            {nombreClienteVenta(v)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * Zona 3 — VOLVIERON, FALTA CONTAR (2026-09-13).
 *
 * El tablero avisaba de todo lo que entra a la planta y nada de lo que vuelve,
 * que es justo donde está el control contra las fugas: sin la descarga contada,
 * la liquidación compara la devolución contra cero y todo lo que el chofer no
 * vendió aparece como faltante.
 *
 * NO muestra cantidades esperadas, a propósito: el conteo es ciego. Si el TV
 * cantara cuánto tiene que volver, el que cuenta tildaría ese número.
 */
function Retornos({ retornos, patente, minutosDesde, horaDe }: {
  retornos: RemitoCarga[]
  patente: (label: string) => string
  minutosDesde: (t: { toMillis(): number }) => number
  horaDe: (t: { toDate(): Date }) => string
}) {
  const hay = retornos.length > 0
  return (
    <div className={`w-[440px] shrink-0 rounded-[20px] border-[5px] px-5 py-4 flex flex-col ${
      hay ? 'border-red-500 bg-red-500/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={hay ? { boxShadow: '0 0 32px rgba(239,68,68,0.25)' } : undefined}>
      <div className="flex items-baseline justify-between mb-3">
        <p className={`text-[28px] font-black tracking-[2px] ${hay ? 'text-red-400' : 'text-gray-700'}`}>VOLVIERON</p>
        {hay && <span className="text-[44px] font-black leading-none text-red-400 tabular-nums">{retornos.length}</span>}
      </div>
      <p className={`text-[19px] font-bold tracking-[2px] -mt-2 mb-3 ${hay ? 'text-red-300/70' : 'text-gray-700'}`}>
        FALTA CONTAR
      </p>
      {!hay ? (
        <p className="flex-1 flex items-center justify-center text-[34px] font-black text-gray-700 text-center">NADA<br />PENDIENTE</p>
      ) : (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-hidden">
          {retornos.map((r) => {
            const espera = minutosDesde(r.regreso!.hora)
            return (
              <div key={r.id} className="rounded-2xl px-4 py-2.5 bg-black/30">
                <div className="flex justify-between items-baseline">
                  <span className="text-[40px] font-black leading-none tracking-tight">{patente(r.camionLabel)}</span>
                  <span className={`text-[30px] font-black tabular-nums ${espera >= 30 ? 'text-red-400' : 'text-gray-300'}`}>
                    {espera}′
                  </span>
                </div>
                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-[20px] text-gray-400 truncate min-w-0" title={r.choferNombre}>{r.choferNombre}</span>
                  <span className="text-[17px] font-bold tracking-wider shrink-0 ml-2 text-gray-500">
                    LLEGÓ {horaDe(r.regreso!.hora)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
