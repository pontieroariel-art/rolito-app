import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { FileText, History, Printer, Share2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useRemitosCargaDelDia } from '@/hooks/useExpedicionDia'
import { subscribeVentasChoferEnRango } from '../../services/ventaCamionService'
import { subscribeCambiosChoferEnRango } from '../../services/cambioCamionService'
import { subscribeDescargasChoferEnRango } from '../../services/descargaCamionService'
import { subscribeCobranzasChoferEnRango } from '../../services/cobranzaService'
import { useDepositosReparto } from '../../hooks/useDepositosReparto'
import { etiquetaDeposito, identidadDeposito, nombreDeposito, ordenarDepositosReparto } from '../../utils/depositos'
import { cerrarLiquidacion, LiquidacionYaCerradaError, subscribeLiquidacion } from '../../services/liquidacionService'
import { valoresEnPapel } from '@/utils/valoresEnPapel'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { calcularLiquidacion, referenciasDelReparto } from '../../utils/liquidacion'
import { envasesDeDescarga, envasesDeRemito } from '@/utils/envases'
import { generateLiquidacion, nombreArchivoLiquidacion, type DetalleLiquidacionPdf } from '../../utils/pdf'
import { compartirArchivo, puedeCompartirArchivos } from '../../utils/compartir'
import { useDiaActual } from '../../hooks/useDiaActual'
import DetalleReparto, { useReparto } from '../../components/expedicion/liquidacion/DetalleReparto'
import { BarraEstado, DetallePorProducto, Plegable, ResumenPorCliente, TarjetasPlata } from '../../components/expedicion/liquidacion/ResumenLiquidacion'
import CierreLiquidacionModal, { type DatosCierre } from '../../components/expedicion/liquidacion/CierreLiquidacionModal'
import {
  CambioCamion, Cobranza, DescargaCamion, Liquidacion, PLANTAS, RemitoCarga, VentaCamion, type PlantaId,
} from '../../types'
import { reportError } from '@/services/observability'
import SolicitarAnulacionModal from '@/components/expedicion/SolicitarAnulacionModal'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'
import { anulacionEnCurso } from '@/utils/anulacionVenta'
import { tieneAlgunRol } from '@/utils/roles'

// Liquidación del repartidor (pantalla de caja) — herramienta de control del
// día de un DEPÓSITO de Tango (2026-09-06): todo lo que bajó a cada cliente
// con su comprobante, las cobranzas con su recibo, el cuadre de plata,
// clasificado por tipo de operación (ver DetalleReparto). Se calcula EN VIVO
// desde las fuentes del día; el doc inmutable se crea al cerrar y la pantalla
// sigue mostrando todo en modo lectura. Ver src/utils/liquidacion.ts.
export default function LiquidacionesPage() {
  const { user } = useAuth()
  // Tesorería (2026-09-09) abre la misma pantalla en modo lectura desde su
  // panel (/tesoreria/liquidaciones): sin planta fija, la elige; no cierra.
  const { pathname } = useLocation()
  const base = pathname.startsWith('/tesoreria') ? '/tesoreria' : '/caja'
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
  const [ventas,    setVentas]    = useState<VentaCamion[]>([])
  const [cambios,   setCambios]   = useState<CambioCamion[]>([])
  const [descargas, setDescargas] = useState<DescargaCamion[]>([])
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [cerrada,   setCerrada]   = useState<Liquidacion | null>(null)
  const [efectivoRecibido, setEfectivoRecibido] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  // Anulación de una factura del camión con nota de crédito (2026-09-11): caja
  // la pide desde acá mientras la liquidación esté abierta; con una pendiente
  // no se cierra.
  const [anulando, setAnulando] = useState<VentaCamion | null>(null)
  const anulacionesEnCurso = ventas.filter(anulacionEnCurso).length
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
      subscribeLiquidacion(hoy, choferId, setCerrada),
    ]
    return () => unsubs.forEach((u) => u())
  }, [choferId, hoy, fecha])

  useEffect(() => { setEfectivoRecibido(''); setSoloProblemas(false); setAviso(''); setError('') }, [choferId, hoy])

  const calc = useMemo(
    () => calcularLiquidacion(remitosChofer, ventas, cambios, descargas, cobranzas),
    [remitosChofer, ventas, cambios, descargas, cobranzas],
  )
  const reparto = useReparto({ remitos: remitosChofer, ventas, cambios, descargas, cobranzas })
  // Cheques y certificados que trae el repartidor: caja los tilda al cerrar (2026-09-09).
  const papel = useMemo(() => valoresEnPapel(cobranzas), [cobranzas])

  const recibido = cerrada ? cerrada.efectivoRecibido : (parseInt(efectivoRecibido.replace(/\D/g, ''), 10) || 0)
  const diferencia = cerrada ? cerrada.diferenciaEfectivo : (efectivoRecibido.trim() === '' ? null : recibido - calc.efectivoARendir)

  const detallePdf = (): DetalleLiquidacionPdf => ({
    reparto,
    remitos: remitosChofer.map((r) => ({ codigo: r.codigo, camionLabel: r.camionLabel, fecha: r.fecha.toDate(), salida: r.salida?.hora.toDate() ?? null, entregado: r.entregadoPor?.hora.toDate() ?? null, items: r.items, envases: envasesDeRemito(r) })),
    descargas: descargas.map((d) => ({ fecha: d.fecha.toDate(), registradoPor: d.registradoPor.nombre, items: d.items, rotas: d.bolsasRotas.reduce((s, i) => s + i.cantidad, 0), envases: envasesDeDescarga(d) })),
  })

  const imprimir = (liq: Liquidacion) =>
    generateLiquidacion(liq, detallePdf()).catch((err) => reportError(err, { origen: 'LiquidacionesPage', accion: 'error al generar el PDF' }))

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
          fecha: hoy, choferId, choferNombre, calculo: calc, efectivoRecibido: recibido,
          ...(depositoElegido ? { depositoTango: depositoElegido.codigo, depositoTangoNombre: depositoElegido.nombre } : {}),
          ...(datos.diferencia ? { diferencia: datos.diferencia } : {}),
          firmaRepartidor: datos.firma, firmanteRepartidor: datos.firmante, confirmoSinPendientes: datos.confirmoSinPendientes,
          firmaRecibe: datos.firmaRecibe ?? '', firmanteRecibe: datos.firmanteRecibe ?? user.nombre,
          cheques: datos.cheques ?? [], retenciones: datos.retenciones ?? [], valoresFaltantes: datos.valoresFaltantes ?? { cantidad: 0, total: 0 },
          referencias: referenciasDelReparto(remitosChofer, ventas, descargas, cobranzas),
        },
        { uid: user.uid, nombre: user.nombre, plantaId },
      )
      setConfirmando(false)
      imprimir(liq)
    } catch (err) {
      if (err instanceof LiquidacionYaCerradaError) { setError(err.message); return }
      reportError(err, { origen: 'LiquidacionesPage', accion: 'error al cerrar' })
      setError('No se pudo cerrar la liquidación. ¿Ya estaba cerrada? Revisá e intentá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const hayMovimientos = ventas.length + cobranzas.length + remitosChofer.length + descargas.length > 0
  const compartible = puedeCompartirArchivos()

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidación</h1>
          <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label} · {fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <Link to={`${base}/liquidaciones/historial`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-accent mt-1"><History size={13} /> Historial de cierres</Link>
        </div>
        <div className="grid sm:grid-cols-[170px_minmax(260px,1fr)] gap-3 w-full sm:w-auto">
          {!user?.planta && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Planta</label>
              <select value={plantaSel} onChange={(e) => { setPlantaSel(e.target.value as PlantaId); setChoferId('') }} className={selectClass}>
                {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Fecha</label>
            <input type="date" value={hoy} max={diaActual}
              onChange={(e) => { setDiaElegido(e.target.value && e.target.value !== diaActual ? e.target.value : null); setChoferId('') }}
              className={selectClass} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Repartidor (depósito de Tango)</label>
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
          </div>
        </div>
      </div>

      {!choferId && (
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-6 text-center text-sm text-gray-500">
          <FileText size={28} className="mx-auto mb-2 text-gray-300" />
          Elegí el día y el repartidor para ver su liquidación.
        </section>
      )}

      {choferId && (
        <>
          <BarraEstado remitos={remitosChofer} descargas={descargas} reparto={reparto} cerrada={cerrada}
            soloProblemas={soloProblemas} onProblemas={() => setSoloProblemas((v) => !v)} />

          {cerrada && (
            <section className="bg-accent/5 border border-accent/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                {cerrada.codigo && <b className="mr-1.5">{cerrada.codigo}</b>}
                Cerrada por <b>{cerrada.cerradaPor.nombre}</b>{cerrada.firmanteRepartidor ? <> · firmó <b>{cerrada.firmanteRepartidor}</b></> : null}{cerrada.firmaRecibe ? <> · recibió <b>{cerrada.firmanteRecibe ?? cerrada.cerradaPor.nombre}</b> (firmó)</> : null}
                {cerrada.valoresFaltantes && cerrada.valoresFaltantes.cantidad > 0 && <span className="ml-1.5 inline-block text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-medium">{cerrada.valoresFaltantes.cantidad} valor(es) no entregado(s)</span>}
                {cerrada.diferenciaEfectivo !== 0 && <span className="text-red-600 font-medium"> · diferencia {cerrada.diferenciaEfectivo.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}{cerrada.diferencia ? ` (${cerrada.diferencia.nota || cerrada.diferencia.motivo})` : ''}</span>}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => imprimir(cerrada)}><Printer size={16} className="mr-1.5" /> Reimprimir</Button>
                <Button variant="outline" onClick={() => enviar(cerrada)}><Share2 size={16} className="mr-1.5" /> {compartible ? 'Enviar' : 'Descargar PDF'}</Button>
              </div>
              {/* Ventas anuladas después del cierre (las pide la oficina, 2026-09-11): el cierre no se reabre. */}
              {cerrada.anulacionesPosteriores?.length ? <div className="w-full"><AnuladasDespuesDeCerrar anulaciones={cerrada.anulacionesPosteriores} /></div> : null}
            </section>
          )}

          {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

          {!cerrada && !puedeCerrar && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Todavía no está cerrada por caja: lo de abajo es el cálculo en vivo del día.</p>
          )}
          <TarjetasPlata reparto={reparto} calc={calc} efectivoRecibido={cerrada ? String(cerrada.efectivoRecibido) : efectivoRecibido}
            onEfectivoRecibido={setEfectivoRecibido} soloLectura={!!cerrada || !puedeCerrar} diferencia={diferencia} />

          {(cerrada ? (cerrada.cheques?.length ?? 0) + (cerrada.retenciones?.length ?? 0) : papel.cheques.length + papel.retenciones.length) > 0 && (
            <Plegable titulo={`Valores en papel (${cerrada ? (cerrada.cheques?.length ?? 0) + (cerrada.retenciones?.length ?? 0) : papel.cheques.length + papel.retenciones.length})`} abiertoInicial
              extra={cerrada?.valoresFaltantes?.cantidad ? <span className="text-xs text-red-600 font-semibold">{cerrada.valoresFaltantes.cantidad} no entregado(s)</span> : undefined}>
              {cerrada
                ? <ValoresEnPapel cheques={cerrada.cheques ?? []} retenciones={cerrada.retenciones ?? []} soloLectura />
                : <><p className="text-xs text-gray-500 mb-2">Se tildan uno por uno al cerrar la liquidación.</p><ValoresEnPapel cheques={papel.cheques} retenciones={papel.retenciones} soloLectura /></>}
            </Plegable>
          )}

          <DetalleReparto remitos={remitosChofer} ventas={ventas} cambios={cambios} descargas={descargas} cobranzas={cobranzas} soloProblemas={soloProblemas}
            onAnular={!cerrada && puedeCerrar ? setAnulando : undefined} />
          {anulando && user && (
            <SolicitarAnulacionModal objetivo={{ coleccion: 'ventasCamion', venta: anulando, plantaId }} actor={{ uid: user.uid, nombre: user.nombre }} onCerrar={() => setAnulando(null)} />
          )}

          <Plegable titulo="Resumen por cliente"><ResumenPorCliente reparto={reparto} /></Plegable>
          <Plegable titulo="Detalle por producto, envases y cambios"><DetallePorProducto calc={calc} /></Plegable>

          {!cerrada && puedeCerrar && (
            <div className="flex flex-wrap justify-end gap-2">
              {error && <p className="w-full text-sm text-red-600">{error}</p>}
              {anulacionesEnCurso > 0 && (
                <p className="w-full text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {anulacionesEnCurso === 1 ? 'Hay una anulación de factura esperando autorización' : `Hay ${anulacionesEnCurso} anulaciones de factura esperando autorización`}: no se puede cerrar la liquidación hasta que se resuelva.
                </p>
              )}
              <Button onClick={() => setConfirmando(true)} disabled={!hayMovimientos || efectivoRecibido.trim() === '' || anulacionesEnCurso > 0}>
                <Printer size={16} className="mr-1.5" /> Cerrar liquidación e imprimir
              </Button>
            </div>
          )}
          {!cerrada && puedeCerrar && hayMovimientos && efectivoRecibido.trim() === '' && (
            <p className="text-right text-xs text-gray-500">Cargá el efectivo recibido para poder cerrar.</p>
          )}
        </>
      )}

      {confirmando && choferId && (
        <CierreLiquidacionModal
          repartidor={choferNombre}
          resumen={{ ventas: ventas.length, clientes: reparto.clientes.length, cobranzas: cobranzas.length }}
          efectivoARendir={calc.efectivoARendir}
          efectivoRecibido={recibido}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={cerrar}
          valores={papel}
          receptor={user ? { nombre: user.nombre } : undefined}
        />
      )}
    </main>
  )
}
