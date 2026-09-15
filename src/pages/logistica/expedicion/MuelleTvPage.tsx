import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { describirComprobante } from '@/utils/comprobanteDeVenta'
import {
  EVENTOS, SONIDOS, guardarSonidos, leerSonidos, tocarSonido,
  type EventoMuelle, type SonidoMuelle, type SonidosPorEvento,
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
  // De izquierda a derecha como se ven desde la tele: 5 4 3 2 1. Si en Merlo la numeración
  // va al revés, este es el único lugar que hay que tocar.
  const ordenFisico   = useMemo(() => Array.from({ length: totalDarsenas }, (_, i) => totalDarsenas - i), [totalDarsenas])
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

  // ── Avisos ── el muelle tiene MUCHO ruido ambiente (dato de Ariel): esto no
  // es una campanita de escritorio, tiene que cortar el ruido de las máquinas y
  // escucharse a diez metros. Va con un destello de toda la pantalla como
  // baliza, por si igual no se escucha.
  //
  // UN SONIDO POR EVENTO (2026-09-13): así el muelle sabe QUÉ pasó sin levantar
  // la vista. El llamado de turno HABLA —dice un número y una dársena que de un
  // tono no se deducen— y el resto son tonos, porque un aviso hablado cada cinco
  // minutos termina con alguien bajándole el volumen al televisor. Se eligen y
  // se escuchan desde el propio TV, con el ruido real, y quedan guardados en el
  // aparato (utils/bocinaMuelle.ts).
  //
  // Los navegadores solo dejan sonar tras un gesto humano: el botón de abajo a
  // la derecha arma el audio una vez al instalar el TV.
  const audioRef = useRef<AudioContext | null>(null)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sonidos, setSonidos] = useState<SonidosPorEvento>(leerSonidos)
  const [eligiendo, setEligiendo] = useState(false)
  // Baliza visual: toda la pantalla destella unos segundos junto con el aviso.
  const balizar = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(true)
    flashTimer.current = setTimeout(() => setFlash(false), 5_000)
  }, [])
  // Cada evento con su aviso: el muelle sabe QUÉ pasó sin levantar la vista.
  const avisar = useCallback((evento: EventoMuelle, texto?: string) => {
    tocarSonido(audioRef.current, sonidos[evento], texto)
    balizar()
  }, [sonidos, balizar])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])
  const activarSonido = () => {
    try {
      if (!audioRef.current) audioRef.current = new AudioContext()
      audioRef.current.resume()
      setSonido(true)
      avisar('entra')   // ráfaga de prueba, para calibrar el volumen del TV
    } catch { /* sin soporte de audio */ }
  }
  const apagarSonido = () => setSonido(false)

  // Suena cuando aparece un id NUEVO (nunca en la carga inicial de la página).
  const idsVistos = useRef<{
    remitos: Set<string> | null; ventanillas: Set<string> | null
    regresos: Set<string> | null; llamados: Set<string> | null; demorados: Set<string>
  }>({ remitos: null, ventanillas: null, regresos: null, llamados: null, demorados: new Set() })

  useEffect(() => {
    const previos = idsVistos.current.remitos
    if (previos && sonido && remitos.some((r) => !previos.has(r.id))) avisar('entra')
    idsVistos.current.remitos = new Set(remitos.map((r) => r.id))
  }, [remitos, sonido, avisar])
  useEffect(() => {
    const previos = idsVistos.current.ventanillas
    if (previos && sonido && ventanillas.some((v) => !previos.has(v.id))) avisar('entra')
    idsVistos.current.ventanillas = new Set(ventanillas.map((v) => v.id))
  }, [ventanillas, sonido, avisar])
  // Un camión que vuelve también es trabajo para el muelle: hay que ir a
  // contarle la descarga.
  useEffect(() => {
    const conRegreso = remitos.filter((r) => r.regreso).map((r) => r.id)
    const previos = idsVistos.current.regresos
    if (previos && sonido && conRegreso.some((id) => !previos.has(id))) avisar('retorno')
    idsVistos.current.regresos = new Set(conRegreso)
  }, [remitos, sonido, avisar])
  // Llamado de turno: el único aviso que HABLA, porque tiene que decir un número
  // y una dársena que de un tono no se deducen.
  useEffect(() => {
    const llamados = ventanillas.filter((v) => v.turnoEstado === 'llamado' && v.darsena)
    const previos = idsVistos.current.llamados
    const nuevo = previos && llamados.find((v) => !previos.has(`${v.id}_${v.darsena}`))
    if (nuevo && sonido) avisar('llamado', `Turno ${nuevo.turno}, dársena ${nuevo.darsena}`)
    idsVistos.current.llamados = new Set(llamados.map((v) => `${v.id}_${v.darsena}`))
  }, [ventanillas, sonido, avisar])

  // ── Datos derivados ──
  const camionEnDarsena = (n: number) => remitos.find((r) => r.estado === 'emitido' && r.darsena === n)
  const turnoEnDarsena  = (n: number) =>
    ventanillas.find((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'llamado' && v.darsena === n)

  // Derivados memoizados por fuente (2026-09-14): `ahora` cambia cada 10 s y
  // repinta el tablero; sin memo, cada tick volvía a filtrar y ordenar todo y
  // las zonas hijas recibían arrays y closures nuevas.
  const camionesEnEspera = useMemo(() => remitos.filter((r) => r.estado === 'emitido' && !r.darsena), [remitos])
  const listosParaSalir  = useMemo(() => remitos.filter((r) => r.estado === 'entregado'), [remitos])

  // Demora en dársena: suena UNA vez por camión al pasarse del tiempo. Repetirlo
  // cada refresco sería una alarma cada 10 segundos y terminaría en alguien
  // apagándole el sonido al televisor.
  useEffect(() => {
    if (!sonido) return
    const pasados = remitos.filter((r) =>
      r.estado === 'emitido' && r.darsena && (ahora - r.fecha.toMillis()) / 60_000 >= TOPE_DARSENA_MIN)
    const nuevo = pasados.find((r) => !idsVistos.current.demorados.has(r.id))
    if (nuevo) {
      idsVistos.current.demorados.add(nuevo.id)
      avisar('demora')
    }
  }, [remitos, ahora, sonido, avisar])
  const colaTurnos = useMemo(() => ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && ['en_espera', 'preparado'].includes(v.turnoEstado))
    .sort((a, b) => a.turno - b.turno), [ventanillas])
  const ausentes = useMemo(() => ventanillas.filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'ausente'), [ventanillas])

  // Volvieron y falta contarles la descarga. El regreso lo marca seguridad en
  // el portón o el propio chofer (`remitosCarga.regreso`, 2026-09-13); ya
  // contado = hay una descarga de ese chofer hoy.
  const contados = useMemo(() => new Set(descargas.map((d) => d.choferId)), [descargas])
  const retornos = useMemo(() => remitos
    .filter((r) => r.regreso && !contados.has(r.choferId))
    .sort((a, b) => (a.regreso!.hora.toMillis() - b.regreso!.hora.toMillis())),
  [remitos, contados])
  // El que volvió y ya está en una boca se pinta EN esa boca; el que todavía no
  // tiene dársena (la marcó seguridad en el portón, o no había ninguna libre)
  // queda en el bloque de abajo hasta que el chofer la elija.
  const retornoEnDarsena   = (n: number) => retornos.find((r) => r.regreso?.darsena === n)
  const retornosSinDarsena = useMemo(() => retornos.filter((r) => !r.regreso?.darsena), [retornos])


  const llamadoReciente = ventanillas.find((v) =>
    v.turnoEstado === 'llamado' && v.llamadoAt && (ahora - v.llamadoAt.toMillis()) < 45_000)

  // Pallets completos + bolsas sueltas: el clarkista levanta pallets con la uña
  // y estiba a mano el resto, así que 920 bolsas de 2kg son "3 PAL + 200
  // sueltas" y no "920" (el remito ya trae `pallets`, pero es el REDONDEO HACIA
  // ARRIBA de los que ocupa — sirve para el camión, no para la uña).
  const desglose = useCallback((productoId: string, cantidad: number) => {
    const upp = catalogo.find((p) => p.id === productoId)?.unidadesPorPallet ?? 0
    return upp > 0
      ? { pallets: Math.floor(cantidad / upp), sueltas: cantidad % upp }
      : { pallets: 0, sueltas: cantidad }
  }, [catalogo])

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

      {/* Zona 1: las cinco dársenas en UNA fila, en el orden físico del muelle (2026-09-15,
          pedido de los chicos del muelle vía Ariel): visto desde donde cuelga la tele, las bocas
          van de izquierda a derecha 5 4 3 2 1, así la pantalla es un espejo del lugar. Las de
          ventanilla (4 y 5) son las de los clientes que compran para revender. */}
      <div className="grid gap-4" style={{ height: 540, gridTemplateColumns: `repeat(${totalDarsenas}, minmax(0, 1fr))` }}>
        {ordenFisico.map((n) => {
          // Un camión que volvió y está en la boca esperando conteo pisa todo lo demás:
          // es la alerta roja (2026-09-15, el chofer elige la dársena al volver).
          const volvio = retornoEnDarsena(n)
          if (volvio) return <DarsenaRetorno key={n} n={n} r={volvio} ahora={ahora} />
          if (dVentanilla.includes(n)) return <DarsenaVentanilla key={n} n={n} v={turnoEnDarsena(n)} />
          const r = camionEnDarsena(n)
          // Boca libre: sin cronómetro, no hace falta que el tick la repinte.
          return <DarsenaCamion key={n} n={n} r={r} desglose={desglose} ahora={r ? ahora : 0} />
        })}
      </div>

      {/* Zona 2: los que volvieron y esperan una boca (alerta roja, a la izquierda) + anticipación de cámara */}
      <div className="flex gap-4 flex-1 min-h-0">
        <Retornos retornos={retornosSinDarsena} ahora={ahora} />
        <Siguen cola={colaTurnos} ausentes={ausentes} camionesEnEspera={camionesEnEspera} listosParaSalir={listosParaSalir} />
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
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 w-[560px] space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Un sonido por evento</p>
          {EVENTOS.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <div className="w-[190px] shrink-0">
                <p className="text-sm font-semibold text-gray-100 leading-tight">{e.nombre}</p>
                <p className="text-[11px] text-gray-500 leading-tight">{e.cuando}</p>
              </div>
              <select
                value={sonidos[e.id]}
                onChange={(ev) => {
                  const id = ev.target.value as SonidoMuelle
                  const nuevo = { ...sonidos, [e.id]: id }
                  setSonidos(nuevo); guardarSonidos(nuevo)
                  tocarSonido(audioRef.current, id, e.id === 'llamado' ? 'Turno 14, dársena 5' : undefined)
                }}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100"
              >
                {SONIDOS.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              <button type="button" aria-label={`Probar ${e.nombre}`}
                onClick={() => tocarSonido(audioRef.current, sonidos[e.id], e.id === 'llamado' ? 'Turno 14, dársena 5' : undefined)}
                className="shrink-0 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-700">
                ▶
              </button>
            </div>
          ))}
          <p className="text-[11px] text-gray-600 pt-1">
            Elegí y escuchá con el ruido de la planta. Queda guardado en este televisor.
          </p>
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

// Helpers puros a nivel módulo: no dependen de estado, así las zonas memoizadas
// reciben siempre las mismas referencias.
const patente = (label: string) => label.split('·')[0].trim()
const minutosDesde = (ahora: number, t: { toMillis(): number }) => Math.max(0, Math.round((ahora - t.toMillis()) / 60_000))
const horaDe = (t: { toDate(): Date }) => t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

// Nombre corto de producto, para leerse desde el autoelevador.
const ETIQUETAS: Record<string, string> = {
  bolsa_2kg: '2kg', bolsa_3kg: '3kg', bolsa_10kg: '10kg',
  picado_10kg: 'PICADO', escamas_10kg: 'ESCAMA', barra: 'BARRA',
  anticorrosivo: 'ANTIC.', agua_6l: 'AGUA',
}
export const corto = (productoId: string, nombre: string) =>
  ETIQUETAS[productoId] ?? (nombre.match(/\d+\s?kg/i)?.[0].replace(/\s/g, '') ?? nombre.split(' ')[0].toUpperCase().slice(0, 7))

/** "Factura A 01104-00000062", "Factura X 00001-00000123", "Remito 00001-…" o "Sin número todavía". */
export const comprobanteCorto = (v: VentaVentanilla): string => {
  const c = describirComprobante(v)
  return c.numero ? `${c.etiqueta} ${c.numero}` : `${c.etiqueta} · sin número todavía`
}

// Las tres zonas van en `memo`: el tick de 10 s solo repinta lo que tiene
// cronómetro (`ahora` viaja como número y los minutos se calculan adentro).
export const DarsenaCamion = memo(function DarsenaCamion({ n, r, desglose, ahora }: {
  n: number
  r?: RemitoCarga
  desglose: (id: string, cantidad: number) => { pallets: number; sueltas: number }
  ahora: number
}) {
  const minutos = r ? minutosDesde(ahora, r.fecha) : 0
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
      {/* Remito de carga (2026-09-15, pedido de Ariel): el papel contra el que el muelle entrega. */}
      <p className="text-[22px] font-bold text-amber-200/80 tabular-nums mt-1">{r.codigo}</p>
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
})

// Misma tarjeta vertical que la de camión (2026-09-15: las cinco bocas van en una fila), con
// la etiqueta fija de quién usa estas dos dársenas: los clientes que compran para revender.
export const DarsenaVentanilla = memo(function DarsenaVentanilla({ n, v }: { n: number; v?: VentaVentanilla }) {
  const tag = (
    <div>
      <div className="flex justify-between items-baseline">
        <span className="text-4xl font-black text-gray-500">{n}</span>
        <span className={`text-base font-bold tracking-[3px] ${v ? 'text-green-400' : 'text-gray-700'}`}>
          {v ? 'ATENDIENDO' : 'LIBRE'}
        </span>
      </div>
      <p className="text-[17px] font-bold tracking-[1px] text-sky-400 -mt-1 whitespace-nowrap">CLIENTES / REVENDEDORES</p>
    </div>
  )
  if (!v) {
    return (
      <div className="rounded-[20px] p-4 flex flex-col border-[5px] border-gray-800 bg-[#0b1220]">
        {tag}
        <p className="flex-1 flex items-center justify-center text-[40px] font-black text-gray-700">LIBRE</p>
      </div>
    )
  }
  return (
    <div className="rounded-[20px] p-4 flex flex-col border-[5px] border-green-500 bg-green-500/10 min-w-0"
      style={{ boxShadow: '0 0 32px rgba(34,197,94,0.3)' }}>
      {tag}
      <p className="text-[76px] font-black leading-none text-green-400 mt-1">T-{v.turno}</p>
      {/* Número del ticket (2026-09-15, pedido de Ariel): factura de ARCA o comprobante interno. */}
      <p className="text-[22px] font-bold text-green-200/80 tabular-nums mt-2 truncate" title={comprobanteCorto(v)}>{comprobanteCorto(v)}</p>
      <div className="flex flex-col gap-2 mt-3 flex-1 min-h-0 overflow-hidden">
        {v.items.map((i) => (
          <div key={i.productoId} className="flex justify-between items-baseline pb-1.5" style={{ borderBottom: '2px solid rgba(34,197,94,0.25)' }}>
            <span className="text-[34px] font-bold text-gray-200 leading-none">{corto(i.productoId, i.nombre)}</span>
            <span className="text-[52px] font-black leading-none tabular-nums">{i.cantidad}</span>
          </div>
        ))}
      </div>
      <p className="text-[22px] text-gray-400 truncate mt-auto pt-2" title={nombreClienteVenta(v)}>{nombreClienteVenta(v)}</p>
    </div>
  )
})

/**
 * Boca con un camión que VOLVIÓ y espera que le cuenten (2026-09-15): el chofer
 * marcó en qué dársena estacionó. Rojo y con el cronómetro desde que llegó; sin
 * cantidades, a propósito (el conteo es ciego).
 */
export const DarsenaRetorno = memo(function DarsenaRetorno({ n, r, ahora }: { n: number; r: RemitoCarga; ahora: number }) {
  const espera = minutosDesde(ahora, r.regreso!.hora)
  return (
    <div className="rounded-[20px] p-4 flex flex-col border-[5px] border-red-500 bg-red-500/10 min-w-0"
      style={{ boxShadow: '0 0 32px rgba(239,68,68,0.3)' }}>
      <div className="flex justify-between items-baseline">
        <span className="text-4xl font-black text-gray-500">{n}</span>
        <span className="text-base font-bold tracking-[3px] text-red-400">VOLVIÓ</span>
      </div>
      <p className="text-[56px] font-black leading-none tracking-tight mt-1">{patente(r.camionLabel)}</p>
      <p className="text-[22px] font-bold text-red-200/80 tabular-nums mt-1">{r.codigo}</p>
      <p className="text-[26px] font-black tracking-[2px] text-red-400 mt-4">FALTA CONTAR</p>
      <p className="text-[20px] font-bold tracking-wider text-gray-400 mt-1">LLEGÓ {horaDe(r.regreso!.hora)}</p>
      <div className="flex justify-between items-baseline mt-auto pt-2">
        <span className="text-[22px] text-gray-400 truncate min-w-0" title={r.choferNombre}>{r.choferNombre}</span>
        <span className={`text-[30px] font-black tabular-nums shrink-0 ml-2 ${espera >= 30 ? 'text-red-400' : 'text-gray-400'}`}>
          {espera}′
        </span>
      </div>
    </div>
  )
})

/**
 * SIGUEN (2026-09-15, pedido de Ariel): los próximos TRES turnos de ventanilla,
 * cada uno con su cliente y lo que se lleva, en vez de una suma de todo lo que
 * viene ("Para juntar"). La cámara prepara pedido por pedido, no un montón.
 * Verde = el pedido ya está preparado. Al pie, lo que antes iba en la misma
 * línea: ausentes, camiones que esperan boca y los que salen.
 */
export const Siguen = memo(function Siguen({ cola, ausentes, camionesEnEspera, listosParaSalir }: {
  cola: VentaVentanilla[]
  ausentes: VentaVentanilla[]
  camionesEnEspera: RemitoCarga[]
  listosParaSalir: RemitoCarga[]
}) {
  const proximos = cola.slice(0, 3)
  return (
    <div className="flex-[5] bg-gray-900 border-[5px] border-sky-900 rounded-[20px] px-7 py-4 flex flex-col min-w-0">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[30px] font-black text-sky-400 tracking-[3px]">SIGUEN</p>
        {cola.length > 3 && <p className="text-[24px] font-bold text-gray-500">+{cola.length - 3} más en espera</p>}
      </div>
      <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
        {proximos.length === 0 && <p className="text-[40px] font-black text-gray-700">—</p>}
        {proximos.map((v) => (
          <div key={v.id} className="rounded-2xl bg-black/30 px-5 py-3 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center gap-4 min-w-0">
              <span className={`rounded-xl px-4 py-1 text-[54px] font-black leading-none shrink-0 tabular-nums ${
                v.turnoEstado === 'preparado' ? 'bg-green-700' : 'bg-gray-800'
              }`}>{v.turno}</span>
              <span className="text-[24px] font-bold text-gray-300 leading-tight line-clamp-2 min-w-0" title={nombreClienteVenta(v)}>
                {nombreClienteVenta(v)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 mt-3 flex-1 min-h-0 overflow-hidden">
              {v.items.map((i) => (
                <div key={i.productoId} className="flex justify-between items-baseline pb-1" style={{ borderBottom: '2px solid rgba(56,189,248,0.2)' }}>
                  <span className="text-[30px] font-bold text-gray-200 leading-none">{corto(i.productoId, i.nombre)}</span>
                  <span className="text-[44px] font-black leading-none tabular-nums text-amber-300">{i.cantidad}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[22px] font-bold truncate mt-2">
        {ausentes.length > 0 && <span className="text-red-400">AUSENTE: {ausentes.map((v) => `T-${v.turno}`).join(', ')}</span>}
        {ausentes.length > 0 && (camionesEnEspera.length > 0 || listosParaSalir.length > 0) && <span className="text-gray-600"> · </span>}
        {camionesEnEspera.length > 0 && <span className="text-gray-400">ESPERA: {camionesEnEspera.map((r) => patente(r.camionLabel)).join(', ')}</span>}
        {camionesEnEspera.length > 0 && listosParaSalir.length > 0 && <span className="text-gray-600"> · </span>}
        {listosParaSalir.length > 0 && <span className="text-green-400">SALE: {listosParaSalir.map((r) => patente(r.camionLabel)).join(', ')}</span>}
      </p>
    </div>
  )
})

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
export const Retornos = memo(function Retornos({ retornos, ahora }: { retornos: RemitoCarga[]; ahora: number }) {
  const hay = retornos.length > 0
  return (
    <div className={`flex-[2] min-w-0 rounded-[20px] border-[5px] px-5 py-4 flex flex-col ${
      hay ? 'border-red-500 bg-red-500/10' : 'border-gray-800 bg-[#0b1220]'
    }`} style={hay ? { boxShadow: '0 0 32px rgba(239,68,68,0.25)' } : undefined}>
      <div className="flex items-baseline justify-between mb-3">
        <p className={`text-[28px] font-black tracking-[2px] ${hay ? 'text-red-400' : 'text-gray-700'}`}>VOLVIERON</p>
        {hay && <span className="text-[44px] font-black leading-none text-red-400 tabular-nums">{retornos.length}</span>}
      </div>
      {/* Desde el 2026-09-15 acá quedan solo los que todavía no tienen boca: los que ya
          estacionaron se pintan en su dársena. */}
      <p className={`text-[19px] font-bold tracking-[2px] -mt-2 mb-3 ${hay ? 'text-red-300/70' : 'text-gray-700'}`}>
        ESPERAN DÁRSENA · FALTA CONTAR
      </p>
      {!hay ? (
        <p className="flex-1 flex items-center justify-center text-[34px] font-black text-gray-700 text-center">NADA<br />PENDIENTE</p>
      ) : (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-hidden">
          {retornos.map((r) => {
            const espera = minutosDesde(ahora, r.regreso!.hora)
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
})
