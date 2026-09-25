import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Eye, Handshake, History, Landmark, Receipt, Share2, Wallet } from 'lucide-react'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import Button from '@/components/ui/Button'
import Badge from '@/components/common/Badge'
import PageHeader from '@/components/common/PageHeader'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import AbrirTurnoPanel from '@/components/expedicion/AbrirTurnoPanel'
import AnticipoModal, { type DatosAnticipoModal } from '@/components/expedicion/AnticipoModal'
import ValeModal, { type DatosValeModal } from '@/components/expedicion/ValeModal'
import CierreTurnoModal, { type DatosCierreTurnoModal } from '@/components/expedicion/CierreTurnoModal'
import { BadgeRecepcion, TablaSobres, dif, textoRecepcion } from '@/components/expedicion/SobresCaja'
import { BloqueRenglones, CeldasRH, EfectivoCheques, Renglon, TextoRH, VerMas } from '@/components/tesoreria/plata'
import EntregarSobreModal, { type ReceptorTesoreria } from '@/components/expedicion/EntregarSobreModal'
import FranjaRendicionesPendientes from '@/components/tesoreria/FranjaRendicionesPendientes'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useMiMostrador } from '@/hooks/useMiMostrador'
import { useSesionAbierta } from '@/hooks/useCajaSesion'
import { subscribeVentasVentanillaDeUsuarioEnRango } from '@/services/ventaVentanillaService'
import { cerrarTurnoYRendir, crearAnticipo, entregarSobre, subscribeSobresDe, SobreYaExisteError, type DatosEntregaSobre } from '@/services/sobreService'
import { getUsuariosTesoreria } from '@/services/userService'
import { crearVale, subscribeValesDeTurno } from '@/services/valeService'
import { generateVale } from '@/utils/valePdf'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { importeCobrado } from '@/utils/importeCobrado'
import { anticiposDelTurno, empresaDeAnticipo, memoriaDiferencias, sistemaVentanilla, textoMemoria } from '@/utils/sobres'
import { calcularMostrador } from '@/utils/rendicionMostrador'
import { delTurno, horaCorta, liquidacionesPorRendir } from '@/utils/turnoCaja'
import { actaSobreBlob, compartirActaSobreCompleta } from '@/services/actaSobreService'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, textoCheque, transferenciaDe } from '@/utils/medios'
import { empresaDeCobranza, empresaDeVenta } from '@/utils/liquidacion'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { numeroComprobanteVenta } from '@/utils/numeroComprobanteVenta'
import { anulacionCobranzaEnCurso } from '@/utils/anulacionCobranza'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type Sobre, type VentaVentanilla, type ValeCaja } from '@/types'

const comprobanteDe = numeroComprobanteVenta
const diaLargo = (fecha: string) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const diaCorto = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
const RENGLONES_A_LA_VISTA = 5

// "Mi turno" del cajero. Rediseño del 2026-09-23 (maqueta aprobada por Ariel:
// "que sea amigable, claro y sintético"): una sola pantalla con tres momentos.
//   · El día: arriba "lo que tenés en el cajón" (efectivo y cheques, partido en
//     Redonhielo y Rolito) y abajo los cuatro bloques que lo componen (ventas,
//     cobranzas, liquidaciones recibidas, anticipos), cada uno con sus renglones.
//   · El cierre: un solo conteo del cajón, la app dice cuánto va en cada fajo
//     y firmar CIERRA Y ENTREGA el sobre (ya no existe la entrega en mano).
//   · Después: "Tu sobre", con su estado en tesorería, sin buscar en historiales.
// Un anticipo (vale a tesorería antes del cierre) sale del cajón a la vista.
// Un turno de otro día sin cerrar bloquea el de hoy: se cierra acá primero.
export default function RendicionesPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const { sesion, loading: cargandoSesion } = useSesionAbierta(user?.uid, hoy)
  // El turno abierto puede ser de otro día (quedó sin cerrar): la pantalla trabaja sobre ESE día.
  const diaTurno = sesion?.fecha ?? hoy
  const turnoViejo = !!sesion && sesion.fecha < hoy
  const [ventas, setVentas] = useState<VentaVentanilla[]>([])
  const [sobres, setSobres] = useState<Sobre[]>([])
  const [cargandoSobres, setCargandoSobres] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [anticipando, setAnticipando] = useState(false)
  // Vales de caja (2026-09-25): plata que sale contra un papel firmado; viajan en el sobre.
  const [valeando, setValeando] = useState(false)
  const [errorVale, setErrorVale] = useState('')
  const [vales, setVales] = useState<ValeCaja[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [errorAnticipo, setErrorAnticipo] = useState('')
  const [aviso, setAviso] = useState('')
  const [receptores, setReceptores] = useState<ReceptorTesoreria[]>([])
  // Entrega en mano a tesorería (vuelve el 2026-09-24, pedido de Ariel: tres
  // firmas — caja al cerrar, tesorería al recibir el sobre, tesorería al contar).
  const [entregando, setEntregando] = useState<Sobre | null>(null)
  const [entregandoGuardando, setEntregandoGuardando] = useState(false)
  const [errorEntrega, setErrorEntrega] = useState('')
  const [verTodas, setVerTodas] = useState<Record<string, boolean>>({})
  const { abrir } = useVisorComprobante()

  useEffect(() => {
    getUsuariosTesoreria().then((us) => setReceptores(us.map((u) => ({ uid: u.uid, nombre: u.nombre })))).catch((err) => reportError(err, { origen: 'RendicionesPage', accion: 'usuarios de tesorería' }))
  }, [])

  useEffect(() => {
    if (!user) return
    const desde = new Date(`${diaTurno}T00:00:00`)
    const hasta = new Date(`${addDaysStr(diaTurno, 1)}T00:00:00`)
    const offV = subscribeVentasVentanillaDeUsuarioEnRango(user.uid, desde, hasta, setVentas)
    const offS = subscribeSobresDe(user.uid, addDaysStr(hoy, -35), addDaysStr(hoy, 1), (s) => { setSobres(s); setCargandoSobres(false) })
    return () => { offV(); offS() }
  }, [user, hoy, diaTurno])

  useEffect(() => {
    if (!sesion) { setVales([]); return }
    return subscribeValesDeTurno(sesion.id, setVales)
  }, [sesion])

  // Cobranzas del día del turno y liquidaciones de choferes de los últimos 7 días
  // (una cerrada a última hora se rinde en el turno siguiente).
  const mio = useMiMostrador(user?.uid, diaTurno, ventas, { diasLiquidaciones: 7 })
  const ventasTurno    = useMemo(() => (sesion ? delTurno(ventas, sesion) : []), [ventas, sesion])
  const cobranzasTurno = useMemo(() => (sesion ? delTurno(mio.cobranzas, sesion) : []), [mio.cobranzas, sesion])
  const liquidaciones  = useMemo(() => (user ? liquidacionesPorRendir(mio.liquidacionesRecibidas, user.uid, sobres) : []), [mio.liquidacionesRecibidas, user, sobres])
  const anticipos      = useMemo(() => (sesion ? anticiposDelTurno(sobres, sesion.id) : []), [sobres, sesion])
  const sistema = useMemo(
    () => (sesion ? sistemaVentanilla({ fondoInicial: sesion.fondoInicial, ventas: ventasTurno, cobranzas: cobranzasTurno, liquidacionesRecibidas: liquidaciones, sobresRecibidos: [], anticipos, vales }) : null),
    [sesion, ventasTurno, cobranzasTurno, liquidaciones, anticipos, vales],
  )
  const calc = useMemo(() => calcularMostrador(ventasTurno, cobranzasTurno, liquidaciones), [ventasTurno, cobranzasTurno, liquidaciones])
  const sobresHoy = useMemo(() => sobres.filter((s) => s.fecha === hoy && s.tipo === 'ventanilla'), [sobres, hoy])
  // Sobres de otros días que caja cerró y todavía no entregó en mano (2026-09-24):
  // se muestran para que se puedan entregar, porque sin esa firma tesorería no los cuenta.
  const sobresSinEntregar = useMemo(() => sobres.filter((s) => s.fecha !== hoy && s.tipo === 'ventanilla' && s.estado === 'pendiente_recepcion'), [sobres, hoy])
  const anteriores = useMemo(() => sobres.filter((s) => s.tipo === 'ventanilla' && s.fecha !== hoy), [sobres, hoy])
  const memoria = useMemo(() => (user ? memoriaDiferencias(sobres, user.uid, `${hoy.slice(0, 7)}-01`) : null), [sobres, user, hoy])

  // Visor (2026-09-15): el acta se ve en pantalla; descargar o imprimir es un clic adentro.
  const verActa = async (s: Sobre) => {
    setAviso('')
    try {
      const { blob, nombre } = await actaSobreBlob(s)
      abrir({ blob, nombre, titulo: `Liquidación de caja ${s.codigo}`, subtitulo: `${s.fecha} · ${s.rindio.nombre}` })
    } catch (err) { reportError(err, { origen: 'RendicionesPage', accion: 'error al generar el acta' }); setAviso('No se pudo generar el acta.') }
  }
  const enviar = async (s: Sobre) => {
    setAviso('')
    try {
      const res = await compartirActaSobreCompleta(s)
      if (res === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'error al enviar el acta' })
      setAviso('No se pudo generar el acta.')
    }
  }

  const cerrar = async (datos: DatosCierreTurnoModal) => {
    if (!user || !sesion || !sistema) return
    setGuardando(true); setError('')
    try {
      // El rol del actor es el PUESTO que rinde ('caja'), no el rol principal
      // del usuario: Lucas es de logística y hace caja como rol adicional.
      const sobre = await cerrarTurnoYRendir(
        { sesion, sistema, declarado: datos.declarado, motivoDiferencia: datos.motivoDiferencia, firmaRinde: datos.firmaRinde, firmanteRinde: datos.firmanteRinde },
        { uid: user.uid, nombre: user.nombre, rol: 'caja' },
      )
      setConfirmando(false)
      void verActa(sobre) // atrapa su propio error: el turno ya quedó cerrado
    } catch (err) {
      if (err instanceof SobreYaExisteError) setError(err.message)
      else if (err instanceof Error && /diferencia|firma|tildar/.test(err.message)) setError(err.message)
      else { reportError(err, { origen: 'RendicionesPage', accion: 'error al cerrar el turno' }); setError('No se pudo cerrar el turno. Revisá la conexión e intentá de nuevo.') }
    } finally {
      setGuardando(false)
    }
  }

  const anticipar = async (datos: DatosAnticipoModal) => {
    if (!user || !sesion || !sistema) return
    setGuardando(true); setErrorAnticipo('')
    try {
      await crearAnticipo(
        { sesion, monto: datos.monto, empresa: datos.empresa, porEmpresa: sistema.porEmpresa, recibio: { uid: datos.recibio.uid, nombre: datos.recibio.nombre, rol: 'tesoreria' }, firmaRecibe: datos.firmaRecibe, firmanteRecibe: datos.recibio.nombre },
        { uid: user.uid, nombre: user.nombre, rol: 'caja' },
      )
      setAnticipando(false)
      setAviso('')
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'anticipo a tesorería' })
      setErrorAnticipo(err instanceof Error ? err.message : 'No se pudo registrar el anticipo.')
    } finally { setGuardando(false) }
  }

  const verVale = async (v: ValeCaja) => {
    try {
      const { blob, nombre } = await generateVale(v)
      abrir({ blob, nombre, titulo: `Vale de caja ${v.codigo}`, subtitulo: `${v.receptor.nombre} · ${formatoARS(v.importe)}` })
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'error al generar el vale' })
      setAviso('No se pudo generar el vale en PDF.')
    }
  }

  const darVale = async (datos: DatosValeModal) => {
    if (!user || !sesion || !sistema) return
    setGuardando(true); setErrorVale('')
    try {
      const v = await crearVale(
        { sesion, importe: datos.importe, empresa: datos.empresa, porEmpresa: sistema.porEmpresa, receptor: datos.receptor, motivo: datos.motivo, firmaRecibe: datos.firmaRecibe, firmanteRecibe: datos.receptor.nombre },
        { uid: user.uid, nombre: user.nombre, rol: 'caja' },
      )
      setValeando(false)
      setAviso('')
      void verVale(v)
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'vale de caja' })
      setErrorVale(err instanceof Error ? err.message : 'No se pudo registrar el vale.')
    } finally { setGuardando(false) }
  }

  const compartible = puedeCompartirArchivos()
  const bloqueo = mio.cobranzasPendientes > 0
    ? `Hay ${mio.cobranzasPendientes} cobranza(s) que todavía no subieron al servidor. Esperá a que suban antes de cerrar.`
    : calc.anulacionesPendientes > 0
      ? `Tenés ${calc.anulacionesPendientes} anulación(es) de factura esperando autorización. Hasta que se resuelvan no se puede cerrar el turno (la venta anulada deja de contar).`
      : cobranzasTurno.some(anulacionCobranzaEnCurso)
        ? 'Hay un recibo de cobranza con anulación esperando autorización. Hasta que se resuelva no se puede cerrar el turno (el recibo anulado deja de contar).'
        : ''
  const ultimoSobre = sobresHoy[0]
  const entregar = async (datos: DatosEntregaSobre) => {
    if (!entregando) return
    setEntregandoGuardando(true); setErrorEntrega('')
    try {
      await entregarSobre(entregando.id, datos)
      setEntregando(null)
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'entregar el sobre a tesorería' })
      setErrorEntrega(err instanceof Error ? err.message : 'No se pudo registrar la entrega.')
    } finally {
      setEntregandoGuardando(false)
    }
  }
  const toggle = (k: string) => setVerTodas((v) => ({ ...v, [k]: !v[k] }))
  const recorte = <T,>(k: string, xs: T[]): T[] => (verTodas[k] ? xs : xs.slice(0, RENGLONES_A_LA_VISTA))

  if (!user) return null

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Liquidación de caja"
        icono={<Wallet size={22} />}
        contexto={`${user.nombre} · ${user.planta ? PLANTAS[user.planta].label : 'sin planta'} · ${diaLargo(diaTurno)}`}
        chips={sesion
          ? <Badge tono={turnoViejo ? 'aviso' : 'enCamino'} icono={<Clock />}>{turnoViejo ? `Turno del ${diaCorto(sesion.fecha)} sin cerrar` : `Apertura ${horaCorta(sesion.abiertaEn)}`}</Badge>
          : ultimoSobre ? <><Badge tono='neutro' icono={<Clock />}>{`Cierre ${horaCorta(ultimoSobre.cerradaEn)}`}</Badge><BadgeRecepcion sobre={ultimoSobre} /></> : null}
      />

      <FranjaRendicionesPendientes compacta linkAbiertas="/caja/liquidaciones/abiertas" />
      {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
      {/* Anticipos del turno todavía sin contar por tesorería (2026-09-24, pedido de Ariel): aviso fijo,
          sale de los datos y no de un mensaje de una vez, así sigue ahí después de recargar. */}
      {anticipos.filter((a) => !a.recepcion).map((a) => (
        <p key={a.id} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
          <Handshake size={16} className="shrink-0 mt-0.5" />
          <span>Anticipo <b>{a.codigo}</b> de <b>{formatoARS(a.sistema.efectivo)}</b> ({empresaDeAnticipo(a) === 'rolito' ? 'Rolito' : 'Redonhielo'}) entregado a {a.entrega?.recibio.nombre ?? a.custodia.nombre} a las {horaCorta(a.cerradaEn)}. Ya salió de tu caja; tesorería todavía no lo contó.</span>
        </p>
      ))}
      {turnoViejo && sesion && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Tenés el turno del <b>{diaCorto(sesion.fecha)}</b> abierto desde las {horaCorta(sesion.abiertaEn)}. Hasta que lo cierres y entregues el sobre no se puede abrir el de hoy.</span>
        </p>
      )}

      {cargandoSesion && <div className="py-10"><LoadingSpinner /></div>}

      {!cargandoSesion && !sesion && (
        <AbrirTurnoPanel fecha={hoy} titulo={sobresHoy.length ? 'Abrir otro turno' : 'No abriste turno hoy'} />
      )}

      {sesion && sistema && (() => {
        const pe = sistema.porEmpresa
        const chequesTotal = sumaImportes(sistema.cheques)
        // Mi turno se lee en dos partes (2026-09-24, pedido de Ariel: mezclar
        // efectivo, cheques, cuenta corriente y transferencias confundía): arriba
        // LO LÍQUIDO (efectivo y cheques, lo que va al sobre) y, después de los
        // anticipos, lo que NO entra al cajón: cuenta corriente, transferencias
        // y retenciones, cada uno en su recuadro.
        const ventasOrd = ventasTurno.slice().sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())
        const ventasEf = ventasOrd.filter((v) => v.formaPago === 'contado_efectivo')
        const ventasCC = ventasOrd.filter((v) => v.formaPago === 'cuenta_corriente' && v.anulacion?.estado !== 'anulada')
        const ventasTr = ventasOrd.filter((v) => v.formaPago === 'contado_transferencia' && v.anulacion?.estado !== 'anulada')
        const cobOrd = cobranzasTurno.slice().sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())
        const cobEf = cobOrd.filter((c) => c.anulacion?.estado !== 'anulada')
        const cobConCheques = cobOrd.filter((c) => chequesDe(c).length > 0)
        const cobConEfectivo = cobOrd.filter((c) => c.anulacion?.estado === 'anulada' || efectivoDe(c) > 0)
        const chequesLiqLista = liquidaciones.flatMap((l) => (l.cheques ?? []).filter((c) => c.recibido !== false).map((ch) => ({ l, ch })))
        const cobTr = cobEf.filter((c) => transferenciaDe(c) > 0)
        const cobRe = cobEf.filter((c) => retencionesDe(c).length > 0)
        const porEmpresa = (xs: Array<{ empresa: 'redonhielo' | 'rolito'; importe: number }>) =>
          xs.reduce((acc, x) => { acc[x.empresa] += x.importe; acc.total += x.importe; return acc }, { redonhielo: 0, rolito: 0, total: 0 })
        const totCC = porEmpresa(ventasCC.map((v) => ({ empresa: empresaDeVenta(v), importe: importeCobrado(v) })))
        const totTr = porEmpresa([
          ...ventasTr.map((v) => ({ empresa: empresaDeVenta(v), importe: importeCobrado(v) })),
          ...cobTr.map((c) => ({ empresa: empresaDeCobranza(c), importe: transferenciaDe(c) })),
        ])
        const totRe = porEmpresa(cobRe.flatMap((c) => retencionesDe(c).map((r) => ({ empresa: empresaDeCobranza(c), importe: r.importe }))))
        const totChCob = porEmpresa(cobEf.flatMap((c) => chequesDe(c).map((ch) => ({ empresa: empresaDeCobranza(c), importe: ch.importe }))))
        const totChLiq = porEmpresa(chequesLiqLista.map(({ ch }) => ({ empresa: (ch.empresa ?? 'redonhielo') as 'redonhielo' | 'rolito', importe: ch.importe })))
        const chequesCob = cobEf.reduce((s, c) => s + chequesDe(c).length, 0)
        const chequesLiq = liquidaciones.reduce((s, l) => s + (l.cheques ?? []).filter((c) => c.recibido !== false).length, 0)
        // Cheques del cajón por empresa (2026-09-24): en la celda de cada empresa
        // van efectivo y cheques por separado, que es como se arma el sobre.
        const chequesPorEmpresa = sistema.cheques.reduce<Record<'redonhielo' | 'rolito', { total: number; cantidad: number }>>((acc, c) => {
          const e = (c.empresa ?? 'redonhielo') === 'rolito' ? 'rolito' : 'redonhielo'
          acc[e].total += c.importe; acc[e].cantidad++
          return acc
        }, { redonhielo: { total: 0, cantidad: 0 }, rolito: { total: 0, cantidad: 0 } })
        return (
          <>
            <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
              <h2 className="text-center text-lg font-bold text-gray-900 pb-2 mb-1 border-b-2 border-[#B8B5A8]">Liquidación de {user.nombre}</h2>
              <EfectivoCheques
                efectivo={sistema.efectivo}
                cheques={chequesTotal}
                // Sin subtítulos (2026-09-24, pedido de Ariel: hacían ruido): el detalle de anticipos va en las celdas por empresa.
              />
              {pe && (
                <CeldasRH
                  redonhielo={pe.redonhielo.efectivo} rolito={pe.rolito.efectivo}
                  cheques={chequesPorEmpresa}
                />
              )}
              {memoria && memoria.turnos > 0 && (
                <p className="text-xs text-secundario">Este mes: {textoMemoria(memoria)}{memoria.ultimas.length ? ` · última: ${memoria.ultimas[0]!.codigo} (${diaCorto(memoria.ultimas[0]!.fecha)})` : ''}</p>
              )}
            </section>

            <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario pt-1">Lo líquido · efectivo y cheques</h2>
            <BloqueRenglones titulo="Ventas de ventanilla en efectivo" cantidad={ventasEf.filter((v) => v.anulacion?.estado !== 'anulada').length} total={sistema.detalle?.ventasEfectivo ?? 0} redonhielo={pe?.redonhielo.ventasEfectivo ?? 0} rolito={pe?.rolito.ventasEfectivo ?? 0}
              vacio="Sin ventas en efectivo en este turno.">
              {recorte('v', ventasEf).map((v) => (
                <Renglon key={v.id} clave={horaCorta(v.fecha)} texto={nombreClienteVenta(v)} empresa={empresaDeVenta(v)}
                  sub={`${v.canal === 'promo' ? 'promo' : 'contado'}${comprobanteDe(v) ? ` · ${comprobanteDe(v)}` : ''}${v.anulacion?.estado === 'anulada' ? ' · ANULADA' : ''}`}
                  importe={importeCobrado(v)} tachado={v.anulacion?.estado === 'anulada'} />
              ))}
              <VerMas ocultos={ventasEf.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.v} onToggle={() => toggle('v')} />
            </BloqueRenglones>

            <BloqueRenglones titulo="Cobranzas de mostrador en efectivo" cantidad={cobConEfectivo.filter((c) => c.anulacion?.estado !== 'anulada').length} total={sistema.detalle?.cobranzasEfectivo ?? 0} redonhielo={pe?.redonhielo.cobranzasEfectivo ?? 0} rolito={pe?.rolito.cobranzasEfectivo ?? 0}
              vacio="Sin cobranzas en efectivo en este turno.">
              {recorte('c', cobConEfectivo).map((c) => {
                const anulada = c.anulacion?.estado === 'anulada'
                return <Renglon key={c.id} clave={c.numeroRecibo ?? horaCorta(c.fecha)} texto={c.clienteNombre} empresa={empresaDeCobranza(c)} sub={anulada ? 'ANULADO' : undefined} importe={efectivoDe(c)} tachado={anulada} />
              })}
              <VerMas ocultos={cobConEfectivo.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.c} onToggle={() => toggle('c')} />
            </BloqueRenglones>

            <BloqueRenglones titulo="Cobranzas de mostrador en cheques" cantidad={chequesCob} total={totChCob.total} redonhielo={totChCob.redonhielo} rolito={totChCob.rolito}
              nota={chequesCob ? 'van al sobre de su empresa' : undefined} vacio="Sin cheques de mostrador en este turno.">
              {recorte('cch', cobConCheques).flatMap((c) => {
                const anulada = c.anulacion?.estado === 'anulada'
                return chequesDe(c).map((ch) => (
                  <Renglon key={`${c.id}-ch-${ch.numero}`} clave={c.numeroRecibo ?? horaCorta(c.fecha)} texto={c.clienteNombre} empresa={empresaDeCobranza(c)} sub={`${textoCheque(ch)}${anulada ? ' · ANULADO' : ''}`} importe={ch.importe} tachado={anulada} />
                ))
              })}
              <VerMas ocultos={cobConCheques.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.cch} onToggle={() => toggle('cch')} />
            </BloqueRenglones>

            <BloqueRenglones titulo="Liquidaciones de choferes y cobradores en efectivo" cantidad={liquidaciones.length} total={sistema.detalle?.recibidoDeLiquidaciones ?? 0} redonhielo={pe?.redonhielo.recibidoDeLiquidaciones ?? 0} rolito={pe?.rolito.recibidoDeLiquidaciones ?? 0}
              abiertoInicial vacio="Todavía no recibiste ninguna liquidación en este turno.">
              {liquidaciones.map((l) => (
                <Renglon key={l.id} clave={l.codigo ? l.codigo.replace(/^LQ-/, 'LQ ').replace(/-0+/, '-') : l.id} texto={l.choferNombre}
                  sub={`${l.fecha !== diaTurno ? `${diaCorto(l.fecha)} ` : ''}${l.createdAt ? horaCorta(l.createdAt) : ''}${l.diferenciaEfectivo ? ` · diferencia ${formatoARS(l.diferenciaEfectivo)}` : ''}`}
                  importe={l.efectivoRecibido}
                  importePorEmpresa={l.conteoBilletes ? { redonhielo: l.conteoBilletes.redonhielo.total, rolito: l.conteoBilletes.rolito.total } : undefined} />
              ))}
            </BloqueRenglones>

            <BloqueRenglones titulo="Liquidaciones de choferes y cobradores en cheques" cantidad={chequesLiq} total={totChLiq.total} redonhielo={totChLiq.redonhielo} rolito={totChLiq.rolito}
              nota={chequesLiq ? 'van al sobre de su empresa' : undefined} abiertoInicial={chequesLiq > 0} vacio="Ningún cheque recibido con las liquidaciones de este turno.">
              {chequesLiqLista.map(({ l, ch }) => (
                <Renglon key={`${l.id}-${ch.cobranzaId}-${ch.numero}`} clave={ch.numeroRecibo ?? (l.codigo ? l.codigo.replace(/^LQ-/, 'LQ ').replace(/-0+/, '-') : l.id)} texto={ch.clienteNombre} empresa={ch.empresa}
                  sub={`${textoCheque(ch)} · cobró ${l.choferNombre}`} importe={ch.importe} />
              ))}
            </BloqueRenglones>

            <BloqueRenglones titulo="Anticipos a tesorería" cantidad={anticipos.length} total={sistema.detalle?.anticipos ?? 0} redonhielo={pe?.redonhielo.anticipos ?? 0} rolito={pe?.rolito.anticipos ?? 0} resta abiertoInicial={anticipos.length > 0}
              vacio="Ningún anticipo en este turno. Si le adelantás plata a tesorería antes de cerrar, registralo acá para que salga de tu caja.">
              {anticipos.map((a) => (
                <Renglon key={a.id} clave={a.codigo.replace(/^VA-DT-0+/, 'VA-DT-')} texto={`recibió ${a.entrega?.recibio.nombre ?? a.custodia.nombre}`} empresa={empresaDeAnticipo(a)}
                  sub={`${horaCorta(a.cerradaEn)}${a.recepcion ? ' · ya contado por tesorería' : ''}`} importe={a.sistema.efectivo} />
              ))}
            </BloqueRenglones>

            <BloqueRenglones titulo="Vales de caja" cantidad={vales.length} total={sistema.detalle?.vales ?? 0} redonhielo={pe?.redonhielo.vales ?? 0} rolito={pe?.rolito.vales ?? 0} resta abiertoInicial={vales.length > 0}
              vacio="Ningún vale en este turno. Si sale plata de la caja contra un vale firmado, registralo acá: sale de tu caja y viaja en el sobre.">
              {vales.map((v) => (
                <Renglon key={v.id} clave={v.codigo.replace(/^VC-DT-0+/, 'VC-DT-')} texto={`${v.receptor.nombre} · ${v.motivo}`} empresa={v.empresa}
                  sub={`${horaCorta(v.emitidoEn)}${v.estado === 'cerrado' ? ' · ya cerrado por tesorería' : ''}`} importe={v.importe} />
              ))}
            </BloqueRenglones>

            <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario pt-2">No entra a la caja · se registra, no se rinde</h2>
            <BloqueRenglones titulo="Ventas en cuenta corriente" cantidad={ventasCC.length} total={totCC.total} redonhielo={totCC.redonhielo} rolito={totCC.rolito}
              vacio="Sin ventas en cuenta corriente en este turno.">
              {recorte('cc', ventasCC).map((v) => (
                <Renglon key={v.id} clave={horaCorta(v.fecha)} texto={nombreClienteVenta(v)} empresa={empresaDeVenta(v)}
                  sub={`${v.canal === 'promo' ? 'promo' : 'contado'}${comprobanteDe(v) ? ` · ${comprobanteDe(v)}` : ''}`} importe={importeCobrado(v)} />
              ))}
              <VerMas ocultos={ventasCC.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.cc} onToggle={() => toggle('cc')} />
            </BloqueRenglones>

            <BloqueRenglones titulo="Transferencias" cantidad={ventasTr.length + cobTr.length} total={totTr.total} redonhielo={totTr.redonhielo} rolito={totTr.rolito}
              nota="ventas y cobranzas pagadas por transferencia" vacio="Sin transferencias en este turno.">
              {recorte('tr', [
                ...ventasTr.map((v) => ({ id: v.id, fecha: v.fecha, clave: horaCorta(v.fecha), texto: nombreClienteVenta(v), empresa: empresaDeVenta(v), sub: `venta ${v.canal === 'promo' ? 'promo' : 'contado'}${comprobanteDe(v) ? ` · ${comprobanteDe(v)}` : ''}`, importe: importeCobrado(v) })),
                ...cobTr.map((c) => ({ id: c.id, fecha: c.fecha, clave: c.numeroRecibo ?? horaCorta(c.fecha), texto: c.clienteNombre, empresa: empresaDeCobranza(c), sub: 'cobranza de mostrador', importe: transferenciaDe(c) })),
              ].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis())).map((f) => (
                <Renglon key={f.id} clave={f.clave} texto={f.texto} empresa={f.empresa} sub={f.sub} importe={f.importe} />
              ))}
              <VerMas ocultos={ventasTr.length + cobTr.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.tr} onToggle={() => toggle('tr')} />
            </BloqueRenglones>

            <BloqueRenglones titulo="Retenciones" cantidad={cobRe.reduce((s, c) => s + retencionesDe(c).length, 0)} total={totRe.total} redonhielo={totRe.redonhielo} rolito={totRe.rolito}
              nota="certificados que llegaron con un recibo" vacio="Sin retenciones en este turno.">
              {recorte('re', cobRe).flatMap((c) => retencionesDe(c).map((re) => (
                <Renglon key={`${c.id}-re-${re.nroCertificado}`} clave={c.numeroRecibo ?? horaCorta(c.fecha)} texto={c.clienteNombre} empresa={empresaDeCobranza(c)}
                  sub={`retención ${re.tipo.toUpperCase().replace('_', ' ')} · certificado ${re.nroCertificado}`} importe={re.importe} />
              )))}
              <VerMas ocultos={cobRe.length - RENGLONES_A_LA_VISTA} abierto={!!verTodas.re} onToggle={() => toggle('re')} />
            </BloqueRenglones>

            {bloqueo && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{bloqueo}</p>}
            {error && !confirmando && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <Button size="lg" variant="outline" onClick={() => { setErrorVale(''); setValeando(true) }} disabled={!sistema.efectivo}>
                <Receipt /> Vale de caja
              </Button>
              <Button size="lg" variant="outline" onClick={() => { setErrorAnticipo(''); setAnticipando(true) }} disabled={!sistema.efectivo}>
                <Handshake /> Anticipo a tesorería
              </Button>
              <Button size="lg" onClick={() => { setError(''); setConfirmando(true) }} disabled={!!bloqueo}>
                <Landmark /> Cerrar liquidación
              </Button>
            </div>
          </>
        )
      })()}

      {sobresHoy.map((s) => <TuSobre key={s.id} sobre={s} anticipos={anticiposDelTurno(sobres, s.cajaSesionId ?? '')} compartible={compartible} onActa={() => verActa(s)} onEnviar={() => enviar(s)}
        onEntregar={s.estado === 'pendiente_recepcion' && s.rindio.uid === user.uid ? () => { setErrorEntrega(''); setEntregando(s) } : undefined} />)}
      {sobresSinEntregar.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">Liquidaciones de otros días sin entregar a tesorería</h2>
          {sobresSinEntregar.map((s) => <TuSobre key={s.id} sobre={s} anticipos={anticiposDelTurno(sobres, s.cajaSesionId ?? '')} compartible={compartible} onActa={() => verActa(s)} onEnviar={() => enviar(s)}
            onEntregar={s.rindio.uid === user.uid ? () => { setErrorEntrega(''); setEntregando(s) } : undefined} />)}
        </section>
      )}
      {entregando && (
        <EntregarSobreModal sobre={entregando} receptores={receptores} guardando={entregandoGuardando} error={errorEntrega} onCancelar={() => setEntregando(null)} onEntregar={entregar} />
      )}

      <TablaSobres
        titulo="Turnos anteriores · últimos 30 días"
        sobres={anteriores}
        cargando={cargandoSobres}
        exportar={`Mis rendiciones ${hoy}`}
        acciones={(s) => (
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => verActa(s)} title="Ver acta" className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-secundario hover:text-accent hover:bg-accent/10"><Eye size={16} /></button>
            <button type="button" onClick={() => enviar(s)} title={compartible ? 'Enviar' : 'Descargar PDF'} className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-secundario hover:text-accent hover:bg-accent/10"><Share2 size={16} /></button>
          </div>
        )}
      />
      <p className="text-right">
        <Link to="/caja/rendiciones/historial" className="inline-flex items-center gap-1 text-sm text-secundario hover:text-accent"><History size={16} /> Historial completo de cierres</Link>
      </p>

      {valeando && sesion && sistema && (
        <ValeModal porEmpresa={sistema.porEmpresa} guardando={guardando} error={errorVale} onCancelar={() => setValeando(false)} onEntregar={darVale} />
      )}
      {anticipando && sesion && sistema && (
        <AnticipoModal porEmpresa={sistema.porEmpresa} receptores={receptores} guardando={guardando} error={errorAnticipo} onCancelar={() => setAnticipando(false)} onEntregar={anticipar} />
      )}
      {confirmando && sesion && sistema && (
        <CierreTurnoModal
          cajero={user.nombre}
          sistema={sistema}
          resumen={{ ventas: ventasTurno.length, cobranzas: cobranzasTurno.length, liquidaciones: liquidaciones.length }}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={cerrar}
        />
      )}
    </main>
  )
}

/**
 * Después de cerrar: el sobre de hoy con su estado en tesorería, sin buscar
 * en un historial. Efectivo y cheques, partido por empresa; los anticipos del
 * turno; y "recibido por …, conforme" cuando tesorería lo contó.
 */
function TuSobre({ sobre: s, anticipos, compartible, onActa, onEnviar, onEntregar }: { sobre: Sobre; anticipos: Sobre[]; compartible: boolean; onActa: () => void; onEnviar: () => void; onEntregar?: () => void }) {
  const pe = s.sistema.porEmpresa
  const cheques = sumaImportes(s.sistema.cheques)
  const nRH = s.sistema.cheques.filter((c) => (c.empresa ?? 'redonhielo') === 'redonhielo').length
  const mostrador = s.sistema.cheques.filter((c) => !c.origenCodigo).length
  const deLiq = s.sistema.cheques.length - mostrador
  const totalAnticipos = anticipos.reduce((a, x) => a + x.sistema.efectivo, 0)
  const r = s.recepcion
  const difCaja = s.diferenciaDeclarada.efectivo
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">Tu liquidación · <span className="tabular-nums">{s.codigo}</span> <span className="font-normal text-secundario">· cerrado {horaCorta(s.cerradaEn)}</span></h2>
        <BadgeRecepcion sobre={s} />
      </div>
      <EfectivoCheques
        efectivo={s.declarado.efectivo}
        cheques={cheques}
        subEfectivo={pe ? <TextoRH redonhielo={s.fajos?.redonhielo ?? pe.redonhielo.efectivo} rolito={s.fajos?.rolito ?? pe.rolito.efectivo} /> : undefined}
        subCheques={s.sistema.cheques.length ? <>{s.sistema.cheques.length} · {nRH ? `${nRH} Redonhielo` : ''}{nRH && s.sistema.cheques.length - nRH ? ' · ' : ''}{s.sistema.cheques.length - nRH ? `${s.sistema.cheques.length - nRH} Rolito` : ''}{deLiq ? ` · ${mostrador} de mostrador, ${deLiq} de liquidaciones` : ''}</> : 'ninguno'}
      />
      {(difCaja !== 0 || s.diferenciaDeclarada.valoresFaltantes.cantidad > 0) && (
        <p className="text-sm text-red-700">Diferencia de caja: {dif(difCaja)}{s.diferenciaDeclarada.valoresFaltantes.cantidad ? ` · ${s.diferenciaDeclarada.valoresFaltantes.cantidad} valor(es) sin entregar` : ''}{s.motivoDiferencia ? ` · ${MOTIVOS_DIFERENCIA_LIQUIDACION[s.motivoDiferencia.motivo]}${s.motivoDiferencia.nota ? `: ${s.motivoDiferencia.nota}` : ''}` : ''}</p>
      )}
      {anticipos.length > 0 && (
        <div className="rounded-xl border border-[#E7E5DC] overflow-hidden">
          {anticipos.map((a) => <Renglon key={a.id} clave="anticipo" texto={`${a.codigo} · recibió ${a.entrega?.recibio.nombre ?? a.custodia.nombre}`} empresa={empresaDeAnticipo(a)} sub={`${horaCorta(a.cerradaEn)}${a.recepcion ? ' · contado' : ''}`} importe={a.sistema.efectivo} />)}
          <p className="flex justify-between px-3.5 py-2 border-t border-dashed border-[#D3D1C7] text-sm font-bold"><span>Efectivo entregado en el día</span><span className="tabular-nums">{formatoARS(s.declarado.efectivo + totalAnticipos)}</span></p>
        </div>
      )}
      {/* Las tres firmas (2026-09-24): caja al cerrar, tesorería al recibir el sobre en mano, tesorería al contar. */}
      {s.entrega && (
        <p className="text-sm text-gray-900"><Landmark size={14} className="inline mr-1 text-accent" />Entregado en mano a <b>{s.entrega.recibio.nombre}</b> a las {horaCorta(s.entrega.en)}, con su firma. Falta que lo cuente.</p>
      )}
      <p className={`text-sm ${r ? (r.conformidad === 'conforme' ? 'text-[#0F6B4E]' : 'text-red-700') : 'text-secundario'}`}>
        {r ? textoRecepcion(s) : s.entrega ? 'Cuando tesorería lo cuente vas a ver acá "recibido por …, conforme".' : 'Todavía no se lo entregaste a tesorería. Cuando se lo des, que firme acá con "Entregar a tesorería".'}
        {r?.fajos ? <span className="block text-xs text-secundario">Contó <TextoRH redonhielo={r.fajos.redonhielo} rolito={r.fajos.rolito} /></span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {onEntregar && <Button onClick={onEntregar}><Landmark size={16} className="mr-1.5" /> Entregar a tesorería</Button>}
        <Button variant="outline" onClick={onActa}><Eye size={16} className="mr-1.5" /> Ver el acta</Button>
        <Button variant="outline" onClick={onEnviar}><Share2 size={16} className="mr-1.5" /> {compartible ? 'Enviar' : 'Descargar PDF'}</Button>
      </div>
    </section>
  )
}


