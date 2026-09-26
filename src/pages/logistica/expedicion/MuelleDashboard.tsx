import { claveDia } from '@/utils/diaReparto'
import { resumenDescarga } from '@/utils/rotasCambios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Eye, Minus, MonitorPlay, PackageCheck, Plus, Truck, X } from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import PageHeader from '@/components/common/PageHeader'
import Badge from '@/components/common/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useCatalogo } from '@/hooks/useCatalogo'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { useDepositosReparto } from '@/hooks/useDepositosReparto'
import { etiquetaDeposito, identidadDeposito, nombreDeposito } from '@/utils/depositos'
import {
  BorradorNoDisponibleError, TalonarioRemitoCargaNoInicializadoError,
  emitirRemitoDesdeBorrador, esperarCotRemito,
} from '@/services/remitoCargaService'
import { asignarDarsenaBorrador, manana, subscribeBorradoresDe, subscribeCamionesEnViaje } from '@/services/borradorCargaService'
import { useRemitosCargaDelDia, useRemitosCargaDesde, useVentanillaDelDia } from '@/hooks/useExpedicionDia'
import { useCotConfig } from '@/hooks/useCotConfig'
import { kgDeItems, requiereCot, talonarioRemitoCarga } from '@/utils/cot'
import {
  confirmarEntregaRemito, crearDescargaCamion, subscribeDescarga, subscribeDescargasDelDia, subscribeDescargasDeRepartoDesde,
} from '@/services/descargaCamionService'
import {
  confirmarEntregaVentanilla, llamarTurno, marcarTurnoAusente, marcarTurnoPreparado,
} from '@/services/ventaVentanillaService'
import {
  BorradorCarga, DescargaCamion, DescargaCamionItem,
  CamionEnViaje, EnvasesCarga, EnvasesDescarga, PLANTAS, RemitoCarga, RemitoCargaItem, VentaVentanilla,
} from '@/types'
import { darsenaLibrePara, darsenasParaCamion, darsenasParaVentanilla, ocupacionDarsenas } from '@/utils/darsenas'
import { reportError } from '@/services/observability'
import EntregarCamionCard from '@/components/expedicion/EntregarCamionCard'
import NumeroGrande from '@/components/expedicion/NumeroGrande'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { generateRemitoCarga } from '@/utils/pdf'
import { generateRemitoCargaOficial } from '@/utils/remitoCargaOficialPdf'
import RacksInput from '@/components/expedicion/RacksInput'
import {
  cuadrarEnvases, describirEnvases, describirRacks, envasesDeDescarga, envasesDeRemito, implicitosDe,
} from '@/utils/envases'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { conteoDe, fueRectificada } from '@/utils/rectificacionDescarga'

const ENVASES_VACIOS: EnvasesDescarga = { tarimasMadera: 0, palletsMetal: 0, tarimasMaderaSimples: 0, palletsMetalSimples: 0, puntales: 0, aros: 0, sombreros: 0, racks: [] }

type Solapa = 'salidas' | 'ventanilla' | 'vuelta'
const SOLAPAS: { id: Solapa; texto: string }[] = [
  { id: 'salidas',    texto: 'Salidas' },
  { id: 'ventanilla', texto: 'Ventanilla' },
  { id: 'vuelta',     texto: 'Vuelta' },
]
const SOLAPA_KEY = 'muelleSolapa'

// Pantalla del rol muelle (tablet en planta): confirma la entrega de la
// mercadería contra el remito de carga, y cuenta la descarga física cuando el
// camión vuelve (mercadería sana, bolsas rotas de los cambios, y los envases
// retornables sueltos: tarimas de madera, pallets de metal, puntales, aros y
// números de rack de agua — ver src/utils/envases.ts).
export default function MuelleDashboard() {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()
  const { reparto: depositosReparto } = useDepositosReparto()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const remitos = useRemitosCargaDelDia(plantaId, fecha)
  // Ayer también: el camión que vuelve pasada la medianoche trae un remito del
  // día anterior y hasta ahora desaparecía del combo de descarga.
  const ayer = useMemo(() => { const d = new Date(fecha); d.setDate(d.getDate() - 1); return d }, [fecha])
  const remitosAyer = useRemitosCargaDelDia(plantaId, ayer)
  const [descargas,   setDescargas]   = useState<DescargaCamion[]>([])
  // Las de ayer no se listan en pantalla: sirven para saber si un remito de
  // ayer (los que el combo muestra por el camión que vuelve de madrugada) ya
  // está contado, y no contarlo dos veces.
  const [descargasAyer, setDescargasAyer] = useState<DescargaCamion[]>([])
  const ventanillas = useVentanillaDelDia(plantaId, fecha)

  useEffect(() => subscribeDescargasDelDia(plantaId, fecha, setDescargas), [plantaId, fecha])
  useEffect(() => subscribeDescargasDelDia(plantaId, ayer, setDescargasAyer), [plantaId, ayer])
  // La última semana entera (2026-09-21, Ariel): la Vuelta tiene que mostrar los
  // camiones EN REPARTO, sin descargar, salgan de hoy, de ayer o de antes; y un
  // remito contado solo importa para corregirlo. Con los remitos de la semana y
  // sus descargas (por día de viaje) se sabe cuáles siguen en la calle.
  const hace7 = useMemo(() => { const d = new Date(fecha); d.setDate(d.getDate() - 7); return d }, [fecha])
  const remitosSemana = useRemitosCargaDesde(plantaId, hace7)
  const [descargasSemana, setDescargasSemana] = useState<DescargaCamion[]>([])
  useEffect(() => subscribeDescargasDeRepartoDesde(plantaId, hace7, setDescargasSemana), [plantaId, hace7])

  // ── Cargas para entregar: los BORRADORES que armó caja ──
  // Ayer, hoy y mañana: el camión de las 4 de la mañana lleva el borrador que
  // caja armó la tarde anterior, y el que quedó sin salir de ayer sigue vivo un
  // día (ver vencimientoDe en borradorCargaService).
  const { cfg: cotCfg } = useCotConfig()
  const { abrir } = useVisorComprobante()
  const [borradores, setBorradores] = useState<BorradorCarga[]>([])
  const fechasBorrador = useMemo(
    () => [claveDia(ayer), claveDia(fecha), manana(fecha)],
    [ayer, fecha],
  )
  useEffect(
    () => subscribeBorradoresDe(plantaId, fechasBorrador, setBorradores),
    [plantaId, fechasBorrador],
  )
  const porEntregar = useMemo(() => borradores.filter((b) => b.estado === 'pendiente'), [borradores])
  // Para cuándo es cada carga: la tablet muestra ayer, hoy y mañana juntos y
  // a las 22 conviven el segundo viaje de hoy y el camión de la madrugada.
  // La carga de mañana no es trabajo de ahora: caja la deja a la tarde para el
  // camión de la madrugada. Va en su propio bloque, plegado, para que la fila
  // de arriba sea SOLO lo que sale hoy — y no cuenta en el aviso de la solapa.
  const mananaClave = useMemo(() => manana(fecha), [fecha])
  const paraAhora  = useMemo(() => porEntregar.filter((b) => b.paraFecha !== mananaClave), [porEntregar, mananaClave])
  const paraManana = useMemo(() => porEntregar.filter((b) => b.paraFecha === mananaClave), [porEntregar, mananaClave])
  const [verManana, setVerManana] = useState(false)
  const cuandoDe = useCallback((paraFecha: string) => {
    if (paraFecha === claveDia(fecha)) return 'Para hoy'
    if (paraFecha === manana(fecha)) return 'Para mañana'
    if (paraFecha === claveDia(ayer)) return 'Quedó de ayer'
    return `Para el ${paraFecha}`
  }, [fecha, ayer])
  // Camiones con un viaje sin descargar: no reciben carga nueva. Se lee acá para
  // AVISARLO en la tarjeta, antes de que el muellero cuente los envases y se
  // coma un rechazo de las reglas que no explica nada.
  const [enViaje, setEnViaje] = useState<Map<string, CamionEnViaje>>(new Map())
  useEffect(() => subscribeCamionesEnViaje(setEnViaje), [])
  // Paso 2: el remito ya está confeccionado y el camión se está cargando contra
  // él. La entrega se marca cuando la mercadería está arriba.
  // Ordenados por antigüedad: el que hace más rato que está en la boca va
  // primero. Venían por número descendente (el último arriba) y los de ayer
  // pegados al final, justo al revés de lo que el muelle tiene que atender.
  const conRemitoSinEntregar = useMemo(
    () => [...remitos, ...remitosAyer]
      .filter((r) => r.estado === 'emitido')
      .sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis()),
    [remitos, remitosAyer],
  )
  // El papel del viaje. Muelle lo emite, así que también tiene que poder verlo:
  // es contra lo que se carga, lo que mira seguridad en el portón y, cuando lleva
  // remito R, un comprobante fiscal. Desde el visor se imprime o se descarga.
  const [abriendoPdf, setAbriendoPdf] = useState(false)
  const verRemito = async (r: RemitoCarga) => {
    setAbriendoPdf(true)
    try {
      const blob = await (r.remitoR
        ? generateRemitoCargaOficial(r)
        : generateRemitoCarga({
          codigo: r.codigo, plantaId: r.plantaId, camionLabel: r.camionLabel, choferNombre: r.choferNombre,
          items: r.items, palletsCarga: r.palletsCarga, envases: r.envases, creadoPor: r.creadoPor,
          fecha: r.fecha.toDate(),
          ...(r.cot?.estado === 'presentado' && r.cot.numero ? { cot: { numero: r.cot.numero, fechaValidez: r.cot.fechaValidez } } : {}),
          ...(r.kg ? { kg: r.kg } : {}),
        }))
      if (blob) abrir({ blob, nombre: `${r.codigo}.pdf`, titulo: r.remitoR ? `Remito R ${r.codigo}` : `Remito de carga ${r.codigo}`, subtitulo: `${r.camionLabel} · ${r.choferNombre}` })
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'verRemito', remitoId: r.id })
      setError('No se pudo abrir el remito. Probá de nuevo o pedíselo a caja.')
    } finally { setAbriendoPdf(false) }
  }

  const marcarEntregado = async (r: RemitoCarga) => {
    if (!user || procesando) return
    setError('')
    setProcesando(r.id)
    try {
      await confirmarEntregaRemito(r, { uid: user.uid, nombre: user.nombre, plantaId })
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'marcarEntregado', remitoId: r.id })
      setError('No se pudo marcar la entrega. Revisá la conexión y tocá de nuevo.')
    } finally { setProcesando(null) }
  }
  // Dársena de carga: se guarda en el BORRADOR, no en el remito, porque cuando
  // el camión entra a la boca el remito todavía no existe (nace cuando muelle lo
  // entrega). El TV del muelle la lee de ahí mientras la carga está en curso.
  const marcarDarsena = (borradorId: string, n: number) =>
    asignarDarsenaBorrador(borradorId, n).catch((err) =>
      reportError(err, { origen: 'MuelleDashboard', accion: 'asignarDarsenaBorrador', borradorId }))
  // El talonario del remito R (config/cot.respaldo con CAI vigente). Sin esto el
  // papel sale como comprobante INTERNO, sin validez fiscal, y el camión no
  // debería salir con eso. Antes pasaba en silencio: ahora se avisa antes.
  const talonarioR = useMemo(() => talonarioRemitoCarga(cotCfg), [cotCfg])
  // Unidades por pallet del catálogo: con esto la tarjeta habla en pallets y
  // bolsas sueltas, como la tele y como la pantalla de caja.
  const unidadesPorPallet = useMemo(
    () => Object.fromEntries(catalogo.map((p) => [p.id, p.unidadesPorPallet])),
    [catalogo],
  )
  // Dársenas (2026-09-24, pedido de Ariel): la 1 es solo de camiones; de la 2 a
  // la 5 entran camiones o clientes de ventanilla, la que esté libre.
  const darsenasDeCamion = useMemo(() => darsenasParaCamion(plantaId), [plantaId])
  // El remito que acaba de nacer: se le muestra al chofer para que se lleve el
  // número. Se queda en pantalla hasta que el muellero lo cierra.
  const [emitido, setEmitido] = useState<{ remito: RemitoCarga; cotMsg: string } | null>(null)

  // ── Descarga: formulario ──
  const [remitoDescargaId, setRemitoDescargaId] = useState('')
  const [sanas,  setSanas]  = useState<Record<string, number>>({})
  const [rotas,  setRotas]  = useState<Record<string, number>>({})
  const [envases, setEnvases] = useState<EnvasesDescarga>(ENVASES_VACIOS)
  // Como en la carga (21/09, Ariel): el muelle cuenta tarimas, pallets y racks;
  // puntales, aros y sombreros salen solos (4 puntales y 1 sombrero por pallet,
  // 1 aro por tarima de madera). "Corregir sueltos" abre los tres campos para
  // cuando volvió algo sin su pallet.
  const [sueltosManual, setSueltosManual] = useState(false)
  const setEnvase = (k: keyof Omit<EnvasesDescarga, 'racks'>, v: string) =>
    setEnvases((prev) => {
      const next = { ...prev, [k]: Math.max(0, Math.min(999, parseInt(v.replace(/\D/g, ''), 10) || 0)) }
      if (!sueltosManual && (k === 'tarimasMadera' || k === 'palletsMetal')) Object.assign(next, implicitosDe(next.tarimasMadera, next.palletsMetal, { madera: next.tarimasMaderaSimples, metal: next.palletsMetalSimples }))
      return next
    })
  // La vuelta se cuenta como la carga (2026-09-21): armados y simples por tipo.
  // Se guarda el total por tipo más cuántos son simples; los implícitos salen
  // de los armados. Un pallet vuelve como salió: los puntales no se sacan.
  const setBase = (tipo: 'madera' | 'metal', armados: number, simples: number) =>
    setEnvases((prev) => {
      const a = Math.max(0, Math.min(999, armados)), s = Math.max(0, Math.min(999, simples))
      const next: EnvasesDescarga = tipo === 'madera'
        ? { ...prev, tarimasMadera: a + s, tarimasMaderaSimples: s }
        : { ...prev, palletsMetal: a + s, palletsMetalSimples: s }
      if (!sueltosManual) Object.assign(next, implicitosDe(next.tarimasMadera, next.palletsMetal, { madera: next.tarimasMaderaSimples, metal: next.palletsMetalSimples }))
      return next
    })
  const maderaArmadas = envases.tarimasMadera - (envases.tarimasMaderaSimples ?? 0)
  const metalArmados  = envases.palletsMetal - (envases.palletsMetalSimples ?? 0)
  // Corrección de un conteo ya cargado (2026-09-13): se precarga lo que contó
  // muelle (su propio número, no el teórico: el conteo sigue ciego) y al
  // confirmar nace una descarga nueva que reemplaza a la vieja.
  const [corrigiendo, setCorrigiendo] = useState<DescargaCamion | null>(null)
  const [motivoCorreccion, setMotivoCorreccion] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  // Id del remito/turno que se está entregando: evita el doble toque (el
  // segundo update lo rechazan las reglas y se veía como error).
  const [procesando,  setProcesando]  = useState<string | null>(null)
  const [error,       setError]       = useState('')
  /**
   * Descarga recién registrada: la pantalla de cierre con el código gigante
   * (2026-09-18). Reemplaza al cartelito de "descarga registrada": el chofer que
   * vuelve de noche escribe este código en el sobre de la plata, y es lo único
   * que después le permite a caja saber de qué viaje es cada sobre del buzón.
   */
  const [cerrada, setCerrada] = useState<
    { id: string; choferNombre: string; codigo: string; corregida: boolean } | null
  >(null)

  // Cola de turnos de ventanilla, en orden. Los ausentes van aparte (no
  // bloquean la cola; se re-llaman cuando aparecen).
  const colaVentanilla = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado !== 'ausente')
    .sort((a, b) => a.turno - b.turno)
  const ausentes = ventanillas
    .filter((v) => v.estado === 'pendiente_entrega' && v.turnoEstado === 'ausente')
    .sort((a, b) => a.turno - b.turno)
  // ── Las tres cosas que hace el muelle, cada una en su solapa (2026-09-19) ──
  // Salida del camión, ventanilla y vuelta ocurren en momentos distintos y
  // antes convivían en una pantalla de cinco bloques con scroll. Cada solapa
  // lleva el número de pendientes, para que separar no esconda trabajo: el
  // muellero ve que hay un turno esperando aunque esté contando una descarga.
  const [solapa, setSolapa] = useState<Solapa>(() => {
    try {
      const v = localStorage.getItem(SOLAPA_KEY)
      return v === 'ventanilla' || v === 'vuelta' ? v : 'salidas'
    } catch { return 'salidas' }
  })
  useEffect(() => { try { localStorage.setItem(SOLAPA_KEY, solapa) } catch { /* sin storage */ } }, [solapa])
  const darsenasVentanilla = useMemo(() => darsenasParaVentanilla(plantaId), [plantaId])
  // Camiones que volvieron y todavía nadie contó: es el trabajo de "Vuelta".
  // Camiones EN REPARTO: remitos entregados de la última semana sin descarga
  // contada. Primero los que ya avisaron "llegué a planta" (con su dársena),
  // después el resto, del más reciente al más viejo.
  const enReparto = useMemo(() => {
    const todas = [...descargasSemana, ...descargas, ...descargasAyer]
    const viajes = new Set(todas.map((d) => d.remitoId).filter(Boolean))
    // Las descargas anteriores al 18/09 no traen remito: esas valen por chofer y día de viaje.
    const choferDia = new Set(todas.filter((d) => !d.remitoId).map((d) => `${d.diaReparto ?? claveDia(d.fecha.toDate())}_${d.choferId}`))
    const vistos = new Set<string>()
    return [...remitosSemana, ...remitos, ...remitosAyer]
      .filter((r) => {
        if (vistos.has(r.id)) return false
        vistos.add(r.id)
        return r.estado !== 'emitido'
          // El server marca en el remito la descarga contada, también si fue
          // en la otra planta (2026-09-22): esa no está en las de esta planta.
          && !r.descarga
          && !viajes.has(r.id) && !choferDia.has(`${claveDia(r.fecha.toDate())}_${r.choferId}`)
      })
      .sort((a, b) => {
        if (!!a.regreso !== !!b.regreso) return a.regreso ? -1 : 1
        if (a.regreso && b.regreso) return a.regreso.hora.toMillis() - b.regreso.hora.toMillis()
        return b.fecha.toMillis() - a.fecha.toMillis()
      })
  }, [remitosSemana, remitos, remitosAyer, descargasSemana, descargas, descargasAyer])
  const sinContar = useMemo(() => enReparto.filter((r) => r.regreso), [enReparto])
  // Qué boca está ocupada y por quién, con lo que la tablet ya tiene en pantalla:
  // no se llama un turno a una boca con un camión adentro, ni se manda un camión
  // a una boca con un cliente cargando (2026-09-24, bocas compartidas).
  const ocupacion = useMemo(
    () => ocupacionDarsenas({ cargas: porEntregar, regresos: sinContar, ventanillas: colaVentanilla }),
    [porEntregar, sinContar, colaVentanilla],
  )
  const darsenaLibre = (n: number, propioId?: string) => darsenaLibrePara(ocupacion, n, propioId)
  /** "salió ayer" / "salió 19/09": nada si es de hoy. */
  const etiquetaSalida = (r: RemitoCarga): string => {
    const dia = claveDia(r.fecha.toDate())
    if (dia === claveDia(fecha)) return ''
    if (dia === claveDia(ayer)) return ' · salió ayer'
    return ` · salió ${r.fecha.toDate().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`
  }
  const pendientes: Record<Solapa, number> = {
    salidas:    paraAhora.length + conRemitoSinEntregar.length,
    ventanilla: colaVentanilla.length,
    vuelta:     sinContar.length,
  }
  // Aviso de trabajo nuevo en una solapa que no se está mirando: la solapa
  // late hasta que alguien entra. Separar las pantallas no puede esconder que
  // llegó un camión o un turno mientras el muellero cuenta una descarga.
  const [avisando, setAvisando] = useState<Record<Solapa, boolean>>({ salidas: false, ventanilla: false, vuelta: false })
  const previos = useRef<Record<Solapa, number> | null>(null)
  // Los datos llegan de a poco al abrir la pantalla, así que TODOS los
  // contadores "suben" desde cero y sin esta gracia la tablet arranca con las
  // tres solapas latiendo, que es justo lo contrario de avisar algo.
  const montado = useRef(Date.now())
  useEffect(() => {
    const antes = previos.current
    previos.current = pendientes
    if (!antes || Date.now() - montado.current < 4_000) return
    const subieron = SOLAPAS.filter(({ id }) => pendientes[id] > antes[id] && id !== solapa).map(({ id }) => id)
    if (subieron.length) setAvisando((a) => ({ ...a, ...Object.fromEntries(subieron.map((id) => [id, true])) }))
    // el objeto pendientes se rearma en cada render; la comparación la hace el ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendientes.salidas, pendientes.ventanilla, pendientes.vuelta, solapa])
  // Entrar a la solapa apaga su aviso: ya lo viste.
  useEffect(() => { setAvisando((a) => (a[solapa] ? { ...a, [solapa]: false } : a)) }, [solapa])
  const minutosEsperando = (v: VentaVentanilla) =>
    Math.max(0, Math.round((Date.now() - v.fecha.toMillis()) / 60_000))
  // Para descargar: cualquier remito ya entregado (el camión salió y volvió).
  // Incluye los de AYER: un camión que vuelve pasada la medianoche tenía su
  // remito fuera de la ventana del día y desaparecía del combo, así que no había
  // forma de contarle la descarga (y la liquidación la comparaba contra cero).
  const entregados = useMemo(
    () => [...remitos, ...remitosAyer].filter((r) => r.estado !== 'emitido'),
    [remitos, remitosAyer],
  )
  // Los que ya tienen descarga registrada hoy: sirven para avisar "a este ya lo
  // contaste" en vez de dejar que se cuente dos veces sin que nadie lo note.
  const yaDescargados = useMemo(() => new Set(descargas.map((d) => d.choferId)), [descargas])
  // Lo mismo pero por VIAJE, que es lo que se cuenta desde el 2026-09-18: el
  // mismo chofer hace dos viajes en el día y el segundo se rotulaba "ya
  // contado" sin que nadie lo hubiera contado (y encima tapaba el "volvió, en
  // dársena N" justo del viaje que sí volvió).
  const remitosContados = useMemo(
    () => new Set([...descargas, ...descargasAyer].map((d) => d.remitoId).filter((id): id is string => !!id)),
    [descargas, descargasAyer],
  )
  // La última contada arriba: es la que se acaba de registrar y la que hay que
  // poder revisar de un vistazo.
  const descargasRecientes = useMemo(
    () => [...descargas].sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    [descargas],
  )
  // El combo mezcla remitos del día ('rem:<id>') y depósitos sueltos
  // ('dep:<código>'): un tercerizado que cargó en otra planta, o sin remito
  // digital, igual vuelve y hay que contarle la descarga.
  const yaContados = useMemo(() => entregados.filter((r) => remitosContados.has(r.id)), [entregados, remitosContados])
  const remitoDescarga = remitoDescargaId.startsWith('rem:')
    ? [...enReparto, ...entregados].find((r) => r.id === remitoDescargaId.slice(4))
    : undefined
  const depositoDescarga = remitoDescargaId.startsWith('dep:') ? depositosReparto.find((d) => d.codigo === remitoDescargaId.slice(4)) : undefined
  const descargaSeleccionada = remitoDescarga
    ? { camionId: remitoDescarga.camionId, camionLabel: remitoDescarga.camionLabel, choferId: remitoDescarga.choferId, choferNombre: remitoDescarga.choferNombre, depositoTango: remitoDescarga.depositoTango, depositoTangoNombre: remitoDescarga.depositoTangoNombre, remitoId: remitoDescarga.id, remitoCodigo: remitoDescarga.codigo }
    : depositoDescarga
      ? { camionId: '', camionLabel: '', choferId: identidadDeposito(depositoDescarga), choferNombre: nombreDeposito(depositoDescarga), depositoTango: depositoDescarga.codigo, depositoTangoNombre: depositoDescarga.nombre }
      : undefined

  const toItems = (m: Record<string, number>): DescargaCamionItem[] =>
    catalogo
      .filter((p) => (m[p.id] ?? 0) > 0)
      .map((p) => ({ productoId: p.id, nombre: p.nombre, cantidad: m[p.id] }))

  /**
   * Qué productos pide contar. Hasta el 2026-09-13 eran los OCHO del catálogo
   * (más otros ocho de bolsas rotas), llevara el camión lo que llevara: 21
   * casilleros en cero para recorrer de parado, con guantes y con el chofer
   * esperando. Ahora pide solo lo que salió en el remito de ese viaje.
   *
   * Esto NO rompe el conteo ciego: saber QUÉ productos llevó no es saber CUÁNTO
   * tiene que devolver. Las cantidades siguen arrancando en cero y el teórico no
   * se muestra nunca.
   *
   * Sin remito (un fletero, o carga de otra planta) no hay lista de la que
   * partir: ahí se muestra el catálogo entero, como antes.
   */
  const [extras, setExtras] = useState<string[]>([])
  const productosAContar = useMemo(() => {
    const delRemito = remitoDescarga?.items.map((i) => i.productoId) ?? []
    const ids = new Set([...delRemito, ...extras])
    return delRemito.length > 0 ? catalogo.filter((p) => ids.has(p.id)) : catalogo
  }, [catalogo, remitoDescarga, extras])
  // Lo que se puede sumar a mano: vuelve algo que no salió en este remito (un
  // cambio de otro producto, mercadería de otro viaje).
  const productosExtra = useMemo(
    () => catalogo.filter((p) => !productosAContar.some((x) => x.id === p.id)),
    [catalogo, productosAContar],
  )

  const num = (v: string) => Math.max(0, Math.min(99999, parseInt(v.replace(/\D/g, ''), 10) || 0))

  /**
   * Muelle entrega el camión y ahí NACE el remito (2026-09-18).
   *
   * Es un solo toque a propósito: emitir el remito, consumir el remito R del
   * talonario y presentar el COT con la hora de ahora son el mismo acto que
   * dejar salir el camión. Antes el remito lo emitía caja la tarde anterior y el
   * COT viajaba con una hora que no era la del traslado, que es justo lo que
   * ARBA mira.
   */
  const entregarCamion = async (b: BorradorCarga, items: RemitoCargaItem[], envasesCarga: EnvasesCarga) => {
    if (!user || procesando) return
    setError('')
    setProcesando(b.id)
    try {
      // Los kilos se recalculan sobre lo que REALMENTE subió: si muelle corrigió
      // hacia arriba y cruzó el umbral, el COT tiene que salir igual (por eso el
      // borrador trae siempre el destino, aunque el plan no lo requiriera).
      const { kg } = kgDeItems(items, cotCfg.productos)
      const pideCot = requiereCot(kg, b.cotDestino.respaldo.importe ?? 0, cotCfg) && cotCfg.habilitado
      const remitoR = talonarioRemitoCarga(cotCfg)
      const remito = await emitirRemitoDesdeBorrador(
        b,
        {
          correcciones: items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad })),
          // Los envases los cuenta muelle al armar la carga: caja no sabe con
          // qué tipo de pallet sale ni qué racks se usan.
          envases: envasesCarga,
          kg,
          pideCot,
          ...(remitoR ? { remitoR } : {}),
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setEmitido({ remito, cotMsg: '' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      if (remito.cotSolicitud) {
        // Mismo criterio que caja (2026-09-16): no se da por bueno el papel
        // hasta que ARBA contesta, porque el COT se imprime en el remito.
        setEmitido({ remito, cotMsg: 'Presentando el COT a ARBA… esperá el número antes de soltar el camión.' })
        const conCot = (await esperarCotRemito(remito.id)) ?? remito
        setEmitido({
          remito: conCot,
          cotMsg: conCot.cot?.estado === 'presentado'
            ? `COT ${conCot.cot.numero} obtenido.`
            : `ARBA todavía no devolvió el COT${conCot.cot?.error ? ` (${conCot.cot.error})` : ''}. Avisale a caja: el número aparece en el remito cuando llegue.`,
        })
      }
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al entregar el camión' })
      setError(
        err instanceof BorradorNoDisponibleError
          ? `${err.message} Fijate el número del remito con el compañero — no lo entregues de nuevo.`
          : err instanceof TalonarioRemitoCargaNoInicializadoError
            ? err.message
            : 'No se pudo entregar el camión. Revisá la conexión y tocá de nuevo; si sigue igual, avisale a caja antes de dejarlo salir.',
      )
    } finally {
      setProcesando(null)
    }
  }

  const entregarVentanilla = async (v: VentaVentanilla) => {
    if (!user || procesando) return
    setError('')
    setProcesando(v.id)
    try {
      await confirmarEntregaVentanilla(v, { uid: user.uid, nombre: user.nombre })
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al entregar ventanilla' })
      setError('No se pudo confirmar la entrega. Intentá de nuevo.')
    } finally {
      setProcesando(null)
    }
  }

  const registrarDescarga = async () => {
    if (!user || !descargaSeleccionada) return
    setGuardando(true)
    setError('')
    try {
      // Cuadre de envases contra el remito del viaje (2026-09-18): hasta ahora
      // se calculaba acá abajo, se mostraba y se tiraba. Guardado, es el control
      // de salidos vs devueltos por chofer y por viaje. Sin remito no hay contra
      // qué cuadrar y no se manda.
      // Los simples en cero no se escriben: el doc queda como antes del 21/09 y
      // no depende de que las reglas nuevas (que aceptan esas claves) estén publicadas.
      const { tarimasMaderaSimples, palletsMetalSimples, ...base } = envases
      const envasesAGuardar: EnvasesDescarga = {
        ...base,
        ...(tarimasMaderaSimples ? { tarimasMaderaSimples } : {}),
        ...(palletsMetalSimples ? { palletsMetalSimples } : {}),
      }
      const envasesCuadre = remitoDescarga
        ? cuadrarEnvases([remitoDescarga], [{ envases: envasesAGuardar }])
        : undefined
      const creada = await crearDescargaCamion(
        {
          ...descargaSeleccionada,
          // Día del VIAJE (2026-09-17): el del remito elegido ("salió ayer" cuenta para ayer).
          diaReparto:   claveDia(remitoDescarga?.fecha ?? new Date()),
          items:        toItems(sanas),
          bolsasRotas:  toItems(rotas),
          envases:      envasesAGuardar,
          ...(envasesCuadre ? { envasesCuadre } : {}),
          ...(corrigiendo
            ? { rectificaA: corrigiendo.id, motivoRectificacion: motivoCorreccion.trim() }
            : {}),
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      // Pantalla de cierre: el código va a un sobre escrito a mano, así que se
      // muestra grande. El número lo pone el SERVIDOR, así que arranca vacío.
      setCerrada({ id: creada.id, choferNombre: descargaSeleccionada.choferNombre, codigo: creada.codigo ?? '', corregida: !!corrigiendo })
      setConfirmando(false)
      setCorrigiendo(null)
      setMotivoCorreccion('')
      setRemitoDescargaId('')
      setSanas({})
      setRotas({})
      setExtras([])
      setEnvases(ENVASES_VACIOS); setSueltosManual(false)
    } catch (err) {
      reportError(err, { origen: 'MuelleDashboard', accion: 'error al registrar descarga' })
      setError('No se pudo registrar la descarga. Revisá la conexión e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // El número de la descarga lo asigna el servidor cuando el doc le llega, así
  // que la pantalla de cierre se queda escuchando ese doc hasta que aparezca.
  // Si no hay señal nunca llega, y eso se dice con todas las letras: jamás se
  // muestra un número provisorio (con ese número se rotula el sobre).
  const cerradaId = cerrada?.id
  useEffect(() => {
    if (!cerradaId) return
    return subscribeDescarga(cerradaId, (d) => {
      if (d?.codigo) setCerrada((prev) => (prev && prev.id === d.id ? { ...prev, codigo: d.codigo! } : prev))
    })
  }, [cerradaId])

  // 44 px de alto: la tablet del muelle se usa de parado y con guantes, y es el
  // mínimo que se acierta sin mirar. Los números en 16 px y con tabular-nums.
  const inputClass = 'w-20 h-11 text-center text-base tabular-nums bg-white border border-[#D3D1C7] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent'
  const selectClass = 'w-full h-11 bg-white border border-[#D3D1C7] rounded-lg px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent'
  const inputEnvaseClass = `${selectClass} text-right tabular-nums`
  // Botones de pallet de la vuelta: 44 px, mismos que la tarjeta de carga.
  const btnPallet = 'w-11 h-11 shrink-0 rounded-lg border border-[#D3D1C7] bg-white text-gray-900 flex items-center justify-center active:scale-95'

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <PageHeader
          titulo="Muelle"
          contexto={PLANTAS[plantaId].label}
          chips={pendientes.salidas + pendientes.ventanilla + pendientes.vuelta > 0
            ? <Badge tono="pendiente">{pendientes.salidas + pendientes.ventanilla + pendientes.vuelta} pendientes</Badge>
            : <Badge tono="entregado">Todo al día</Badge>}
          acciones={
            <a
              href="/muelle/tv"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-11 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm font-medium text-gray-900 hover:border-accent hover:text-accent transition-colors"
            >
              <MonitorPlay size={16} /> Pantalla TV
            </a>
          }
        />

        {/* Botonera de 56 px: se toca con guantes y se lee de parado. */}
        <div className="grid grid-cols-3 gap-2">
          {SOLAPAS.map(({ id, texto }) => {
            const n = pendientes[id]
            const activa = solapa === id
            const avisa = avisando[id] && !activa
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSolapa(id)}
                aria-current={activa ? 'page' : undefined}
                className={`h-14 rounded-xl border text-base font-semibold flex items-center justify-center gap-2 transition-colors motion-reduce:animate-none ${
                  activa ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'
                } ${avisa ? 'animate-latido border-[#D97706] text-[#8A5203]' : ''}`}
              >
                {texto}
                {n > 0 && (
                  <span className={`min-w-6 h-6 px-1.5 rounded-full text-sm font-bold flex items-center justify-center tabular-nums motion-reduce:animate-none ${
                    activa ? 'bg-white/25 text-white' : avisa ? 'bg-[#D97706] text-white animate-golpecito' : 'bg-accent/15 text-accent'
                  }`}>{n}</span>
                )}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}
        {solapa === 'salidas' && (<>
        {/* ── El remito que acaba de nacer ── */}
        {emitido && (
          <NumeroGrande
            titulo="Remito confeccionado"
            codigo={emitido.remito.codigo}
            instruccion={`Cargá el camión de ${emitido.remito.choferNombre} contra este remito. Cuando esté arriba, marcá «Mercadería entregada» abajo, en «Cargando contra el remito».`}
            detalle={
              <>
                <p>{emitido.remito.camionLabel}</p>
                {emitido.remito.remitoR && (
                  <p className="tabular-nums">
                    Remito R {String(emitido.remito.remitoR.puntoVenta).padStart(4, '0')}-{String(emitido.remito.remitoR.numero).padStart(8, '0')}
                  </p>
                )}
                {emitido.cotMsg && (
                  <p className={emitido.remito.cot?.estado === 'presentado' ? 'text-accent' : 'text-[#8A5203]'}>
                    {emitido.cotMsg}
                  </p>
                )}
              </>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {/* El papel del viaje: es contra lo que se carga, lo que mira
                  seguridad y, con remito R, un comprobante fiscal. */}
              <Button onClick={() => verRemito(emitido.remito)} loading={abriendoPdf} className="h-11">
                <Eye size={16} /> Ver el remito
              </Button>
              {/* Solo saca el cartel de la pantalla: el remito ya nació y el
                  camión quedó abajo esperando la entrega. Decía "Listo" con un
                  tilde y parecía el botón que cierra el paso, que es el de
                  entregar la mercadería. */}
              <Button variant="outline" onClick={() => setEmitido(null)} className="h-11">
                <X size={16} /> Cerrar aviso
              </Button>
            </div>
          </NumeroGrande>
        )}

        {/* ── Cargas para entregar ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Truck size={18} className="text-accent" /> Cargas para entregar
          </h2>
          {paraAhora.length === 0 && (
            /* Muelle NO arma cargas desde cero: sin borrador de caja no hay
               remito. Es una decisión tomada, no una pantalla a medio hacer, y
               por eso se explica acá en vez de dejar un vacío mudo. */
            <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 space-y-1">
              <p className="text-base font-semibold text-gray-900">No hay ningún camión para entregar.</p>
              <p className="text-base text-secundario">
                Las cargas las arma caja. Desde el muelle no se puede armar una: si el camión está esperando y
                no aparece acá, esperá a que caja abra (6 de la mañana) o llamala.
              </p>
            </div>
          )}
          {paraAhora.map((b) => (
            <EntregarCamionCard
              key={b.id}
              borrador={b}
              entregando={procesando === b.id}
              bloqueado={!!procesando && procesando !== b.id}
              darsena={b.darsena}
              onDarsena={(n) => marcarDarsena(b.id, n)}
              darsenas={darsenasDeCamion}
              darsenaOcupada={(n) => !darsenaLibre(n, b.id)}
              sinTalonario={!talonarioR}
              viajeSinDescargar={enViaje.get(b.camionId) ?? null}
              cuando={cuandoDe(b.paraFecha)}
              unidadesPorPallet={unidadesPorPallet}
              onEntregar={(items, envases) => entregarCamion(b, items, envases)}
            />
          ))}

          {paraManana.length > 0 && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={() => setVerManana((v) => !v)}
                aria-expanded={verManana}
                className="w-full h-14 rounded-xl border border-dashed border-[#D3D1C7] bg-white/60 px-4 flex items-center justify-between text-base font-semibold text-secundario"
              >
                <span>Para mañana · {paraManana.length} {paraManana.length === 1 ? 'carga' : 'cargas'}</span>
                <span className="text-sm font-medium">{verManana ? 'Ocultar' : 'Ver'}</span>
              </button>
              {verManana && paraManana.map((b) => (
                <EntregarCamionCard
                  key={b.id}
                  borrador={b}
                  entregando={procesando === b.id}
                  bloqueado={!!procesando && procesando !== b.id}
                  darsena={b.darsena}
                  onDarsena={(n) => marcarDarsena(b.id, n)}
                  darsenas={darsenasDeCamion}
                  darsenaOcupada={(n) => !darsenaLibre(n, b.id)}
                  sinTalonario={!talonarioR}
                  viajeSinDescargar={enViaje.get(b.camionId) ?? null}
                  cuando={cuandoDe(b.paraFecha)}
                  unidadesPorPallet={unidadesPorPallet}
                  mostrarEspera={false}
                  onEntregar={(items, envases) => entregarCamion(b, items, envases)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Paso 2: el camión se carga contra el remito y se marca la entrega ──
            Confeccionar el remito y entregar el camión son dos actos distintos
            (corrección de Ariel, 18/09): el papel sale primero y es contra el que
            se carga. La entrega se marca cuando la mercadería ya está arriba. */}
        {conRemitoSinEntregar.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Truck size={18} className="text-accent" /> Cargando contra el remito
            </h2>
            {conRemitoSinEntregar.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-900 truncate" title={r.camionLabel}>{r.camionLabel}</p>
                    <p className="text-base text-secundario truncate" title={r.choferNombre}>{r.choferNombre}</p>
                  </div>
                  <span className="shrink-0 text-base font-bold text-gray-900 tabular-nums">{r.codigo}</span>
                </div>
                <div className="space-y-1">
                  {r.items.map((i) => (
                    <div key={i.productoId} className="flex justify-between gap-2 text-base">
                      <span className="truncate text-gray-900" title={i.nombre}>{i.nombre}</span>
                      <span className="font-semibold tabular-nums">{i.cantidad}</span>
                    </div>
                  ))}
                </div>
                <p className="text-base text-secundario">{describirEnvases(envasesDeRemito(r)) || 'Sin envases'}</p>
                {r.cotSolicitud && (
                  <p className={`text-sm ${r.cot?.estado === 'presentado' ? 'text-gray-700' : 'text-[#8A5203]'}`}>
                    {r.cot?.estado === 'presentado' ? `COT ARBA ${r.cot.numero}` : 'COT pendiente: no lo dejes salir sin el número'}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" onClick={() => verRemito(r)} loading={abriendoPdf} className="h-14 text-base">
                    <Eye size={18} /> Remito
                  </Button>
                  <Button
                    onClick={() => marcarEntregado(r)}
                    loading={procesando === r.id}
                    disabled={!!procesando && procesando !== r.id}
                    className="col-span-2 h-14 text-base"
                  >
                    <CheckCircle2 size={18} /> Mercadería entregada
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        </>)}

        {solapa === 'ventanilla' && (<>
        {/* ── Cola de turnos de ventanilla ── */}
        {(colaVentanilla.length > 0 || ausentes.length > 0) && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <PackageCheck size={18} className="text-accent" /> Turnos de ventanilla
            </h2>
            {colaVentanilla.map((v) => (
              <div key={v.id} className={`bg-white rounded-xl border shadow-sm p-3 space-y-2 ${
                v.turnoEstado === 'llamado' ? 'border-green-400' : v.turnoEstado === 'preparado' ? 'border-amber-300' : 'border-[#D3D1C7]'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 w-12 h-12 rounded-xl font-black text-xl flex items-center justify-center ${
                    v.turnoEstado === 'llamado' ? 'bg-green-600 text-white'
                      : v.turnoEstado === 'preparado' ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {v.turno}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{nombreClienteVenta(v)}</p>
                    <p className="text-xs text-secundario">
                      {v.turnoEstado === 'llamado' && v.darsena
                        ? `Llamado a dársena ${v.darsena}`
                        : v.turnoEstado === 'preparado' ? 'Preparado — listo para llamar' : 'En espera'}
                      {' · '}{minutosEsperando(v)} min
                    </p>
                  </div>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  {v.items.map((i) => (
                    <div key={i.productoId} className="flex justify-between">
                      <span>{i.nombre}</span>
                      <span className="font-medium">{i.cantidad}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.turnoEstado === 'en_espera' && (
                    <Button variant="outline" onClick={() => marcarTurnoPreparado(v).catch(() => setError('No se pudo marcar. Intentá de nuevo.'))} className="flex-1">
                      Preparado
                    </Button>
                  )}
                  {v.turnoEstado !== 'llamado' && darsenasVentanilla.map((n) => (
                    <Button
                      key={n}
                      disabled={!darsenaLibre(n)}
                      onClick={() => llamarTurno(v, n).catch(() => setError('No se pudo llamar. Intentá de nuevo.'))}
                      className="flex-1"
                    >
                      Llamar a D{n}
                    </Button>
                  ))}
                  {v.turnoEstado === 'llamado' && (
                    <>
                      <Button onClick={() => entregarVentanilla(v)} loading={procesando === v.id} disabled={!!procesando} className="flex-[2]">Mercadería entregada</Button>
                      <Button variant="outline" onClick={() => marcarTurnoAusente(v).catch(() => setError('No se pudo marcar. Intentá de nuevo.'))} className="flex-1">
                        No se presentó
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {ausentes.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Ausentes (llamar cuando aparezcan)</p>
                {ausentes.map((v) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <span className="shrink-0 w-10 h-10 rounded-lg bg-white border border-red-200 text-red-600 font-black flex items-center justify-center">
                      {v.turno}
                    </span>
                    <p className="flex-1 text-sm text-gray-800 truncate">{nombreClienteVenta(v)}</p>
                    {darsenasVentanilla.map((n) => (
                      <Button
                        key={n}
                        variant="outline"
                        disabled={!darsenaLibre(n)}
                        onClick={() => llamarTurno(v, n).catch(() => setError('No se pudo llamar. Intentá de nuevo.'))}
                      >
                        D{n}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        </>)}

        {solapa === 'vuelta' && (<>
        {/* ── Registrar descarga ── */}
        {/* Pantalla de cierre del conteo: mientras está, el formulario no se ve.
            Una sola cosa a la vez, y el código del sobre es lo único que importa
            en ese momento. */}
        {cerrada ? (
          <NumeroGrande
            titulo={cerrada.corregida ? 'Conteo corregido · número de la descarga' : 'Descarga registrada · número'}
            codigo={cerrada.codigo}
            esperando="Guardado. Esperando el número…"
            instruccion="Escribí este código en el sobre de la plata, arriba de todo."
            detalle={
              <>
                <p>{cerrada.choferNombre}</p>
                {!cerrada.codigo && (
                  <p className="text-[#8A5203]">
                    Sin señal el número se asigna cuando la tablet vuelva a conectarse. No inventes uno:
                    avisale al chofer que después le pasás el número para el sobre.
                  </p>
                )}
                {cerrada.corregida && (
                  <p className="text-[#8A5203]">
                    Le avisamos a la oficina para que ajuste el stock en Tango.
                  </p>
                )}
              </>
            }
          >
            <Button onClick={() => setCerrada(null)} className="w-full h-14 text-base">
              Contar otro camión
            </Button>
          </NumeroGrande>
        ) : (
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <PackageCheck size={18} className="text-accent" /> Registrar descarga
          </h2>

          {corrigiendo && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 space-y-2">
              <p className="text-sm font-semibold text-amber-900">
                Estás corrigiendo el conteo de {corrigiendo.choferNombre}
                {corrigiendo.remitoCodigo ? ` (${corrigiendo.remitoCodigo})` : ''} de las{' '}
                {corrigiendo.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}.
              </p>
              <p className="text-xs text-amber-800">
                Están precargadas las cantidades que se habían contado: cambiá las que estén mal. El conteo anterior
                queda guardado igual (no se borra) pero deja de contar para la liquidación.
              </p>
              {/* Sin esto la oficina no se entera: el movimiento de stock del
                  conteo anterior ya se mandó a Tango y no hay vuelta atrás
                  automática. */}
              <p className="text-xs text-amber-900 font-medium">
                El stock en Tango NO se corrige solo: al guardar le avisamos a la oficina para que lo ajuste a mano.
              </p>
              <input
                value={motivoCorreccion}
                onChange={(e) => setMotivoCorreccion(e.target.value)}
                placeholder="Qué pasó (obligatorio): se tipeó 6 en vez de 60…"
                className={selectClass}
              />
              <button
                type="button"
                onClick={() => {
                  setCorrigiendo(null); setMotivoCorreccion(''); setRemitoDescargaId('')
                  setSanas({}); setRotas({}); setExtras([]); setEnvases(ENVASES_VACIOS); setSueltosManual(false)
                }}
                className="text-xs text-secundario underline"
              >
                Cancelar la corrección
              </button>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-secundario mb-1 block">Camión que volvió</label>
            <select
              value={remitoDescargaId}
              disabled={!!corrigiendo}
              onChange={(e) => {
                setRemitoDescargaId(e.target.value)
                setSanas({}); setRotas({}); setExtras([]); setEnvases(ENVASES_VACIOS); setSueltosManual(false)
              }}
              className={selectClass}
            >
              <option value="">Elegir el camión…</option>
              {enReparto.length > 0 && (
                <optgroup label={`En reparto, sin descargar (${enReparto.length})`}>
                  {enReparto.map((r) => (
                    <option key={r.id} value={`rem:${r.id}`}>
                      {r.codigo} · {r.camionLabel} · {r.choferNombre}
                      {r.regreso ? ` · volvió${r.regreso.darsena ? `, en dársena ${r.regreso.darsena}` : ''}` : ''}
                      {etiquetaSalida(r)}
                    </option>
                  ))}
                </optgroup>
              )}
              {yaContados.length > 0 && (
                <optgroup label="Ya contados (hoy y ayer) — solo para corregir">
                  {yaContados.map((r) => (
                    <option key={r.id} value={`rem:${r.id}`}>
                      {r.codigo} · {r.camionLabel} · {r.choferNombre}{etiquetaSalida(r)} · ya contado
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Otro depósito (sin remito de hoy en esta planta)">
                {depositosReparto.map((d) => (
                  <option key={d.codigo} value={`dep:${d.codigo}`}>{etiquetaDeposito(d)}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {descargaSeleccionada && (
            <>
              {/* Ya se contó: este MISMO viaje (conteo repetido, casi seguro un
                  error) o el chofer en otro viaje del día (la segunda vuelta,
                  legítima). Se avisa distinto, y nunca se bloquea. */}
              {(remitoDescarga && remitosContados.has(remitoDescarga.id)
                ? <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <p className="text-sm text-amber-800">
                      El viaje {remitoDescarga.codigo} ya está contado. Si te equivocaste, corregí ese conteo en vez de registrar otro.
                    </p>
                  </div>
                : yaDescargados.has(descargaSeleccionada.choferId)
                  ? <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="text-sm text-amber-800">
                        A {descargaSeleccionada.choferNombre} ya se le contó una descarga hoy. Si es la segunda vuelta, seguí; si no, avisá a caja antes de registrar otra.
                      </p>
                    </div>
                  : null)}

              <div>
                {/* Una sola pregunta por producto (2026-09-26, muelle: "si la bolsa
                    se rompió en el camión, ¿dónde la pongo?"). Antes eran dos listas
                    y la de rotas decía "(de los cambios)": no había lugar para la
                    que se rompió en el camión, y hubo mercadería sana anotada como
                    rota que se fue a merma. */}
                <p className="text-base font-semibold text-gray-900">
                  ¿Cómo volvió cada producto?
                  {remitoDescarga && <span className="text-sm text-secundario font-normal"> · lo que salió en {remitoDescarga.codigo}</span>}
                </p>
                <p className="text-sm text-secundario mb-3">
                  <b className="text-gray-900">Sana</b>: vuelve a la planta. <b className="text-gray-900">Rota</b>: se tira y va a merma, sea de un cambio o rota en el camión.
                </p>
                <div className="space-y-3">
                  {/* Igual que en la carga (21/09, Ariel: "en la vuelta estamos errando
                      en los pallets"): + y − de SANA mueven un PALLET entero según el
                      catálogo, el campo es el total y abajo se lee "3 pallets +
                      24 sueltas". Lo que se guarda sigue siendo bolsas. */}
                  {productosAContar.map((p) => {
                    const upp   = unidadesPorPallet[p.id] ?? 0
                    const n     = sanas[p.id] ?? 0
                    const rota  = rotas[p.id] ?? 0
                    const paso  = upp > 0 ? upp : 1
                    const pal   = upp > 0 ? Math.floor(n / upp) : 0
                    const suelt = upp > 0 ? n % upp : n
                    const poner = (v: number) => setSanas((prev) => ({ ...prev, [p.id]: Math.max(0, Math.min(99999, v)) }))
                    const ponerRota = (v: number) => setRotas((prev) => ({ ...prev, [p.id]: Math.max(0, Math.min(99999, v)) }))
                    return (
                      <div key={p.id} className="border border-[#E7E5DC] rounded-xl p-3 space-y-2">
                        <p className="text-base font-medium text-gray-900 truncate" title={p.nombre}>{p.nombre}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-3">
                          <div>
                            <p className="text-sm text-secundario mb-1">Sana · a planta</p>
                            <div className="flex items-center gap-2">
                              <button type="button" aria-label={`Menos ${p.nombre} sana`} title={`−1 pallet (${paso})`} className={btnPallet} onClick={() => poner(n - paso)}>
                                <Minus size={18} />
                              </button>
                              <input
                                value={n}
                                onChange={(e) => poner(num(e.target.value))}
                                inputMode="numeric"
                                aria-label={`Sanas de ${p.nombre}`}
                                className={inputClass}
                              />
                              <button type="button" aria-label={`Más ${p.nombre} sana`} title={`+1 pallet (${paso})`} className={btnPallet} onClick={() => poner(n + paso)}>
                                <Plus size={18} />
                              </button>
                            </div>
                            {n > 0 && upp > 0 && (
                              <p className="text-sm text-secundario tabular-nums mt-0.5">
                                {pal > 0 && <>{pal} pallet{pal > 1 ? 's' : ''}</>}
                                {pal > 0 && suelt > 0 && ' + '}
                                {suelt > 0 && <>{suelt} suelta{suelt > 1 ? 's' : ''}</>}
                                {` · ${upp} por pallet`}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-sm text-[#97241F] mb-1">Rota · a merma</p>
                            <div className="flex items-center gap-2">
                              <button type="button" aria-label={`Menos ${p.nombre} rota`} className={btnPallet} onClick={() => ponerRota(rota - 1)}>
                                <Minus size={18} />
                              </button>
                              <input
                                value={rota}
                                onChange={(e) => ponerRota(num(e.target.value))}
                                inputMode="numeric"
                                aria-label={`Rotas de ${p.nombre}`}
                                className={`${inputClass} ${rota > 0 ? 'border-[#E4B4B1] bg-[#FDF3F2]' : ''}`}
                              />
                              <button type="button" aria-label={`Más ${p.nombre} rota`} className={btnPallet} onClick={() => ponerRota(rota + 1)}>
                                <Plus size={18} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Volvió algo que no salió en este remito: un cambio de otro
                    producto, o mercadería de otro viaje. */}
                {productosExtra.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) setExtras((prev) => [...prev, e.target.value]) }}
                    className={`${selectClass} mt-2`}
                    aria-label="Agregar otro producto al conteo"
                  >
                    <option value="">+ Otro producto…</option>
                    {productosExtra.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                )}
              </div>

              <div>
                {(() => {
                  const salieron = remitoDescarga ? envasesDeRemito(remitoDescarga) : null
                  const faltan = salieron ? salieron.racks.filter((n) => !envases.racks.includes(n)) : []
                  const difs = salieron ? ([
                    ['tarimas de madera', salieron.tarimasMadera - envases.tarimasMadera],
                    ['pallets de metal', salieron.palletsMetal - envases.palletsMetal],
                    ['puntales', salieron.puntales - envases.puntales],
                    ['aros', salieron.aros - envases.aros],
                    ['sombreros', salieron.sombreros - (envases.sombreros ?? 0)],
                  ] as Array<[string, number]>).filter(([, d]) => d !== 0) : []
                  return (
                    <>
                      <p className="text-sm font-medium text-secundario mb-2">
                        Envases que volvieron
                        {salieron
                          ? ` (salieron: ${describirEnvases(salieron) || 'ninguno'})`
                          : ' (sin remito de carga de hoy en esta planta: no hay contra qué cuadrar)'}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          ['Madera armados', maderaArmadas, (v: number) => setBase('madera', v, envases.tarimasMaderaSimples ?? 0)],
                          ['Madera simples', envases.tarimasMaderaSimples ?? 0, (v: number) => setBase('madera', maderaArmadas, v)],
                          ['Metal armados', metalArmados, (v: number) => setBase('metal', v, envases.palletsMetalSimples ?? 0)],
                          ['Metal simples', envases.palletsMetalSimples ?? 0, (v: number) => setBase('metal', metalArmados, v)],
                        ] as Array<[string, number, (v: number) => void]>).map(([label, valor, poner]) => (
                          <div key={label}>
                            <label className="text-sm text-secundario mb-1 block">{label}</label>
                            <input value={valor} onChange={(e) => poner(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} inputMode="numeric" className={inputEnvaseClass} aria-label={label} />
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-secundario mt-1">Armado: base + 4 puntales + sombrero (y aro si es de madera). Simple: la base sola.</p>
                      {/* Los implícitos, como en la carga; con "Corregir sueltos" se tocan a mano. */}
                      <div className="mt-2 flex items-center justify-between gap-3 min-h-11">
                        <p className="text-sm text-secundario tabular-nums">
                          {sueltosManual ? 'Sueltos corregidos a mano' : `${envases.puntales} puntales · ${envases.aros} aro${envases.aros === 1 ? '' : 's'} · ${envases.sombreros ?? 0} sombrero${(envases.sombreros ?? 0) === 1 ? '' : 's'} (de los armados)`}
                        </p>
                        <button
                          type="button"
                          className="h-11 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm text-gray-900 shrink-0"
                          onClick={() => setSueltosManual((m) => {
                            if (m) setEnvases((prev) => ({ ...prev, ...implicitosDe(prev.tarimasMadera, prev.palletsMetal, { madera: prev.tarimasMaderaSimples, metal: prev.palletsMetalSimples }) }))
                            return !m
                          })}
                        >
                          {sueltosManual ? 'Volver a calcular' : 'Corregir sueltos'}
                        </button>
                      </div>
                      {sueltosManual && (
                        <div className="grid grid-cols-3 gap-3 mt-2">
                          {([['puntales', 'Puntales'], ['aros', 'Aros'], ['sombreros', 'Sombreros']] as const).map(([k, label]) => (
                            <div key={k}>
                              <label className="text-sm text-secundario mb-1 block">{label}</label>
                              <input value={envases[k] ?? 0} onChange={(e) => setEnvase(k, e.target.value)} inputMode="numeric" className={inputEnvaseClass} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-3">
                        <label className="text-sm text-secundario mb-1 block">Racks de agua que volvieron (números)</label>
                        <RacksInput value={envases.racks} onChange={(racks) => setEnvases((prev) => ({ ...prev, racks }))} sugeridos={salieron?.racks ?? []} />
                      </div>
                      {(difs.length > 0 || faltan.length > 0) && (
                        <p className="text-sm text-[#8A5203] mt-1.5">
                          {difs.map(([nombre, d]) => (d > 0 ? `faltan ${d} ${nombre}` : `sobran ${-d} ${nombre}`)).join(' · ')}
                          {faltan.length > 0 && `${difs.length ? ' · ' : ''}faltan racks ${describirRacks(faltan)}`}
                          {' — queda registrado en la liquidación.'}
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>

              <Button
                onClick={() => {
                  if (corrigiendo && !motivoCorreccion.trim()) { setError('Escribí qué pasó con el conteo anterior.'); return }
                  setError('')
                  setConfirmando(true)
                }}
                className="w-full"
              >
                {corrigiendo ? 'Revisar y guardar la corrección' : 'Revisar y registrar descarga'}
              </Button>
            </>
          )}
        </section>
        )}

        {/* ── Descargas de hoy ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800">Descargas de hoy</h2>
          {descargas.length === 0 && (
            <p className="text-secundario text-sm">Todavía no se registró ninguna descarga hoy.</p>
          )}
          {descargasRecientes.map((d) => {
            const reemplazada = fueRectificada(d, descargas)
            return (
              <div key={d.id} className={`bg-white rounded-xl border shadow-sm p-3 ${reemplazada ? 'border-[#E7E5DC]' : 'border-[#D3D1C7]'}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-sm font-semibold truncate ${reemplazada ? 'text-secundario line-through' : 'text-gray-900'}`} title={d.choferNombre}>
                    {d.choferNombre}
                  </p>
                  <p className="text-xs text-secundario shrink-0 tabular-nums">
                    {d.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </p>
                </div>
                <p className="text-xs text-secundario mt-0.5">
                  {d.remitoCodigo || d.depositoTangoNombre || 'sin remito'}
                  {d.camionLabel && ` · ${d.camionLabel}`}
                  {d.rectificaA && <span className="text-[#8A5203]"> · corrige un conteo anterior</span>}
                  {reemplazada && <span className="text-secundario"> · corregida después</span>}
                </p>
                <p className="text-xs text-secundario mt-0.5 tabular-nums">
                  {d.items.reduce((s, i) => s + i.cantidad, 0)} bolsas
                  {describirEnvases(envasesDeDescarga(d)) && ` · ${describirEnvases(envasesDeDescarga(d))}`}
                  {d.bolsasRotas.length > 0 && ` · ${d.bolsasRotas.reduce((s, i) => s + i.cantidad, 0)} rotas`}
                </p>
                {d.motivoRectificacion && <p className="text-xs text-[#8A5203] mt-0.5">{d.motivoRectificacion}</p>}
                {/* Corregir un conteo mal cargado: se carga de nuevo y esta
                    queda reemplazada. Solo la última vale, así que una ya
                    corregida no se vuelve a corregir. */}
                {!reemplazada && (
                  <button
                    type="button"
                    onClick={() => {
                      const c = conteoDe(d)
                      setCorrigiendo(d)
                      setMotivoCorreccion('')
                      setRemitoDescargaId(d.remitoId ? `rem:${d.remitoId}` : d.depositoTango ? `dep:${d.depositoTango}` : '')
                      setSanas(c.sanas)
                      setRotas(c.rotas)
                      setExtras(Object.keys(c.sanas))
                      setEnvases(envasesDeDescarga(d))
                      setCerrada(null)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="mt-2 h-11 px-3 rounded-lg border border-[#D3D1C7] bg-white text-sm font-medium text-gray-700 hover:border-accent hover:text-accent"
                  >
                    Corregir este conteo
                  </button>
                )}
              </div>
            )
          })}
        </section>

        </>)}

        {/* ── Confirmación de descarga ── */}
        {confirmando && descargaSeleccionada && (
          <Modal open onClose={() => setConfirmando(false)} title={corrigiendo ? 'Confirmar la corrección del conteo' : 'Confirmar descarga'}>
            <div className="space-y-3">
              {corrigiendo && (
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                  Reemplaza el conteo de las {corrigiendo.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  {' '}· {motivoCorreccion.trim()}. La oficina va a recibir el aviso para ajustar el stock en Tango.
                </p>
              )}
              <p className="text-sm text-gray-700">
                {descargaSeleccionada.camionLabel || descargaSeleccionada.depositoTangoNombre} · <span className="font-medium">{descargaSeleccionada.choferNombre}</span>
              </p>
              {/* Lo que va a pasar, dicho con todas las letras (2026-09-26): lo sano
                  vuelve a la planta y lo roto sale a merma en Tango. */}
              {(() => {
                const r = resumenDescarga(toItems(sanas), toItems(rotas))
                const fila = (i: { productoId: string; nombre: string; cantidad: number }) => (
                  <div key={i.productoId} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="text-gray-900 truncate" title={i.nombre}>{i.nombre}</span>
                    <span className="font-semibold text-gray-900 tabular-nums shrink-0">{i.cantidad}</span>
                  </div>
                )
                return (
                  <>
                    {r.dudosos.length > 0 && (
                      <div className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 space-y-1">
                        {r.dudosos.map((i) => (
                          <p key={i.productoId}>¿Seguro que <b>ninguna</b> de {i.nombre} volvió sana? Marcaste <b>{i.cantidad} rotas</b> y se van a merma.</p>
                        ))}
                        <p className="text-amber-800">Si volvieron sanas, tocá Cancelar y pasalas a <b>Sana</b>.</p>
                      </div>
                    )}
                    <div className="border border-[#D3D1C7] rounded-lg divide-y divide-[#E7E5DC] text-sm">
                      <p className="px-3 py-1.5 bg-[#F1F8F5] text-xs font-semibold uppercase text-[#0F6B4E]">Vuelve a la planta (sana)</p>
                      {r.aPlanta.length ? r.aPlanta.map(fila) : <p className="px-3 py-1.5 text-secundario">Nada</p>}
                      <p className="px-3 py-1.5 bg-[#FDF3F2] text-xs font-semibold uppercase text-[#97241F]">Va a merma (rota)</p>
                      {r.aMerma.length ? r.aMerma.map(fila) : <p className="px-3 py-1.5 text-secundario">Nada</p>}
                      <div className="px-3 py-1.5 bg-[#F8F7F2] text-gray-900">
                        Envases: <span className="font-medium text-gray-900">{describirEnvases(envases) || 'ninguno'}</span>
                      </div>
                    </div>
                  </>
                )
              })()}
              <p className="text-xs text-secundario">La descarga es definitiva — es el conteo contra el que se liquida el día.</p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" type="button" onClick={() => setConfirmando(false)} className="flex-1">Cancelar</Button>
                <Button onClick={registrarDescarga} loading={guardando} className="flex-1">{corrigiendo ? 'Guardar la corrección' : 'Registrar'}</Button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  )
}
