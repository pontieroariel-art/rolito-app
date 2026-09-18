import { claveDia } from '@/utils/diaReparto'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Eye, MonitorPlay, PackageCheck, Truck } from 'lucide-react'
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
import { asignarDarsenaBorrador, manana, subscribeBorradoresDe } from '@/services/borradorCargaService'
import { useRemitosCargaDelDia, useVentanillaDelDia } from '@/hooks/useExpedicionDia'
import { useCotConfig } from '@/hooks/useCotConfig'
import { kgDeItems, requiereCot, talonarioRemitoCarga } from '@/utils/cot'
import {
  confirmarEntregaRemito, crearDescargaCamion, subscribeDescarga, subscribeDescargasDelDia,
} from '@/services/descargaCamionService'
import {
  confirmarEntregaVentanilla, llamarTurno, marcarTurnoAusente, marcarTurnoPreparado,
} from '@/services/ventaVentanillaService'
import {
  BorradorCarga, DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA, DescargaCamion, DescargaCamionItem,
  EnvasesCarga, EnvasesDescarga, PLANTAS, RemitoCarga, RemitoCargaItem, VentaVentanilla,
} from '@/types'
import { reportError } from '@/services/observability'
import EntregarCamionCard from '@/components/expedicion/EntregarCamionCard'
import NumeroGrande from '@/components/expedicion/NumeroGrande'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { generateRemitoCarga } from '@/utils/pdf'
import { generateRemitoCargaOficial } from '@/utils/remitoCargaOficialPdf'
import RacksInput from '@/components/expedicion/RacksInput'
import {
  cuadrarEnvases, describirEnvases, describirRacks, envasesDeDescarga, envasesDeRemito,
} from '@/utils/envases'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { conteoDe, fueRectificada } from '@/utils/rectificacionDescarga'

const ENVASES_VACIOS: EnvasesDescarga = { tarimasMadera: 0, palletsMetal: 0, puntales: 0, aros: 0, sombreros: 0, racks: [] }

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
  const ventanillas = useVentanillaDelDia(plantaId, fecha)

  useEffect(() => subscribeDescargasDelDia(plantaId, fecha, setDescargas), [plantaId, fecha])

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
  // Paso 2: el remito ya está confeccionado y el camión se está cargando contra
  // él. La entrega se marca cuando la mercadería está arriba.
  const conRemitoSinEntregar = useMemo(
    () => [...remitos, ...remitosAyer].filter((r) => r.estado === 'emitido'),
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
  const darsenasDeCamion = useMemo(
    () => Array.from({ length: DARSENAS_POR_PLANTA[plantaId] }, (_, i) => i + 1)
      .filter((n) => !DARSENAS_VENTANILLA[plantaId].includes(n)),
    [plantaId],
  )
  // El remito que acaba de nacer: se le muestra al chofer para que se lleve el
  // número. Se queda en pantalla hasta que el muellero lo cierra.
  const [emitido, setEmitido] = useState<{ remito: RemitoCarga; cotMsg: string } | null>(null)

  // ── Descarga: formulario ──
  const [remitoDescargaId, setRemitoDescargaId] = useState('')
  const [sanas,  setSanas]  = useState<Record<string, number>>({})
  const [rotas,  setRotas]  = useState<Record<string, number>>({})
  const [envases, setEnvases] = useState<EnvasesDescarga>(ENVASES_VACIOS)
  const setEnvase = (k: keyof Omit<EnvasesDescarga, 'racks'>, v: string) =>
    setEnvases((prev) => ({ ...prev, [k]: Math.max(0, Math.min(999, parseInt(v.replace(/\D/g, ''), 10) || 0)) }))
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
  const darsenasVentanilla = DARSENAS_VENTANILLA[plantaId]
  const darsenaLibre = (n: number) =>
    !colaVentanilla.some((v) => v.turnoEstado === 'llamado' && v.darsena === n)
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
  const idsDeAyer = useMemo(() => new Set(remitosAyer.map((r) => r.id)), [remitosAyer])
  // Los que ya tienen descarga registrada hoy: sirven para avisar "a este ya lo
  // contaste" en vez de dejar que se cuente dos veces sin que nadie lo note.
  const yaDescargados = useMemo(() => new Set(descargas.map((d) => d.choferId)), [descargas])
  // La última contada arriba: es la que se acaba de registrar y la que hay que
  // poder revisar de un vistazo.
  const descargasRecientes = useMemo(
    () => [...descargas].sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()),
    [descargas],
  )
  // El combo mezcla remitos del día ('rem:<id>') y depósitos sueltos
  // ('dep:<código>'): un tercerizado que cargó en otra planta, o sin remito
  // digital, igual vuelve y hay que contarle la descarga.
  const remitoDescarga = remitoDescargaId.startsWith('rem:') ? entregados.find((r) => r.id === remitoDescargaId.slice(4)) : undefined
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
      const envasesCuadre = remitoDescarga
        ? cuadrarEnvases([remitoDescarga], [{ envases }])
        : undefined
      const creada = await crearDescargaCamion(
        {
          ...descargaSeleccionada,
          // Día del VIAJE (2026-09-17): el del remito elegido ("salió ayer" cuenta para ayer).
          diaReparto:   claveDia(remitoDescarga?.fecha ?? new Date()),
          items:        toItems(sanas),
          bolsasRotas:  toItems(rotas),
          envases,
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
      setEnvases(ENVASES_VACIOS)
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

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <Navbar />
      <main className="max-w-3xl mx-auto p-4 space-y-6 pb-10">
        <PageHeader
          titulo="Muelle"
          contexto={PLANTAS[plantaId].label}
          chips={porEntregar.length > 0
            ? <Badge tono="pendiente">{porEntregar.length} para entregar</Badge>
            : <Badge tono="entregado">Sin cargas pendientes</Badge>}
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

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}
        {/* ── El remito que acaba de nacer ── */}
        {emitido && (
          <NumeroGrande
            titulo="Remito confeccionado"
            codigo={emitido.remito.codigo}
            instruccion={`Cargá el camión de ${emitido.remito.choferNombre} contra este remito y después marcá la entrega.`}
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
              <Button variant="outline" onClick={() => setEmitido(null)} className="h-11">
                <CheckCircle2 size={16} /> Listo
              </Button>
            </div>
          </NumeroGrande>
        )}

        {/* ── Cargas para entregar ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Truck size={18} className="text-accent" /> Cargas para entregar
          </h2>
          {porEntregar.length === 0 && (
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
          {porEntregar.map((b) => (
            <EntregarCamionCard
              key={b.id}
              borrador={b}
              entregando={procesando === b.id}
              bloqueado={!!procesando && procesando !== b.id}
              darsena={b.darsena}
              onDarsena={(n) => marcarDarsena(b.id, n)}
              darsenas={darsenasDeCamion}
              onEntregar={(items, envases) => entregarCamion(b, items, envases)}
            />
          ))}
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
                  setSanas({}); setRotas({}); setExtras([]); setEnvases(ENVASES_VACIOS)
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
                setSanas({}); setRotas({}); setExtras([]); setEnvases(ENVASES_VACIOS)
              }}
              className={selectClass}
            >
              <option value="">Elegir el camión…</option>
              {entregados.length > 0 && (
                <optgroup label="Camiones que salieron (hoy y ayer)">
                  {entregados.map((r) => (
                    <option key={r.id} value={`rem:${r.id}`}>
                      {r.codigo} · {r.camionLabel} · {r.choferNombre}
                      {idsDeAyer.has(r.id) ? ' · salió ayer' : ''}
                      {r.regreso?.darsena && !yaDescargados.has(r.choferId) ? ` · volvió, en dársena ${r.regreso.darsena}` : ''}
                      {yaDescargados.has(r.choferId) ? ' · ya contado' : ''}
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
              {/* Ya se le contó una descarga hoy: puede ser la segunda vuelta
                  (legítima) o un conteo repetido. Se avisa, no se bloquea. */}
              {yaDescargados.has(descargaSeleccionada.choferId) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-amber-800">
                    A {descargaSeleccionada.choferNombre} ya se le contó una descarga hoy. Si es la segunda vuelta, seguí; si no, avisá a caja antes de registrar otra.
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-secundario mb-2">
                  Mercadería que volvió (contada)
                  {remitoDescarga && <span className="text-secundario font-normal"> · lo que salió en {remitoDescarga.codigo}</span>}
                </p>
                <div className="space-y-1.5">
                  {productosAContar.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 truncate text-base text-gray-900" title={p.nombre}>{p.nombre}</span>
                      <input
                        value={sanas[p.id] ?? 0}
                        onChange={(e) => setSanas((prev) => ({ ...prev, [p.id]: num(e.target.value) }))}
                        inputMode="numeric"
                        className={inputClass}
                      />
                    </div>
                  ))}
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
                <p className="text-sm font-medium text-secundario mb-2">Bolsas rotas recibidas (de los cambios)</p>
                <div className="space-y-1.5">
                  {productosAContar.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 truncate text-base text-gray-900" title={p.nombre}>{p.nombre}</span>
                      <input
                        value={rotas[p.id] ?? 0}
                        onChange={(e) => setRotas((prev) => ({ ...prev, [p.id]: num(e.target.value) }))}
                        inputMode="numeric"
                        className={inputClass}
                      />
                    </div>
                  ))}
                </div>
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
                        {([['tarimasMadera', 'Tarimas de madera'], ['palletsMetal', 'Pallets de metal'], ['puntales', 'Puntales'], ['aros', 'Aros'], ['sombreros', 'Sombreros']] as const).map(([k, label]) => (
                          <div key={k}>
                            <label className="text-sm text-secundario mb-1 block">{label}</label>
                            <input value={envases[k]} onChange={(e) => setEnvase(k, e.target.value)} inputMode="numeric" className={inputEnvaseClass} />
                          </div>
                        ))}
                      </div>
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
              <div className="border border-[#D3D1C7] rounded-lg divide-y divide-[#E7E5DC] text-sm">
                {toItems(sanas).map((i) => (
                  <div key={i.productoId} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="text-gray-900 truncate" title={i.nombre}>{i.nombre}</span>
                    <span className="font-semibold text-gray-900 tabular-nums shrink-0">{i.cantidad}</span>
                  </div>
                ))}
                {toItems(rotas).map((i) => (
                  <div key={`rota-${i.productoId}`} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="text-gray-900 truncate" title={i.nombre}>{i.nombre} <span className="text-[#97241F] text-xs">(rotas)</span></span>
                    <span className="font-semibold text-gray-900 tabular-nums shrink-0">{i.cantidad}</span>
                  </div>
                ))}
                <div className="px-3 py-1.5 bg-[#F8F7F2] text-gray-900">
                  Envases: <span className="font-medium text-gray-900">{describirEnvases(envases) || 'ninguno'}</span>
                </div>
              </div>
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
