import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, FileText, History, Landmark, Printer, Receipt, Share2, ShoppingCart, Truck, Wallet } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/common/Badge'
import PageHeader from '@/components/common/PageHeader'
import StatusStrip from '@/components/common/StatusStrip'
import { Plegable } from '@/components/ui/Plegable'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import AbrirTurnoPanel from '@/components/expedicion/AbrirTurnoPanel'
import CierreTurnoModal, { type DatosCierreTurnoModal } from '@/components/expedicion/CierreTurnoModal'
import { BadgeRecepcion, TablaSobres, dif, textoCheque, textoRecepcion, textoRetencion } from '@/components/expedicion/SobresCaja'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useMiMostrador } from '@/hooks/useMiMostrador'
import { useSesionAbierta } from '@/hooks/useCajaSesion'
import { subscribeVentasVentanillaDeUsuarioEnRango } from '@/services/ventaVentanillaService'
import { cerrarTurnoYRendir, subscribeSobresDe, SobreYaExisteError } from '@/services/sobreService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { sistemaVentanilla } from '@/utils/sobres'
import { calcularMostrador } from '@/utils/rendicionMostrador'
import { delTurno, horaCorta, liquidacionesPorRendir } from '@/utils/turnoCaja'
import { imprimirActaSobre, type DetalleActaSobre } from '@/utils/sobrePdf'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from '@/utils/medios'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type Sobre, type VentaVentanilla } from '@/types'
import { TH as th, TD as td } from '@/components/common/tabla'

const FORMA: Record<string, string> = { contado_efectivo: 'Efectivo', contado_transferencia: 'Transferencia', cuenta_corriente: 'Cuenta corriente', mixto: 'Mixto' }
const comprobanteDe = (v: VentaVentanilla) => {
  if (v.factura?.puntoVenta && v.factura.numero) return `Fac ${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
  if (v.comprobanteInterno?.numero) return `${v.comprobanteInterno.tipo === 'facturaX' ? 'Fac X' : 'Rem'} ${String(v.comprobanteInterno.puntoVenta).padStart(5, '0')}-${String(v.comprobanteInterno.numero).padStart(8, '0')}`
  return ''
}
const diaLargo = (fecha: string) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' })

// "Mi turno" del cajero (rendición de fondos, 2026-09-14). Reemplaza al cierre
// de caja por día: el cajero abre su turno, vende y cobra adentro, y lo cierra
// con ARQUEO CIEGO rindiendo un sobre `RV-DT-…` a tesorería. Acá NUNCA se
// muestra el efectivo teórico mientras el turno está abierto: solo cantidades.
// El teórico aparece recién en el paso de revelación del asistente de cierre.
export default function RendicionesPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const { sesion, loading: cargandoSesion } = useSesionAbierta(user?.uid, hoy)
  const [ventas, setVentas] = useState<VentaVentanilla[]>([])
  const [sobres, setSobres] = useState<Sobre[]>([])
  const [cargandoSobres, setCargandoSobres] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (!user) return
    const desde = new Date(`${hoy}T00:00:00`)
    const hasta = new Date(`${addDaysStr(hoy, 1)}T00:00:00`)
    const offV = subscribeVentasVentanillaDeUsuarioEnRango(user.uid, desde, hasta, setVentas)
    const offS = subscribeSobresDe(user.uid, addDaysStr(hoy, -30), addDaysStr(hoy, 1), (s) => { setSobres(s); setCargandoSobres(false) })
    return () => { offV(); offS() }
  }, [user, hoy])

  // Cobranzas de hoy y liquidaciones de choferes de los últimos 7 días
  // (una cerrada a última hora se rinde en el turno siguiente).
  const mio = useMiMostrador(user?.uid, hoy, ventas, { diasLiquidaciones: 7 })
  const ventasTurno    = useMemo(() => (sesion ? delTurno(ventas, sesion) : []), [ventas, sesion])
  const cobranzasTurno = useMemo(() => (sesion ? delTurno(mio.cobranzas, sesion) : []), [mio.cobranzas, sesion])
  const liquidaciones  = useMemo(() => (user ? liquidacionesPorRendir(mio.liquidacionesRecibidas, user.uid, sobres) : []), [mio.liquidacionesRecibidas, user, sobres])
  const sistema = useMemo(
    () => (sesion ? sistemaVentanilla({ fondoInicial: sesion.fondoInicial, ventas: ventasTurno, cobranzas: cobranzasTurno, liquidacionesRecibidas: liquidaciones, sobresRecibidos: [] }) : null),
    [sesion, ventasTurno, cobranzasTurno, liquidaciones],
  )
  const calc = useMemo(() => calcularMostrador(ventasTurno, cobranzasTurno, liquidaciones), [ventasTurno, cobranzasTurno, liquidaciones])
  const sobresHoy = useMemo(() => sobres.filter((s) => s.fecha === hoy), [sobres, hoy])
  const detalleActa = (): DetalleActaSobre => ({ liquidaciones: liquidaciones.map((l) => ({ codigo: l.codigo, choferNombre: l.choferNombre, efectivoRecibido: l.efectivoRecibido })) })

  const imprimir = (s: Sobre, detalle: DetalleActaSobre = {}) =>
    imprimirActaSobre(s, 'imprimir', detalle).catch((err) => reportError(err, { origen: 'RendicionesPage', accion: 'error al generar el acta' }))
  const enviar = async (s: Sobre) => {
    setAviso('')
    try {
      const res = await imprimirActaSobre(s, 'compartir')
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
      imprimir(sobre, detalleActa())
    } catch (err) {
      if (err instanceof SobreYaExisteError) setError(err.message)
      else if (err instanceof Error && /diferencia|firma|tildar/.test(err.message)) setError(err.message)
      else { reportError(err, { origen: 'RendicionesPage', accion: 'error al cerrar el turno' }); setError('No se pudo cerrar el turno. Revisá la conexión e intentá de nuevo.') }
    } finally {
      setGuardando(false)
    }
  }

  const compartible = puedeCompartirArchivos()
  const bloqueo = mio.cobranzasPendientes > 0
    ? `Hay ${mio.cobranzasPendientes} cobranza(s) que todavía no subieron al servidor. Esperá a que suban antes de cerrar.`
    : calc.anulacionesPendientes > 0
      ? `Tenés ${calc.anulacionesPendientes} anulación(es) de factura esperando autorización. Hasta que se resuelvan no se puede cerrar el turno (la venta anulada deja de contar).`
      : ''
  const ultimoSobre = sobresHoy[0]

  if (!user) return null

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Mi turno"
        icono={<Wallet size={22} />}
        contexto={`${user.nombre} · ${user.planta ? PLANTAS[user.planta].label : 'sin planta'} · ${diaLargo(hoy)}`}
        chips={sesion
          ? <Badge tono="enCamino" icono={<Clock />}>En caja · turno abierto {horaCorta(sesion.abiertaEn)}</Badge>
          : ultimoSobre ? <BadgeRecepcion sobre={ultimoSobre} /> : null}
      />

      {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      {cargandoSesion && <div className="py-10"><LoadingSpinner /></div>}

      {!cargandoSesion && !sesion && (
        <AbrirTurnoPanel fecha={hoy} titulo={sobresHoy.length ? 'Abrir otro turno' : 'No abriste turno hoy'} />
      )}

      {sesion && sistema && (
        <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">Turno {sesion.numero > 1 ? `${sesion.numero} ` : ''}abierto a las {horaCorta(sesion.abiertaEn)}</h2>
            <p className="text-sm text-secundario">Todo lo que cobraste desde entonces está en tu caja. Cuando termines, cerrá el turno: primero contás, después la app te dice cuánto tenía que haber.</p>
          </div>
          <StatusStrip segmentos={[
            { id: 'ventas',    etiqueta: 'Ventas',    valor: ventasTurno.length,    icono: <ShoppingCart size={14} />, tono: 'confirmado' },
            { id: 'cobranzas', etiqueta: 'Cobranzas', valor: cobranzasTurno.length, icono: <Receipt size={14} />,      tono: 'entregado' },
            { id: 'liqs',      etiqueta: 'Liquidaciones recibidas', valor: liquidaciones.length, icono: <Truck size={14} />, tono: 'pendiente' },
            { id: 'cheques',   etiqueta: 'Cheques',      valor: sistema.cheques.length,     icono: <FileText size={14} /> },
            { id: 'ret',       etiqueta: 'Retenciones',  valor: sistema.retenciones.length, icono: <FileText size={14} /> },
          ]} />

          {liquidaciones.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Recibido de choferes (va en este sobre)</h3>
              <ul className="divide-y divide-[#E7E5DC] text-sm">
                {liquidaciones.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate text-gray-900" title={l.choferNombre}>{l.choferNombre}</span>
                    <span className="text-secundario tabular-nums whitespace-nowrap">{l.codigo ?? l.id} · {l.fecha !== hoy ? `${l.fecha.slice(8, 10)}/${l.fecha.slice(5, 7)} ` : ''}{l.createdAt ? horaCorta(l.createdAt) : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(sistema.cheques.length + sistema.retenciones.length) > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Valores en papel que tendrías que tener</h3>
              <ul className="divide-y divide-[#E7E5DC] text-sm">
                {sistema.cheques.map((ch) => (
                  <li key={`c-${ch.cobranzaId}-${ch.numero}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0"><span className="text-gray-900">{textoCheque(ch)}</span> <span className="text-secundario">· {ch.clienteNombre}{ch.numeroRecibo ? ` · ${ch.numeroRecibo}` : ''}</span></span>
                    <b className="tabular-nums whitespace-nowrap">{formatoARS(ch.importe)}</b>
                  </li>
                ))}
                {sistema.retenciones.map((re) => (
                  <li key={`r-${re.cobranzaId}-${re.nroCertificado}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0"><span className="text-gray-900">{textoRetencion(re)}</span> <span className="text-secundario">· {re.clienteNombre}{re.numeroRecibo ? ` · ${re.numeroRecibo}` : ''}</span></span>
                    <b className="tabular-nums whitespace-nowrap">{formatoARS(re.importe)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bloqueo && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{bloqueo}</p>}
          {error && !confirmando && <p className="text-sm text-red-600">{error}</p>}
          <div className="pt-3 border-t border-[#E7E5DC]">
            <Button size="lg" className="w-full" onClick={() => { setError(''); setConfirmando(true) }} disabled={!!bloqueo}>
              <Landmark /> Cerrar mi turno y rendir a tesorería
            </Button>
          </div>
        </section>
      )}

      {sobresHoy.map((s) => (
        <section key={s.id} className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                <span className="tabular-nums">{s.codigo}</span>
                <BadgeRecepcion sobre={s} detalle />
              </h2>
              <p className="text-sm text-secundario">Rendida a las {horaCorta(s.cerradaEn)} · firmó {s.firmanteRinde}{s.recepcion ? ` · ${textoRecepcion(s)}` : ' · la plata sigue bajo tu custodia hasta que tesorería la reciba'}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" onClick={() => imprimir(s)}><Printer size={16} className="mr-1.5" /> Reimprimir acta</Button>
              <Button variant="outline" onClick={() => enviar(s)}><Share2 size={16} className="mr-1.5" /> {compartible ? 'Enviar' : 'Descargar PDF'}</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">A rendir (sistema)</p><p className="font-semibold tabular-nums text-lg text-gray-900">{formatoARS(s.sistema.efectivo)}</p></div>
            <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">Declaré</p><p className="font-semibold tabular-nums text-lg text-gray-900">{formatoARS(s.declarado.efectivo)}</p></div>
            <div className={`rounded-lg p-3 ${s.diferenciaDeclarada.efectivo === 0 && !s.diferenciaDeclarada.valoresFaltantes.cantidad ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}>
              <p className="text-xs text-secundario">Diferencia de caja</p>
              <p className="text-lg">{dif(s.diferenciaDeclarada.efectivo)}</p>
              {s.diferenciaDeclarada.valoresFaltantes.cantidad > 0 && <p className="text-xs text-red-700">{s.diferenciaDeclarada.valoresFaltantes.cantidad} valor(es) sin entregar · {formatoARS(s.diferenciaDeclarada.valoresFaltantes.total)}</p>}
            </div>
          </div>
          {s.motivoDiferencia && <p className="text-sm text-red-700"><b>Motivo:</b> {MOTIVOS_DIFERENCIA_LIQUIDACION[s.motivoDiferencia.motivo]}{s.motivoDiferencia.nota ? ` · ${s.motivoDiferencia.nota}` : ''}</p>}
          {s.recepcion && (
            <div className="grid grid-cols-3 gap-2 text-sm pt-3 border-t border-[#E7E5DC]">
              <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">Contado por tesorería</p><p className="font-semibold tabular-nums text-lg text-gray-900">{formatoARS(s.recepcion.efectivoContado)}</p></div>
              <div className={`rounded-lg p-3 ${s.recepcion.conformidad === 'conforme' ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}>
                <p className="text-xs text-secundario">Diferencia de recepción</p>
                <p className="text-lg">{dif(s.recepcion.efectivoContado - s.sistema.efectivo)}</p>
              </div>
              <div className="rounded-lg bg-[#F8F7F2] p-3"><p className="text-xs text-secundario">Recibió</p><p className="font-semibold text-gray-900 truncate" title={s.recepcion.recibio.nombre}>{s.recepcion.recibio.nombre}</p><p className="text-xs text-secundario tabular-nums">{horaCorta(s.recepcion.en)}</p></div>
            </div>
          )}
        </section>
      ))}

      {sesion && (
        <>
          <Plegable titulo={`Ventas del turno (${ventasTurno.length})`}>
            <table className="w-full min-w-[640px]">
              <thead><tr>{['Turno', 'Hora', 'Cliente', 'Canal', 'Pago', 'Comprobante', 'Total'].map((h, i) => <th key={h} className={`${th} ${i === 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {ventasTurno.map((v) => (
                  <tr key={v.id} className={v.anulacion?.estado === 'anulada' ? 'line-through text-secundario' : ''}>
                    <td className={td}>{v.turno}</td>
                    <td className={`${td} tabular-nums`}>{horaCorta(v.fecha)}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={nombreClienteVenta(v)}>{nombreClienteVenta(v)}</td>
                    <td className={td}>{v.canal === 'promo' ? 'Promo' : 'Contado'}</td>
                    <td className={td}>{FORMA[v.formaPago] ?? v.formaPago}</td>
                    <td className={`${td} text-gray-600`}>{comprobanteDe(v)}{v.anulacion?.estado === 'anulada' ? <span className="ml-1 no-underline text-red-600 font-semibold">ANULADA</span> : v.anulacion && (v.anulacion.estado === 'pendiente' || v.anulacion.estado === 'aprobada') ? <span className="ml-1 text-amber-700">anulación pendiente</span> : null}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatoARS(v.total)}</td>
                  </tr>
                ))}
                {ventasTurno.length === 0 && <tr><td className={`${td} text-secundario`} colSpan={7}>Sin ventas en este turno.</td></tr>}
              </tbody>
            </table>
          </Plegable>

          <Plegable titulo={`Cobranzas del turno (${cobranzasTurno.length})`}>
            <table className="w-full min-w-[640px]">
              <thead><tr>{['Hora', 'Cliente', 'Recibo', 'Efectivo', 'Transf.', 'Cheques', 'Retenc.'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {cobranzasTurno.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} tabular-nums`}>{horaCorta(c.fecha)}</td>
                    <td className={`${td} max-w-[220px] truncate`} title={c.clienteNombre}>{c.clienteNombre}</td>
                    <td className={`${td} text-gray-600`}>{c.numeroRecibo ?? ''}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatoARS(efectivoDe(c))}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatoARS(transferenciaDe(c))}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatoARS(sumaImportes(chequesDe(c)))}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatoARS(sumaImportes(retencionesDe(c)))}</td>
                  </tr>
                ))}
                {cobranzasTurno.length === 0 && <tr><td className={`${td} text-secundario`} colSpan={7}>Sin cobranzas en este turno.</td></tr>}
              </tbody>
            </table>
          </Plegable>
        </>
      )}

      <TablaSobres
        titulo="Mis rendiciones · últimos 30 días"
        sobres={sobres}
        cargando={cargandoSobres}
        exportar={`Mis rendiciones ${hoy}`}
        acciones={(s) => (
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => imprimir(s)} title="Reimprimir acta" className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-secundario hover:text-accent hover:bg-accent/10"><Printer size={16} /></button>
            <button type="button" onClick={() => enviar(s)} title={compartible ? 'Enviar' : 'Descargar PDF'} className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-secundario hover:text-accent hover:bg-accent/10"><Share2 size={16} /></button>
          </div>
        )}
      />
      <p className="text-right">
        <Link to="/caja/rendiciones/historial" className="inline-flex items-center gap-1 text-sm text-secundario hover:text-accent"><History size={16} /> Historial completo de cierres</Link>
      </p>

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
