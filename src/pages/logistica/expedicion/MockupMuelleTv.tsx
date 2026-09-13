import { useEffect, useMemo, useRef, useState } from 'react'
import { SONIDOS, hayVozEnEspanol, tocarSonido } from '@/utils/bocinaMuelle'

/**
 * MAQUETA DESCARTABLE del televisor del muelle (2026-09-13) — NO ES PRODUCCIÓN.
 *
 * Ruta pública `/mockup-muelle-tv`: sin Firestore, sin login, con datos de
 * muestra adentro. Se abre en el televisor real (o en cualquier pantalla a
 * 1920×1080) para decidir el reparto de las cuatro zonas ANTES de tocar
 * MuelleTvPage, que es lo que va a estar colgado todo el día en las dársenas.
 *
 * Lo nuevo respecto del TV de hoy:
 *  1. Las dársenas de camión muestran PALLETS + BOLSAS SUELTAS en vez de un
 *     número de unidades suelto: el clarkista levanta pallets con la uña y
 *     estiba a mano el resto.
 *  2. Cronómetro de permanencia en dársena, que se pone en rojo al pasarse.
 *  3. ZONA NUEVA "VOLVIERON — FALTA CONTAR": la mitad que faltaba. Camiones que
 *     volvieron y no tienen descarga registrada. NUNCA muestra cantidades
 *     teóricas: el conteo es ciego y el TV no puede filtrar lo que esconde.
 *
 * La barra de abajo simula escenarios. El que importa es SATURADO: un tablero
 * que se ve bien con dos cosas y se rompe con diez no sirve.
 *
 * SE BORRA al aprobar el diseño (archivo + catálogo + <Route>).
 */

// ── Datos de muestra (patentes, choferes y clientes con el largo real) ────────

interface ItemMock { id: string; nombre: string; cantidad: number; porPallet: number }
interface CamionMock {
  darsena?: number
  patente: string
  chofer: string
  items: ItemMock[]
  /** Minutos que lleva en la dársena. */
  minutos: number
}
interface TurnoMock { turno: number; cliente: string; items: ItemMock[]; darsena?: number; preparado?: boolean }
interface RetornoMock { patente: string; chofer: string; hora: string; minutos: number; contando?: boolean }

const it = (id: string, nombre: string, cantidad: number, porPallet: number): ItemMock => ({ id, nombre, cantidad, porPallet })

const CAMIONES: CamionMock[] = [
  { darsena: 1, patente: 'AF985DC', chofer: 'González Gustavo Adrián', minutos: 12,
    items: [it('bolsa_2kg', '2kg', 920, 240), it('bolsa_10kg', '10kg', 40, 70)] },
  { darsena: 2, patente: 'AH954MH', chofer: 'Gallo Braian Agustin', minutos: 34,
    items: [it('bolsa_3kg', '3kg', 540, 180), it('escamas_10kg', 'ESCAMA', 85, 70), it('barra', 'BARRA', 12, 30)] },
  { darsena: 3, patente: 'AD772KR', chofer: 'Morinigo Raul Martin', minutos: 4,
    items: [it('bolsa_3kg', '3kg', 360, 180)] },
]

const TURNOS: TurnoMock[] = [
  { turno: 12, cliente: 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)', darsena: 4,
    items: [it('bolsa_3kg', '3kg', 40, 180), it('bolsa_10kg', '10kg', 6, 70)] },
  { turno: 13, cliente: 'DON SATUR S.R.L.', darsena: 5, items: [it('bolsa_2kg', '2kg', 25, 240)] },
  { turno: 14, cliente: 'CLUB NAUTICO SAN FERNANDO', preparado: true, items: [it('bolsa_3kg', '3kg', 30, 180)] },
  { turno: 15, cliente: '180BURGERBAR S.R.L.', items: [it('escamas_10kg', 'ESCAMA', 12, 70)] },
  { turno: 16, cliente: '1970 SRL (KOPI NUÑEZ)', items: [it('bolsa_3kg', '3kg', 20, 180)] },
  { turno: 17, cliente: '17 DE SEPTIEMBRE S.R.L.', items: [it('bolsa_10kg', '10kg', 8, 70)] },
  { turno: 18, cliente: 'PALITO', items: [it('bolsa_2kg', '2kg', 15, 240)] },
  { turno: 19, cliente: 'TEJADA', items: [it('bolsa_3kg', '3kg', 10, 180)] },
]

const RETORNOS: RetornoMock[] = [
  { patente: 'AC119PL', chofer: 'Gerez Ricardo Fabián', hora: '13:40', minutos: 48 },
  { patente: 'AB223XC', chofer: 'Primiterra Cristian O.', hora: '14:05', minutos: 23, contando: true },
  { patente: 'AA884JD', chofer: 'Álvarez Sergio Jesús', hora: '14:21', minutos: 7 },
]

// Minutos en dársena a partir de los cuales el cronómetro se pone en rojo.
const TOPE_DARSENA = 25

type Escenario = 'normal' | 'saturado' | 'vacio'

// ── Pallets completos + bolsas sueltas ───────────────────────────────────────
// El clarkista levanta pallets con la uña y estiba a mano el resto: 920 bolsas
// de 2kg son "3 PALLETS + 200 SUELTAS", no "920". (En producción `porPallet`
// sale de `unidadesPorPallet` del catálogo, que el TV de hoy no carga.)
const desglose = (i: ItemMock) => ({
  pallets: i.porPallet > 0 ? Math.floor(i.cantidad / i.porPallet) : 0,
  sueltas: i.porPallet > 0 ? i.cantidad % i.porPallet : i.cantidad,
})

export default function MockupMuelleTv() {
  const [escenario, setEscenario] = useState<Escenario>('normal')
  const [llamando, setLlamando] = useState(false)
  const [escala, setEscala] = useState(1)
  // Probador de sonidos: los navegadores solo dejan sonar tras un gesto humano,
  // así que el AudioContext se arma con el primer toque del botón.
  const [sonidos, setSonidos] = useState(false)
  // Las voces del navegador cargan asincrónicamente: se relee al abrir el panel.
  const [hayVoz, setHayVoz] = useState(true)
  const audioRef = useRef<AudioContext | null>(null)
  const probarSonidos = () => {
    try {
      if (!audioRef.current) audioRef.current = new AudioContext()
      audioRef.current.resume()
    } catch { /* sin soporte de audio */ }
    setHayVoz(hayVozEnEspanol())
    setSonidos((v) => !v)
  }
  const [ahora, setAhora] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])

  // Se dibuja a 1920×1080 lógicos y se escala entero, igual que MuelleTvPage:
  // el tablero entra SIEMPRE completo, sea el televisor que sea.
  useEffect(() => {
    const ajustar = () => setEscala(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])

  const { camiones, turnos, retornos } = useMemo(() => {
    if (escenario === 'vacio') return { camiones: [], turnos: [], retornos: [] }
    if (escenario === 'saturado') return { camiones: CAMIONES, turnos: TURNOS, retornos: RETORNOS }
    return { camiones: CAMIONES.slice(0, 2), turnos: TURNOS.slice(0, 3), retornos: RETORNOS.slice(0, 1) }
  }, [escenario])

  const enDarsena = (n: number) => camiones.find((c) => c.darsena === n)
  const turnoEn = (n: number) => turnos.find((t) => t.darsena === n)
  const cola = turnos.filter((t) => !t.darsena)

  // PARA JUNTAR: un solo viaje a la cámara con todo lo de la cola.
  const paraJuntar = useMemo(() => {
    const m = new Map<string, ItemMock>()
    cola.forEach((t) => t.items.forEach((i) => {
      const p = m.get(i.id) ?? { ...i, cantidad: 0 }
      m.set(i.id, { ...p, cantidad: p.cantidad + i.cantidad })
    }))
    return [...m.values()]
  }, [cola])

  return (
    <div className="h-screen h-dvh w-screen overflow-hidden bg-gray-950 relative">
      <div className="bg-gray-950 text-white p-6 flex flex-col gap-4 absolute left-1/2 top-1/2"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${escala})` }}>

        {/* Header */}
        <div className="flex items-center gap-4 h-[84px] shrink-0">
          <p className="text-2xl font-bold text-gray-500 shrink-0">MUELLE · DON TORCUATO</p>
          {llamando ? (
            <div className="flex-1 bg-green-600 rounded-2xl text-center py-2 animate-pulse"
              style={{ boxShadow: '0 0 40px rgba(22,163,74,0.45)' }}>
              <span className="text-[54px] font-black leading-none">TURNO 14 → DÁRSENA 5</span>
            </div>
          ) : <div className="flex-1" />}
          <p className="text-[40px] font-black tabular-nums shrink-0">
            {ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
        </div>

        {/* Fila principal: 3 dársenas de camión + la columna de retornos */}
        <div className="flex gap-4" style={{ height: 516 }}>
          <div className="flex-1 grid grid-cols-3 gap-4 min-w-0">
            {[1, 2, 3].map((n) => <DarsenaCamion key={n} n={n} c={enDarsena(n)} />)}
          </div>
          <Retornos retornos={retornos} />
        </div>

        {/* Ventanilla */}
        <div className="grid grid-cols-2 gap-4" style={{ height: 168 }}>
          {[4, 5].map((n) => <DarsenaVentanilla key={n} n={n} t={turnoEn(n)} />)}
        </div>

        {/* Anticipación de cámara */}
        <div className="flex gap-4 flex-1 min-h-0">
          <div className="flex-[3] bg-gray-900 border-[5px] border-amber-700 rounded-[20px] px-7 py-4 flex flex-col min-w-0">
            <p className="text-[30px] font-black text-amber-400 tracking-[3px] mb-2">PARA JUNTAR → PRÓXIMO VIAJE</p>
            <div className="flex gap-10 items-baseline flex-1 overflow-hidden">
              {paraJuntar.length === 0 && <p className="text-[40px] font-black text-gray-700">—</p>}
              {paraJuntar.map((p) => (
                <div key={p.id} className="flex items-baseline gap-3 shrink-0">
                  <span className="text-[72px] font-black text-amber-300 leading-none tabular-nums">{p.cantidad}</span>
                  <span className="text-[38px] font-bold">{p.nombre}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-[2] bg-gray-900 border-[5px] border-sky-900 rounded-[20px] px-7 py-4 flex flex-col min-w-0">
            <p className="text-[30px] font-black text-sky-400 tracking-[3px] mb-2">SIGUEN</p>
            <div className="flex gap-3 items-center flex-1 overflow-hidden">
              {cola.length === 0 && <p className="text-[40px] font-black text-gray-700">—</p>}
              {cola.slice(0, 5).map((t) => (
                <span key={t.turno} className={`rounded-2xl px-6 py-1.5 text-[70px] font-black leading-none shrink-0 ${
                  t.preparado ? 'bg-green-700' : 'bg-gray-800'
                }`}>{t.turno}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Andamio de la maqueta: NO va en producción. */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-2 flex items-center gap-3 text-xs">
        <span className="uppercase tracking-widest text-gray-500">Maqueta</span>
        {(['normal', 'saturado', 'vacio'] as const).map((e) => (
          <button key={e} onClick={() => setEscenario(e)}
            className={`rounded px-3 py-1.5 font-semibold capitalize ${escenario === e ? 'bg-accent' : 'bg-white/10 text-gray-300'}`}>
            {e}
          </button>
        ))}
        <button onClick={() => setLlamando((v) => !v)}
          className={`rounded px-3 py-1.5 font-semibold ${llamando ? 'bg-green-600' : 'bg-white/10 text-gray-300'}`}>
          Llamando turno
        </button>
        <button onClick={probarSonidos}
          className={`rounded px-3 py-1.5 font-semibold ${sonidos ? 'bg-accent' : 'bg-white/10 text-gray-300'}`}>
          🔊 Probar sonidos
        </button>
        <span className="ml-auto text-gray-500">datos inventados · no toca Firestore · se borra al aprobar</span>
      </div>

      {/* Probador de sonidos: hay que escucharlos por los parlantes del TV, con
          el ruido de la planta. Los cuatro primeros están pensados uno por
          EVENTO, para que el muelle sepa qué pasó sin levantar la vista. */}
      {sonidos && (
        <div className="absolute bottom-14 left-4 right-4 bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm font-bold text-gray-200">Probá cada sonido por los parlantes del televisor</p>
            <button onClick={() => setSonidos(false)} className="text-xs text-gray-500 hover:text-gray-300">Cerrar</button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SONIDOS.map((s) => (
              <button key={s.id} onClick={() => tocarSonido(audioRef.current, s.id)}
                className={`text-left rounded-lg px-3 py-2 border transition-colors ${
                  s.para ? 'bg-accent/10 border-accent/40 hover:bg-accent/20' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                }`}>
                <p className="text-sm font-semibold text-gray-100">{s.nombre}</p>
                {s.para && <p className="text-[11px] text-accent font-medium">{s.para}</p>}
                <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{s.detalle}</p>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-600 mt-2">
            Los de arriba están pensados uno por evento; los de abajo son los "fuertes", para cortar el ruido de las máquinas.
          </p>
          {/* La voz depende del aparato: si este televisor no trae voz en
              español, los avisos hablados no dicen nada. Mejor saberlo acá que
              el día que esté colgado. */}
          {!hayVoz && (
            <p className="text-[11px] text-amber-400 mt-1">
              Ojo: este aparato no tiene voz en español instalada, así que los dos avisos hablados no se van a escuchar. Probalos en el televisor antes de elegirlos.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Dársena de camión ────────────────────────────────────────────────────────

function DarsenaCamion({ n, c }: { n: number; c?: CamionMock }) {
  const pasado = !!c && c.minutos >= TOPE_DARSENA
  return (
    <div className={`rounded-[20px] p-4 flex flex-col border-[5px] min-w-0 ${
      c ? 'border-amber-400 bg-amber-400/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={c ? { boxShadow: '0 0 32px rgba(251,191,36,0.25)' } : undefined}>
      <div className="flex justify-between items-baseline">
        <span className="text-4xl font-black text-gray-500">{n}</span>
        <span className={`text-base font-bold tracking-[3px] ${c ? 'text-amber-500' : 'text-gray-700'}`}>
          {c ? 'CARGANDO' : 'LIBRE'}
        </span>
      </div>
      {!c ? (
        <p className="flex-1 flex items-center justify-center text-[40px] font-black text-gray-700">LIBRE</p>
      ) : (
        <>
          <p className="text-[56px] font-black leading-none tracking-tight mt-1">{c.patente}</p>
          <div className="flex flex-col gap-2 mt-3 flex-1 min-h-0 overflow-hidden">
            {c.items.map((i) => {
              const { pallets, sueltas } = desglose(i)
              return (
                <div key={i.id} className="pb-1.5" style={{ borderBottom: '2px solid rgba(251,191,36,0.25)' }}>
                  <div className="flex justify-between items-baseline">
                    <span className="text-[34px] font-bold text-gray-200 leading-none">{i.nombre}</span>
                    {pallets > 0 && (
                      <span className="text-[52px] font-black leading-none tabular-nums text-amber-300">
                        {pallets}<span className="text-[26px] ml-1">PAL</span>
                      </span>
                    )}
                  </div>
                  {sueltas > 0 && (
                    <p className="text-[30px] font-bold text-gray-300 leading-tight tabular-nums">
                      + {sueltas} sueltas
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-between items-baseline mt-auto pt-2">
            <span className="text-[22px] text-gray-400 truncate min-w-0" title={c.chofer}>{c.chofer}</span>
            {/* Cuánto hace que ocupa la boca: en rojo cuando se pasa. */}
            <span className={`text-[30px] font-black tabular-nums shrink-0 ml-2 ${pasado ? 'text-red-400' : 'text-gray-400'}`}>
              {c.minutos}′
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Dársena de ventanilla ────────────────────────────────────────────────────

function DarsenaVentanilla({ n, t }: { n: number; t?: TurnoMock }) {
  return (
    <div className={`rounded-[20px] px-4 py-3 flex items-center gap-5 border-[5px] min-w-0 ${
      t ? 'border-green-500 bg-green-500/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={t ? { boxShadow: '0 0 32px rgba(34,197,94,0.3)' } : undefined}>
      <div className="flex flex-col items-center shrink-0">
        <span className="text-3xl font-black text-gray-500 leading-none">{n}</span>
        <span className="text-[13px] font-bold tracking-[3px] text-sky-400 mt-1">VENTANILLA</span>
      </div>
      {!t ? (
        <p className="flex-1 text-center text-[40px] font-black text-gray-700">LIBRE</p>
      ) : (
        <>
          <p className="text-[76px] font-black leading-none text-green-400 shrink-0">T-{t.turno}</p>
          <div className="flex gap-6 items-baseline flex-1 min-w-0 overflow-hidden shrink-0">
            {t.items.map((i) => (
              <div key={i.id} className="flex items-baseline gap-2 shrink-0">
                <span className="text-[52px] font-black leading-none tabular-nums">{i.cantidad}</span>
                <span className="text-[28px] font-bold text-gray-300">{i.nombre}</span>
              </div>
            ))}
          </div>
          <span className="text-[20px] text-gray-400 truncate max-w-[260px] shrink-0" title={t.cliente}>{t.cliente}</span>
        </>
      )}
    </div>
  )
}

// ── Zona 3: la mitad que faltaba ─────────────────────────────────────────────

function Retornos({ retornos }: { retornos: RetornoMock[] }) {
  const hay = retornos.length > 0
  return (
    <div className={`w-[440px] shrink-0 rounded-[20px] border-[5px] px-5 py-4 flex flex-col ${
      hay ? 'border-red-500 bg-red-500/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={hay ? { boxShadow: '0 0 32px rgba(239,68,68,0.25)' } : undefined}>
      <div className="flex items-baseline justify-between mb-3">
        <p className={`text-[28px] font-black tracking-[2px] ${hay ? 'text-red-400' : 'text-gray-700'}`}>
          VOLVIERON
        </p>
        {hay && (
          <span className="text-[44px] font-black leading-none text-red-400 tabular-nums">{retornos.length}</span>
        )}
      </div>
      <p className={`text-[19px] font-bold tracking-[2px] -mt-2 mb-3 ${hay ? 'text-red-300/70' : 'text-gray-700'}`}>
        FALTA CONTAR
      </p>
      {!hay ? (
        <p className="flex-1 flex items-center justify-center text-[34px] font-black text-gray-700 text-center">
          NADA<br />PENDIENTE
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-hidden">
          {retornos.map((r) => (
            <div key={r.patente} className={`rounded-2xl px-4 py-2.5 ${r.contando ? 'bg-amber-500/20 border-2 border-amber-500' : 'bg-black/30'}`}>
              <div className="flex justify-between items-baseline">
                <span className="text-[40px] font-black leading-none tracking-tight">{r.patente}</span>
                <span className={`text-[30px] font-black tabular-nums ${r.minutos >= 30 ? 'text-red-400' : 'text-gray-300'}`}>
                  {r.minutos}′
                </span>
              </div>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-[20px] text-gray-400 truncate min-w-0" title={r.chofer}>{r.chofer}</span>
                <span className={`text-[17px] font-bold tracking-wider shrink-0 ml-2 ${r.contando ? 'text-amber-400' : 'text-gray-500'}`}>
                  {r.contando ? 'CONTANDO' : `LLEGÓ ${r.hora}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
