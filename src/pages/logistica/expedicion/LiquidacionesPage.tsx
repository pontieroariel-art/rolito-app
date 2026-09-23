import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Eye, FileText, History, Printer, Share2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useRemitosCargaDelDia } from '@/hooks/useExpedicionDia'
import { subscribeVentasChoferEnRango } from '@/services/ventaCamionService'
import { subscribeCambiosChoferEnRango } from '@/services/cambioCamionService'
import { subscribeDescargasChoferEnRango } from '@/services/descargaCamionService'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { useDepositosReparto } from '@/hooks/useDepositosReparto'
import { etiquetaDeposito, identidadDeposito, nombreDeposito, ordenarDepositosReparto } from '@/utils/depositos'
import { cerrarLiquidacion, LiquidacionYaCerradaError, subscribeLiquidacion, subscribeLiquidacionDeViaje } from '@/services/liquidacionService'
import { subscribeCierreMercaderia } from '@/services/cierreMercaderiaService'
import { estadoDelViaje } from '@/utils/estadoLiquidacion'
import { ventasDelViaje } from '@/utils/viajeDeVenta'
import { valoresEnPapel } from '@/utils/valoresEnPapel'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { calcularLiquidacion, plataDelViaje, referenciasDelReparto } from '@/utils/liquidacion'
import { calcularFaltante } from '@/utils/faltantes'
import { useUmbralFaltantes } from '@/hooks/useUmbralFaltantes'
import { pedirAutorizacionDesvio, subscribeDesvio } from '@/services/desvioDescargaService'
import PedirAutorizacionDesvio from '@/components/expedicion/liquidacion/PedirAutorizacionDesvio'
import type { ConteoBilletes, DesvioDescarga } from '@/types'
import { conteoCompleto, conteoVacio, totalConteo } from '@/utils/billetes'
import { envasesDeDescarga, envasesDeRemito } from '@/utils/envases'
import { generateLiquidacion, nombreArchivoLiquidacion, type DetalleLiquidacionPdf } from '@/utils/pdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { useDiaActual } from '@/hooks/useDiaActual'
import DetalleReparto, { useReparto } from '@/components/expedicion/liquidacion/DetalleReparto'
import DosPartes from '@/components/expedicion/liquidacion/DosPartes'
import { BarraEstado, DetallePorProducto, Plegable, ResumenPorCliente, TarjetasPlata } from '@/components/expedicion/liquidacion/ResumenLiquidacion'
import CierreLiquidacionModal, { type DatosCierre } from '@/components/expedicion/liquidacion/CierreLiquidacionModal'
import {
  CambioCamion, CierreMercaderia, Cobranza, DescargaCamion, Liquidacion, PLANTAS, VentaCamion, type PlantaId,
} from '@/types'
import { reportError } from '@/services/observability'
import SolicitarAnulacionModal from '@/components/expedicion/SolicitarAnulacionModal'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'
import { anulacionEnCurso } from '@/utils/anulacionVenta'
import { anulacionCobranzaEnCurso } from '@/utils/anulacionCobranza'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { tieneAlgunRol } from '@/utils/roles'

// Liquidación del repartidor (pantalla de caja) — herramienta de control del
// día de un DEPÓSITO de Tango (2026-09-06): todo lo que bajó a cada cliente
// con su comprobante, las cobranzas con su recibo, el cuadre de plata,
// clasificado por tipo de operación (ver DetalleReparto). Se calcula EN VIVO
// desde las fuentes del día; el doc inmutable se crea al cerrar y la pantalla
// sigue mostrando todo en modo lectura. Ver src/utils/liquidacion.ts.
export default function LiquidacionesPage({ base }: { base: '/caja' | '/tesoreria' | '/supervisor' }) {
  const { user } = useAuth()
  // Tesorería (2026-09-09) abre la misma pantalla en modo lectura desde su
  // panel (/tesoreria/liquidaciones): sin planta fija, la elige; no cierra.
  const puedeCerrar = tieneAlgunRol(user, ['caja', 'super_admin'])
  const [plantaSel, setPlantaSel] = useState<PlantaId>('torcuato')
  const plantaId = user?.planta ?? plantaSel
  // Día liquidado: por defecto hoy (reloj reactivo que cruza la medianoche),
  // pero caja puede elegir un día anterior para liquidar o revisar.
  const diaActual = useDiaActual()
  // El historial abre un cierre puntual con ?fecha=yyyy-MM-dd&repartidor=<id>.
  const [params] = useSearchParams()
  const [diaElegido, setDiaElegido] = useState<string | null>(() => {
    const f = params.get('fecha')
    return f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f !== diaActual ? f : null
  })
  const hoy   = diaElegido ?? diaActual
  const fecha = useMemo(() => new Date(hoy + 'T12:00:00'), [hoy])

  // Se liquida un DEPÓSITO (repartidor propio, tercerizado o supervisor),
  // identificado en los docs por el uid de su usuario o 'dep:<código>'.
  const { depositos } = useDepositosReparto()
  const remitosPlanta = useRemitosCargaDelDia(plantaId, fecha)
  const [choferId, setChoferId] = useState(() => params.get('repartidor') ?? '')
  // Qué VIAJE se liquida (2026-09-18). La plata se rinde por viaje porque un
  // chofer puede hacer dos en un día y el segundo no puede pisar la rendición
  // del primero. Vacío = el repartidor no tiene remito ese día (supervisores y
  // cobradores), y entonces se rinde por día, como siempre.
  const [viajeId, setViajeId] = useState(() => params.get('viaje') ?? '')
  // El buzón manda acá con el código que el chofer escribió a mano en el sobre;
  // queda registrado en la liquidación quién lo abrió y cuándo.
  const [desdeBuzon] = useState(() => params.get('buzon') ?? '')
  const [mercaderia, setMercaderia] = useState<CierreMercaderia | null>(null)
  const [ventas,    setVentas]    = useState<VentaCamion[]>([])
  const [cambios,   setCambios]   = useState<CambioCamion[]>([])
  const [descargas, setDescargas] = useState<DescargaCamion[]>([])
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const { abrir } = useVisorComprobante()
  const [cerrada,   setCerrada]   = useState<Liquidacion | null>(null)
  // Rendición por sobres, etapa 1 (2026-09-16): caja cuenta billete por billete
  // y por empresa; el efectivo recibido sale de ese conteo, no se escribe.
  const [conteo, setConteo] = useState<ConteoBilletes>(conteoVacio)
  const [confirmando, setConfirmando] = useState(false)
  // Anulación de una factura del camión con nota de crédito (2026-09-11): caja
  // la pide desde acá mientras la liquidación esté abierta; con una pendiente
  // no se cierra.
  const [anulando, setAnulando] = useState<VentaCamion | null>(null)
  const anulacionesEnCurso = ventas.filter(anulacionEnCurso).length + cobranzas.filter(anulacionCobranzaEnCurso).length
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [aviso,       setAviso]       = useState('')
  const [soloProblemas, setSoloProblemas] = useState(false)

  // Primero los depósitos que salieron ese día con remito de esta planta;
  // abajo el resto de los repartidores activos (un supervisor puede tener un
  // día solo de cobranzas, sin remito, y también se liquida).
  const conRemito = useMemo(() => new Set(remitosPlanta.map((r) => r.choferId)), [remitosPlanta])
  const depositosReparto = useMemo(() => ordenarDepositosReparto(depositos, conRemito), [depositos, conRemito])
  const conSalida = depositosReparto.filter((d) => conRemito.has(identidadDeposito(d)))
  const sinSalida = depositosReparto.filter((d) => !conRemito.has(identidadDeposito(d)))
  // Remitos de identidades que ya no tienen depósito en el catálogo (días
  // viejos, usuarios desvinculados): se listan igual para poder liquidarlos.
  const huerfanos = useMemo(() => {
    const ids = new Set(depositosReparto.map(identidadDeposito))
    const m = new Map<string, string>()
    remitosPlanta.forEach((r) => { if (!ids.has(r.choferId)) m.set(r.choferId, r.choferNombre) })
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }))
  }, [remitosPlanta, depositosReparto])

  const remitosChofer = useMemo(() => remitosPlanta.filter((r) => r.choferId === choferId), [remitosPlanta, choferId])
  // Con un solo viaje se elige solo: el caso de dos viajes es de temporada y no
  // tiene sentido hacer tocar un selector todos los días por él.
  useEffect(() => {
    if (!remitosChofer.length) { setViajeId(''); return }
    setViajeId((actual) => (remitosChofer.some((r) => r.id === actual) ? actual : remitosChofer[0].id))
  }, [remitosChofer])
  const viaje = useMemo(() => remitosChofer.find((r) => r.id === viajeId) ?? null, [remitosChofer, viajeId])
  const depositoElegido = depositosReparto.find((d) => identidadDeposito(d) === choferId)
  const choferNombre  = depositoElegido ? nombreDeposito(depositoElegido) : (huerfanos.find((h) => h.id === choferId)?.nombre ?? '')

  useEffect(() => {
    if (!choferId) { setVentas([]); setCambios([]); setDescargas([]); setCobranzas([]); setCerrada(null); return }
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    const unsubs = [
      subscribeVentasChoferEnRango(choferId, desde, hasta, setVentas),
      subscribeCambiosChoferEnRango(choferId, desde, hasta, setCambios),
      subscribeDescargasChoferEnRango(choferId, desde, hasta, setDescargas),
      subscribeCobranzasChoferEnRango(choferId, desde, hasta, setCobranzas),
      // La plata de un viaje se guarda por su remito; sin viaje, por día.
      viajeId ? subscribeLiquidacionDeViaje(viajeId, setCerrada) : subscribeLiquidacion(hoy, choferId, setCerrada),
      // La otra mitad: la escribe el servidor cuando muelle cuenta la descarga.
      // Se escucha en vivo para que el bloque se complete solo, sin recargar.
      viajeId ? subscribeCierreMercaderia(viajeId, setMercaderia) : (setMercaderia(null), () => {}),
    ]
    return () => unsubs.forEach((u) => u())
  }, [choferId, hoy, fecha, viajeId])

  useEffect(() => { setConteo(conteoVacio()); setSoloProblemas(false); setAviso(''); setError('') }, [choferId, hoy])

  // Lo que se liquida es la plata de ESTE viaje. Las ventas y las cobranzas
  // traen su remito desde el 18/09; las anteriores se ubican por camión y día
  // (utils/viajeDeVenta.ts). Sin viaje (supervisor, cobrador) entra todo el día.
  const ventasDelDia = useMemo(
    () => (viajeId ? ventasDelViaje(ventas, remitosChofer, viajeId) : ventas),
    [ventas, remitosChofer, viajeId],
  )
  const cobranzasDelDia = useMemo(
    () => (viajeId ? ventasDelViaje(cobranzas, remitosChofer, viajeId) : cobranzas),
    [cobranzas, remitosChofer, viajeId],
  )
  const plata = useMemo(() => plataDelViaje(ventasDelDia, cobranzasDelDia), [ventasDelDia, cobranzasDelDia])
  // La mercadería también es la de ESTE viaje, igual que la plata y que el
  // cierre que escribe el servidor (functions/triggers/tangoOutbox →
  // escribirCierreMercaderia: un remito y las descargas de ese remito). Con la
  // carga de los tres viajes del día contra la descarga de uno solo, la
  // pantalla mostraba un faltante de cientos de bolsas y le ofrecía a caja
  // cerrar con un desvío que no existe.
  const remitosDelViaje = useMemo(() => (viaje ? [viaje] : remitosChofer), [viaje, remitosChofer])
  const descargasDelViaje = useMemo(() => {
    if (!viajeId) return descargas
    // Las descargas anteriores al 18/09 no traen `remitoId`; si el chofer hizo
    // un solo viaje ese día, son de ese viaje.
    const unSoloViaje = remitosChofer.length <= 1
    return descargas.filter((d) => d.remitoId === viajeId || (unSoloViaje && !d.remitoId))
  }, [descargas, viajeId, remitosChofer])
  const calc = useMemo(
    () => calcularLiquidacion(remitosDelViaje, ventasDelDia, cambios, descargasDelViaje, cobranzasDelDia),
    [remitosDelViaje, ventasDelDia, cambios, descargasDelViaje, cobranzasDelDia],
  )
  // El estado del viaje sale del helper compartido, nunca deducido acá: las
  // cinco pantallas y el PDF tienen que decir lo mismo (utils/estadoLiquidacion.ts).
  const estado = useMemo(() => estadoDelViaje(cerrada, mercaderia), [cerrada, mercaderia])
  const reparto = useReparto({ ventas: ventasDelDia, cambios, descargas: descargasDelViaje, cobranzas: cobranzasDelDia })
  // Cheques y certificados que trae el repartidor: caja los tilda al cerrar (2026-09-09).
  const papel = useMemo(() => valoresEnPapel(cobranzasDelDia), [cobranzasDelDia])

  const contadoCompleto = conteoCompleto(conteo)
  const recibido = cerrada ? cerrada.efectivoRecibido : totalConteo(conteo)

  const detallePdf = (): DetalleLiquidacionPdf => ({
    reparto,
    remitos: remitosDelViaje.map((r) => ({ codigo: r.codigo, camionLabel: r.camionLabel, fecha: r.fecha.toDate(), salida: r.salida?.hora.toDate() ?? null, entregado: r.entregadoPor?.hora.toDate() ?? null, items: r.items, envases: envasesDeRemito(r) })),
    descargas: descargasDelViaje.map((d) => ({ fecha: d.fecha.toDate(), registradoPor: d.registradoPor.nombre, items: d.items, rotas: d.bolsasRotas.reduce((s, i) => s + i.cantidad, 0), envases: envasesDeDescarga(d) })),
  })

  // Visor (2026-09-15): el PDF se ve en pantalla; descargar o imprimir es un clic adentro.
  const imprimir = async (liq: Liquidacion) => {
    try {
      const blob = await generateLiquidacion(liq, detallePdf())
      const nombre = nombreArchivoLiquidacion(liq)
      abrir({ blob, nombre, titulo: `Liquidación ${liq.codigo ?? liq.fecha}`, subtitulo: `${liq.choferNombre} · ${liq.fecha}` })
    } catch (err) { reportError(err, { origen: 'LiquidacionesPage', accion: 'error al generar el PDF' }) }
  }

  const enviar = async (liq: Liquidacion) => {
    setAviso('')
    try {
      const blob = (await generateLiquidacion(liq, detallePdf(), { descargar: false })) as Blob
      const r = await compartirArchivo(blob, nombreArchivoLiquidacion(liq), { titulo: `Liquidación ${liq.fecha} · ${liq.choferNombre}`, texto: `Liquidación del ${liq.fecha} de ${liq.choferNombre}` })
      if (r === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
    } catch (err) {
      reportError(err, { origen: 'LiquidacionesPage', accion: 'error al enviar el PDF' })
      setAviso('No se pudo generar el PDF.')
    }
  }

  const cerrar = async (datos: DatosCierre) => {
    if (!user || !choferId) return
    setGuardando(true)
    setError('')
    try {
      const liq = await cerrarLiquidacion(
        {
          fecha: hoy, choferId, choferNombre, calculo: plata, efectivoRecibido: recibido,
          // El viaje que se rinde (2026-09-18): con viaje, la liquidación se
          // guarda por su remito; sin viaje (cobradores) sigue la clave por día.
          ...(viaje ? { remitoId: viaje.id, remitoCodigo: viaje.codigo } : {}),
          // Vino del buzón: queda quién lo abrió y cuándo, que es el único tramo
          // del circuito que si no se registra no deja rastro de nadie.
          ...(desdeBuzon ? { buzon: { descargaCodigo: desdeBuzon } } : {}),
          // Conteo de billetes por empresa y la diferencia de cada una (2026-09-16).
          conteoBilletes: conteo,
          diferenciaPorEmpresa: {
            redonhielo: conteo.redonhielo.total - plata.porEmpresa.redonhielo.efectivo,
            rolito:     conteo.rolito.total - plata.porEmpresa.rolito.efectivo,
          },
          ...(depositoElegido ? { depositoTango: depositoElegido.codigo, depositoTangoNombre: depositoElegido.nombre } : {}),
          ...(datos.diferencia ? { diferencia: datos.diferencia } : {}),
          ...(datos.desvio && desvioACerrar
            ? { desvio: {
                bolsasFaltantes: desvioACerrar.bolsasFaltantes,
                productos:       desvioACerrar.productos,
                umbral:          umbralFaltantes.bolsas,
                motivo:          datos.desvio.motivo,
                nota:            datos.desvio.nota,
                observadoPor:    { uid: user.uid, nombre: user.nombre },
                // Autorizado antes de cerrar: el cierre no es "observado", lo
                // miró alguien con el permiso y queda dicho quién.
                ...(autorizado?.resueltaPor
                  ? {
                      autorizadoPor:     autorizado.resueltaPor,
                      notaAutorizacion:  autorizado.notaResolucion ?? '',
                    }
                  : {}),
              } }
            : {}),
          firmaRepartidor: datos.firma, firmanteRepartidor: datos.firmante, confirmoSinPendientes: datos.confirmoSinPendientes,
          firmaRecibe: datos.firmaRecibe ?? '', firmanteRecibe: datos.firmanteRecibe ?? user.nombre,
          cheques: datos.cheques ?? [], retenciones: datos.retenciones ?? [], valoresFaltantes: datos.valoresFaltantes ?? { cantidad: 0, total: 0 },
          referencias: referenciasDelReparto(remitosDelViaje, ventasDelDia, descargasDelViaje, cobranzasDelDia),
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      void imprimir(liq) // atrapa su propio error: la liquidación ya quedó cerrada
    } catch (err) {
      if (err instanceof LiquidacionYaCerradaError) { setError(err.message); return }
      reportError(err, { origen: 'LiquidacionesPage', accion: 'error al cerrar' })
      setError('No se pudo cerrar la liquidación. ¿Ya estaba cerrada? Revisá e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // Faltante de mercadería, recalculado en vivo (2026-09-13, control de fugas):
  // lo que muelle contó contra lo que tendría que haber vuelto. Es el número que
  // vale para cerrar, porque acá están TODAS las ventas del día; la marca que
  // dejó el servidor al momento del conteo puede haber quedado vieja.
  const umbralFaltantes = useUmbralFaltantes()
  // Sin descarga contada (camión en la calle o muelle sin contar) no hay
  // faltante que mostrar: el control se hace cuando el camión vuelve (2026-09-14).
  const sinDescarga = !estado.mercaderia.hecha && descargasDelViaje.length === 0
  // El faltante que vale es el del cierre de mercadería que escribió el servidor
  // al contar. Si todavía no existe (el camión no volvió), se recalcula en vivo
  // para que caja vea el número mientras tanto.
  const faltante = useMemo(
    () => mercaderia?.faltante ?? calcularFaltante(calc.productos, umbralFaltantes, { hayDescarga: !sinDescarga }),
    [mercaderia, calc.productos, umbralFaltantes, sinDescarga],
  )
  // Una liquidación ya cerrada muestra el desvío que se observó al cerrarla, no
  // uno recalculado hoy (el cierre es una foto y no se reabre).
  const desvioACerrar = !cerrada && faltante.grave ? faltante : null
  // Pedido de autorización del faltante (2026-09-13): el camino limpio. Si nadie
  // contesta, el cierre sale igual con desvío observado.
  const [desvio, setDesvio] = useState<DesvioDescarga | null>(null)
  useEffect(() => {
    if (!choferId) { setDesvio(null); return }
    return subscribeDesvio(hoy, choferId, setDesvio)
  }, [hoy, choferId])
  const autorizado = desvio?.estado === 'aprobada' ? desvio : null

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const hayMovimientos = ventas.length + cobranzas.length + remitosChofer.length + descargas.length > 0
  const compartible = puedeCompartirArchivos()

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidación</h1>
          <p className="text-secundario text-sm">{PLANTAS[plantaId].label} · {fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <Link to={`${base}/liquidaciones/historial`} className="inline-flex items-center gap-1 text-xs text-secundario hover:text-accent mt-1"><History size={13} /> Historial de cierres</Link>
        </div>
        <div className="grid sm:grid-cols-[170px_minmax(260px,1fr)] gap-3 w-full sm:w-auto">
          {!user?.planta && (
            <div>
              <label className="text-xs text-secundario mb-1 block">Planta</label>
              <select value={plantaSel} onChange={(e) => { setPlantaSel(e.target.value as PlantaId); setChoferId('') }} className={selectClass}>
                {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-secundario mb-1 block">Fecha</label>
            <input type="date" value={hoy} max={diaActual}
              onChange={(e) => { setDiaElegido(e.target.value && e.target.value !== diaActual ? e.target.value : null); setChoferId('') }}
              className={selectClass} />
          </div>
          <div>
            <label className="text-xs text-secundario mb-1 block">Repartidor (depósito de Tango)</label>
            <select value={choferId} onChange={(e) => setChoferId(e.target.value)} className={selectClass}>
              <option value="">Elegir repartidor…</option>
              {conSalida.length > 0 && (
                <optgroup label={hoy === diaActual ? 'Con salida hoy' : 'Con salida ese día'}>
                  {conSalida.map((d) => <option key={d.codigo} value={identidadDeposito(d)}>{etiquetaDeposito(d)}</option>)}
                </optgroup>
              )}
              {huerfanos.length > 0 && (
                <optgroup label="Con remito, sin depósito en el catálogo">
                  {huerfanos.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                </optgroup>
              )}
              {sinSalida.length > 0 && (
                <optgroup label="Sin remito (supervisores, cobradores, otros depósitos)">
                  {sinSalida.map((d) => <option key={d.codigo} value={identidadDeposito(d)}>{etiquetaDeposito(d)}</option>)}
                </optgroup>
              )}
            </select>
            {/* Con un solo viaje no se muestra nada: elegir sería un trámite de
                todos los días por un caso de temporada. Con dos, hay que decir
                cuál se está rindiendo, porque cada uno tiene su propia plata. */}
            {remitosChofer.length > 1 && (
              <select value={viajeId} onChange={(e) => setViajeId(e.target.value)} className={`${selectClass} mt-2`}>
                {remitosChofer.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {i + 1}º viaje · {r.codigo} · salió {r.salida?.hora.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) ?? r.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {!choferId && (
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-6 text-center text-sm text-secundario">
          <FileText size={28} className="mx-auto mb-2 text-inerte" />
          Elegí el día y el repartidor para ver su liquidación.
        </section>
      )}

      {choferId && (
        <>
          <BarraEstado remitos={remitosDelViaje} descargas={descargasDelViaje} reparto={reparto} cerrada={cerrada}
            soloProblemas={soloProblemas} onProblemas={() => setSoloProblemas((v) => !v)}
            faltante={cerrada ? null : faltante} />

          {cerrada && (
            <section className="bg-accent/5 border border-accent/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                {cerrada.codigo && <b className="mr-1.5">{cerrada.codigo}</b>}
                Cerrada por <b>{cerrada.cerradaPor.nombre}</b>{cerrada.firmanteRepartidor ? <> · firmó <b>{cerrada.firmanteRepartidor}</b></> : null}{cerrada.firmaRecibe ? <> · recibió <b>{cerrada.firmanteRecibe ?? cerrada.cerradaPor.nombre}</b> (firmó)</> : null}
                {cerrada.valoresFaltantes && cerrada.valoresFaltantes.cantidad > 0 && <span className="ml-1.5 inline-block text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">{cerrada.valoresFaltantes.cantidad} valor(es) no entregado(s)</span>}
                {cerrada.diferenciaEfectivo !== 0 && <span className="text-red-600 font-medium"> · diferencia {cerrada.diferenciaEfectivo.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}{cerrada.diferencia ? ` (${cerrada.diferencia.nota || cerrada.diferencia.motivo})` : ''}</span>}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => imprimir(cerrada)}><Eye size={16} className="mr-1.5" /> Ver</Button>
                <Button variant="outline" onClick={() => enviar(cerrada)}><Share2 size={16} className="mr-1.5" /> {compartible ? 'Enviar' : 'Descargar PDF'}</Button>
              </div>
              {/* Ventas anuladas después del cierre (las pide la oficina, 2026-09-11): el cierre no se reabre. */}
              {cerrada.anulacionesPosteriores?.length ? <div className="w-full"><AnuladasDespuesDeCerrar anulaciones={cerrada.anulacionesPosteriores} /></div> : null}
            </section>
          )}

          {/* Las dos mitades, con la misma jerarquía y sin plegables (2026-09-18). */}
          <DosPartes
            estado={estado}
            detallePlata={cerrada?.codigo ? <>Cierre {cerrada.codigo}{cerrada.buzon ? ` · del buzón (${cerrada.buzon.descargaCodigo})` : ''}</> : undefined}
            detalleMercaderia={mercaderia
              ? <>Conteo {mercaderia.descargaCodigos.join(' · ')}{mercaderia.faltante.bolsasFaltantes > 0 ? ` · faltan ${mercaderia.faltante.bolsasFaltantes} bolsas` : ' · cuadró'}</>
              : undefined}
          />

          {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

          {!cerrada && !puedeCerrar && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Todavía no está cerrada por caja: lo de abajo es el cálculo en vivo del día.</p>
          )}
          <TarjetasPlata reparto={reparto} calc={calc} conteo={cerrada ? cerrada.conteoBilletes : conteo}
            onConteo={!cerrada && puedeCerrar ? setConteo : undefined} soloLectura={!!cerrada || !puedeCerrar} efectivoRecibidoCerrado={cerrada?.efectivoRecibido} />

          {(cerrada ? (cerrada.cheques?.length ?? 0) + (cerrada.retenciones?.length ?? 0) : papel.cheques.length + papel.retenciones.length) > 0 && (
            <Plegable titulo={`Valores en papel (${cerrada ? (cerrada.cheques?.length ?? 0) + (cerrada.retenciones?.length ?? 0) : papel.cheques.length + papel.retenciones.length})`} abiertoInicial
              extra={cerrada?.valoresFaltantes?.cantidad ? <span className="text-xs text-red-600 font-semibold">{cerrada.valoresFaltantes.cantidad} no entregado(s)</span> : undefined}>
              {cerrada
                ? <ValoresEnPapel cheques={cerrada.cheques ?? []} retenciones={cerrada.retenciones ?? []} soloLectura />
                : <><p className="text-xs text-secundario mb-2">Se tildan uno por uno al cerrar la liquidación.</p><ValoresEnPapel cheques={papel.cheques} retenciones={papel.retenciones} soloLectura /></>}
            </Plegable>
          )}

          <DetalleReparto remitos={remitosDelViaje} descargas={descargasDelViaje} cobranzas={cobranzasDelDia} reparto={reparto} soloProblemas={soloProblemas}
            onAnular={!cerrada && puedeCerrar ? setAnulando : undefined} />
          {anulando && user && (
            <SolicitarAnulacionModal objetivo={{ coleccion: 'ventasCamion', venta: anulando, plantaId }} actor={{ uid: user.uid, nombre: user.nombre }} onCerrar={() => setAnulando(null)} />
          )}

          <Plegable titulo="Resumen por cliente"><ResumenPorCliente reparto={reparto} /></Plegable>

          {/* La mercadería NO va en un plegable: es la mitad del cierre, no un
              anexo. Los productos salen del cierre que escribió el servidor al
              contar; mientras no exista, del cálculo en vivo. */}
          <section className="bg-white rounded-2xl border border-[#D3D1C7] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs uppercase tracking-wide text-secundario font-semibold">Mercadería · por producto, envases y cambios</h3>
              {faltante.bolsasFaltantes > 0 && (
                <span className={`text-xs font-semibold ${faltante.grave ? 'text-red-600' : 'text-amber-700'}`}>
                  faltan {faltante.bolsasFaltantes} bolsas
                </span>
              )}
            </div>
            <DetallePorProducto
              calc={mercaderia ? { ...calc, productos: mercaderia.productos, envases: mercaderia.envases } : calc}
              sinDescarga={!estado.mercaderia.hecha && sinDescarga}
            />
          </section>

          {!cerrada && puedeCerrar && (
            <div className="flex flex-wrap justify-end gap-2">
              {error && <p className="w-full text-sm text-red-600">{error}</p>}
              {anulacionesEnCurso > 0 && (
                <p className="w-full text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {anulacionesEnCurso === 1 ? 'Hay una anulación esperando autorización' : `Hay ${anulacionesEnCurso} anulaciones esperando autorización`}: no se puede cerrar la liquidación hasta que se resuelva.
                </p>
              )}
              {desvioACerrar && user && (
                <PedirAutorizacionDesvio
                  faltante={desvioACerrar}
                  umbral={umbralFaltantes.bolsas}
                  desvio={desvio}
                  onPedir={(motivo, nota) => pedirAutorizacionDesvio(
                    { fecha: hoy, choferId, choferNombre, depositoTango: depositoElegido?.codigo, faltante: desvioACerrar, umbral: umbralFaltantes.bolsas, motivo, nota },
                    { uid: user.uid, nombre: user.nombre, plantaId },
                  )}
                />
              )}
              <Button onClick={() => setConfirmando(true)} disabled={!hayMovimientos || !contadoCompleto || anulacionesEnCurso > 0}>
                <Printer size={16} className="mr-1.5" /> {desvioACerrar ? (autorizado ? 'Cerrar con el faltante autorizado' : 'Cerrar con desvío observado') : 'Cerrar liquidación'}
              </Button>
            </div>
          )}
          {!cerrada && puedeCerrar && hayMovimientos && !contadoCompleto && (
            <p className="text-right text-xs text-secundario">Contá los billetes de las dos empresas (o marcá "no recibí efectivo") para poder cerrar.</p>
          )}
        </>
      )}

      {confirmando && choferId && (
        <CierreLiquidacionModal
          repartidor={choferNombre}
          resumen={{ ventas: ventas.length, clientes: reparto.clientes.length, cobranzas: cobranzas.length }}
          efectivoARendir={calc.efectivoARendir}
          efectivoRecibido={recibido}
          porEmpresa={{ aRendir: calc.porEmpresa, conteo }}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={cerrar}
          valores={papel}
          receptor={user ? { nombre: user.nombre } : undefined}
          faltante={desvioACerrar ? { bolsasFaltantes: desvioACerrar.bolsasFaltantes, umbral: umbralFaltantes.bolsas, productos: desvioACerrar.productos } : undefined}
          sinDescarga={sinDescarga}
        />
      )}
    </main>
  )
}
