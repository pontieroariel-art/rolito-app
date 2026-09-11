import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, Printer, Share2, ShieldCheck, Wallet } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import Button from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useMiMostrador } from '@/hooks/useMiMostrador'
import { subscribeVentasVentanillaDeUsuarioEnRango } from '@/services/ventaVentanillaService'
import { crearRendicionMostrador, RendicionYaCerradaError, subscribeRendicion } from '@/services/rendicionService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { fueraDelCierre } from '@/utils/rendicionMostrador'
import { valoresEnPapel } from '@/utils/valoresEnPapel'
import ValoresEnPapel from '@/components/expedicion/ValoresEnPapel'
import { generateRendicionMostrador, nombreArchivoRendicion, type DetalleRendicionPdf } from '@/utils/rendicionPdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from '@/utils/medios'
import { TilesMostrador } from '@/components/expedicion/MiDiaMostrador'
import { Plegable } from '@/components/ui/Plegable'
import CierreLiquidacionModal, { type DatosCierre, type TextosCierre } from '@/components/expedicion/liquidacion/CierreLiquidacionModal'
import { MOTIVOS_CIERRE_MOSTRADOR, MOTIVOS_DIFERENCIA_LIQUIDACION, type Rendicion, type VentaVentanilla } from '@/types'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'

const TEXTOS_CAJA: TextosCierre = {
  titulo: 'Cerrar mi caja', sujeto: 'caja', aRendir: 'Efectivo en caja', recibido: 'Contado',
  confirmacion: <>Conté todo el efectivo de mi caja y <b>no quedan cobranzas sin subir</b> en esta terminal.</>,
  firma: 'Firma de quien cierra la caja',
  boton: 'Cerrar mi caja e imprimir',
  pie: 'Al confirmar se guarda el cierre (no se puede editar), se imprime y queda a la vista de tesorería para su validación.',
}

const FORMA: Record<string, string> = { contado_efectivo: 'Efectivo', contado_transferencia: 'Transferencia', cuenta_corriente: 'Cuenta corriente', mixto: 'Mixto' }
const comprobanteDe = (v: VentaVentanilla) => {
  if (v.factura?.puntoVenta && v.factura.numero) return `Fac ${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}`
  if (v.comprobanteInterno?.numero) return `${v.comprobanteInterno.tipo === 'facturaX' ? 'Fac X' : 'Rem'} ${String(v.comprobanteInterno.puntoVenta).padStart(5, '0')}-${String(v.comprobanteInterno.numero).padStart(8, '0')}`
  return ''
}

// Cierre de caja del usuario de ventanilla (2026-09-09): lo que vendió, cobró y
// recibió de repartidores en el día → efectivo a rendir; cuenta, firma y queda
// inmutable y a la vista de tesorería. No bloquea la venta: lo posterior al
// cierre se rinde al día siguiente.
export default function RendicionesPage() {
  const { user } = useAuth()
  const hoyStr = useDiaActual()
  const [dia, setDia] = useState(hoyStr)
  const [ventas, setVentas] = useState<VentaVentanilla[]>([])
  const [cerrada, setCerrada] = useState<Rendicion | null>(null)
  const [efectivoContado, setEfectivoContado] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (!user) return
    const desde = new Date(`${dia}T00:00:00`)
    const hasta = new Date(`${addDaysStr(dia, 1)}T00:00:00`)
    const offV = subscribeVentasVentanillaDeUsuarioEnRango(user.uid, desde, hasta, setVentas)
    const offR = subscribeRendicion(dia, user.uid, setCerrada)
    return () => { offV(); offR() }
  }, [user, dia])
  useEffect(() => { setEfectivoContado(''); setError(''); setAviso('') }, [dia])

  const mio = useMiMostrador(user?.uid, dia, ventas)
  const hastaCierre = cerrada ? cerrada.hasta.toMillis() : null
  const ventasFuera = useMemo(() => fueraDelCierre(ventas, hastaCierre), [ventas, hastaCierre])
  const cobranzasFuera = useMemo(() => fueraDelCierre(mio.cobranzas, hastaCierre), [mio.cobranzas, hastaCierre])
  const papel = useMemo(() => valoresEnPapel(mio.cobranzas), [mio.cobranzas])

  const contado = cerrada ? cerrada.efectivoContado : (parseInt(efectivoContado.replace(/\D/g, ''), 10) || 0)
  const diferencia = cerrada ? cerrada.diferenciaEfectivo : (efectivoContado.trim() === '' ? null : contado - mio.calc.efectivoARendir)
  const hayMovimientos = ventas.length + mio.cobranzas.length + mio.liquidacionesRecibidas.length > 0

  const detallePdf = (): DetalleRendicionPdf => ({
    ventas: ventas.slice().sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis()).map((v) => ({ turno: v.turno, hora: v.fecha.toDate(), cliente: v.clienteNombre, canal: v.canal === 'promo' ? 'Promo' : 'Contado', formaPago: FORMA[v.formaPago] ?? v.formaPago, total: v.total, comprobante: comprobanteDe(v) })),
    cobranzas: mio.cobranzas.slice().sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis()).map((c) => ({ hora: c.fecha.toDate(), cliente: c.clienteNombre, recibo: c.numeroRecibo, efectivo: efectivoDe(c), transferencia: transferenciaDe(c), cheques: sumaImportes(chequesDe(c)), retenciones: sumaImportes(retencionesDe(c)) })),
  })
  const imprimir = (r: Rendicion) => generateRendicionMostrador(r, detallePdf()).catch((err) => reportError(err, { origen: 'RendicionesPage', accion: 'error al generar el PDF' }))
  const enviar = async (r: Rendicion) => {
    setAviso('')
    try {
      const blob = (await generateRendicionMostrador(r, detallePdf(), { descargar: false })) as Blob
      const res = await compartirArchivo(blob, nombreArchivoRendicion(r), { titulo: `Cierre de caja ${r.codigo}`, texto: `Cierre de caja del ${r.fecha} de ${r.sujetoNombre}` })
      if (res === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
    } catch (err) {
      reportError(err, { origen: 'RendicionesPage', accion: 'error al enviar el PDF' })
      setAviso('No se pudo generar el PDF.')
    }
  }

  const cerrar = async (datos: DatosCierre) => {
    if (!user || !user.planta) { setError('Tu usuario no tiene planta asignada.'); return }
    setGuardando(true); setError('')
    const calc = mio.calc
    try {
      const r = await crearRendicionMostrador({
        fecha: dia, plantaId: user.planta, sujetoId: user.uid, sujetoNombre: user.nombre,
        ventas: calc.ventas, cobranzas: calc.cobranzas, recibido: calc.recibido, bultos: calc.bultos,
        // Tildados uno por uno en el modal (2026-09-09); sin valores, listas vacías.
        cheques: datos.cheques ?? [],
        retenciones: datos.retenciones ?? [],
        efectivoARendir: calc.efectivoARendir, efectivoContado: contado, diferenciaEfectivo: contado - calc.efectivoARendir,
        ...(datos.diferencia ? { diferencia: datos.diferencia } : {}),
        firma: datos.firma, firmante: datos.firmante, confirmoSinPendientes: datos.confirmoSinPendientes,
        ventasIds: ventas.map((v) => v.id), cobranzasIds: mio.cobranzas.map((c) => c.id), liquidacionesIds: mio.liquidacionesRecibidas.map((l) => l.id),
        cantidadVentas: ventas.length, cantidadCobranzas: mio.cobranzas.length,
        desde: Timestamp.fromDate(new Date(`${dia}T00:00:00`)), hasta: Timestamp.now(),
      }, { uid: user.uid, nombre: user.nombre })
      setConfirmando(false)
      imprimir(r)
    } catch (err) {
      if (err instanceof RendicionYaCerradaError) setError(err.message)
      else { reportError(err, { origen: 'RendicionesPage', accion: 'error al cerrar la caja' }); setError('No se pudo cerrar la caja. Revisá e intentá de nuevo.') }
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
  const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
  const compartible = puedeCompartirArchivos()

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Wallet size={22} className="text-accent" /> Mi caja · {user?.nombre}</h1>
          <p className="text-gray-500 text-sm">Lo que vendí, cobré y recibí de repartidores en el día. Al cerrar, queda a la vista de tesorería.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dia} max={hoyStr} onChange={(e) => setDia(e.target.value)} className={inputClass} />
          <Link to="/caja/rendiciones/historial" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-accent"><History size={16} /> Historial</Link>
        </div>
      </div>

      {cerrada && (
        <section className="bg-accent/5 border border-accent/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700">
            <b>{cerrada.codigo}</b> · cerrada a las {cerrada.hasta.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · firmó <b>{cerrada.firmante}</b>
            {cerrada.diferenciaEfectivo !== 0 && <span className="text-red-600 font-medium"> · diferencia {formatoARS(cerrada.diferenciaEfectivo)}{cerrada.diferencia ? ` (${MOTIVOS_DIFERENCIA_LIQUIDACION[cerrada.diferencia.motivo]}${cerrada.diferencia.nota ? `: ${cerrada.diferencia.nota}` : ''})` : ''}</span>}
            <span className="block text-xs mt-0.5">
              {cerrada.validacion
                ? <span className="inline-flex items-center gap-1 text-[#0F6B4E]"><ShieldCheck size={14} /> Validada por tesorería ({cerrada.validacion.nombre}, {cerrada.validacion.fecha.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}){cerrada.validacion.nota ? ` · ${cerrada.validacion.nota}` : ''}</span>
                : <span className="text-amber-700">Pendiente de validación de tesorería</span>}
            </span>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => imprimir(cerrada)}><Printer size={16} className="mr-1.5" /> Reimprimir</Button>
            <Button variant="outline" onClick={() => enviar(cerrada)}><Share2 size={16} className="mr-1.5" /> {compartible ? 'Enviar' : 'Descargar PDF'}</Button>
          </div>
        </section>
      )}
      {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
      {mio.cobranzasPendientes > 0 && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Hay {mio.cobranzasPendientes} cobranza(s) que todavía no subieron al servidor. Esperá a que suban antes de cerrar.</p>}
      {!cerrada && mio.calc.anulacionesPendientes > 0 && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Tenés {mio.calc.anulacionesPendientes} anulación(es) de factura esperando autorización. Hasta que se resuelvan no se puede cerrar la caja (la venta anulada deja de contar).</p>}

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
        <TilesMostrador calc={mio.calc} />
        <div className="grid sm:grid-cols-[1fr_1.3fr_1fr] gap-4 items-end pt-3 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Efectivo a rendir</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(mio.calc.efectivoARendir)}</p>
            <p className="text-[11px] text-gray-500">Ventas efectivo {formatoARS(mio.calc.ventas.contadoEfectivo + mio.calc.ventas.promoEfectivo)} + cobranzas efectivo {formatoARS(mio.calc.cobranzas.efectivo)} + recibido {formatoARS(mio.calc.recibido.efectivo)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Efectivo contado</p>
            {cerrada ? <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(cerrada.efectivoContado)}</p> : (
              <input value={efectivoContado} onChange={(e) => setEfectivoContado(e.target.value)} inputMode="numeric" placeholder="0"
                className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-lg text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent tabular-nums" />
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500">Diferencia</p>
            {diferencia === null ? <p className="text-2xl font-bold text-gray-400">—</p> : (
              <p className={`text-2xl font-bold tabular-nums ${diferencia === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(diferencia)}{diferencia === 0 ? ' ✓' : ''}</p>
            )}
          </div>
        </div>
      </section>

      <Plegable titulo={`Mis ventas (${ventas.length})`} abiertoInicial>
        <table className="w-full min-w-[640px]">
          <thead><tr>{['Turno', 'Hora', 'Cliente', 'Canal', 'Pago', 'Comprobante', 'Total'].map((h, i) => <th key={h} className={`${th} ${i === 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} className={`${ventasFuera.includes(v) ? 'opacity-60' : ''} ${v.anulacion?.estado === 'anulada' ? 'line-through text-gray-400' : ''}`}>
                <td className={td}>{v.turno}</td>
                <td className={td}>{v.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className={td}>{nombreClienteVenta(v)}</td>
                <td className={td}>{v.canal === 'promo' ? 'Promo' : 'Contado'}</td>
                <td className={td}>{FORMA[v.formaPago] ?? v.formaPago}</td>
                <td className={`${td} text-gray-600`}>{comprobanteDe(v)}{v.anulacion?.estado === 'anulada' ? <span className="ml-1 no-underline text-red-600 font-semibold">ANULADA</span> : v.anulacion && (v.anulacion.estado === 'pendiente' || v.anulacion.estado === 'aprobada') ? <span className="ml-1 text-amber-700">anulación pendiente</span> : null}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(v.total)}</td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={7}>Sin ventas.</td></tr>}
          </tbody>
        </table>
      </Plegable>

      <Plegable titulo={`Mis cobranzas (${mio.cobranzas.length})`}>
        <table className="w-full min-w-[640px]">
          <thead><tr>{['Hora', 'Cliente', 'Recibo', 'Efectivo', 'Transf.', 'Cheques', 'Retenc.'].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {mio.cobranzas.map((c) => (
              <tr key={c.id} className={cobranzasFuera.includes(c) ? 'opacity-60' : ''}>
                <td className={td}>{c.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                <td className={td}>{c.clienteNombre}</td>
                <td className={`${td} text-gray-600`}>{c.numeroRecibo ?? ''}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(efectivoDe(c))}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(transferenciaDe(c))}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(sumaImportes(chequesDe(c)))}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(sumaImportes(retencionesDe(c)))}</td>
              </tr>
            ))}
            {mio.cobranzas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={7}>Sin cobranzas.</td></tr>}
          </tbody>
        </table>
      </Plegable>

      {((cerrada ? cerrada.cheques.length + cerrada.retenciones.length : papel.cheques.length + papel.retenciones.length) > 0) && (
        <Plegable titulo={`Valores en papel a entregar (${cerrada ? cerrada.cheques.length + cerrada.retenciones.length : papel.cheques.length + papel.retenciones.length})`} abiertoInicial>
          {cerrada
            ? <ValoresEnPapel cheques={cerrada.cheques} retenciones={cerrada.retenciones} soloLectura />
            : <><p className="text-xs text-gray-500 mb-2">Se tildan uno por uno al cerrar la caja.</p><ValoresEnPapel cheques={papel.cheques} retenciones={papel.retenciones} soloLectura /></>}
        </Plegable>
      )}

      {mio.calc.bultos.length > 0 && (
        <Plegable titulo="Mercadería que saqué del depósito">
          <ul className="text-sm text-gray-700 grid sm:grid-cols-2 gap-x-6">
            {mio.calc.bultos.map((b) => <li key={b.productoId} className="flex justify-between border-b border-gray-100 py-1"><span>{b.nombre}</span><b className="tabular-nums">{b.cantidad}</b></li>)}
          </ul>
        </Plegable>
      )}

      {cerrada && (ventasFuera.length > 0 || cobranzasFuera.length > 0) && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>Fuera del cierre:</b> {ventasFuera.length} venta(s) y {cobranzasFuera.length} cobranza(s) posteriores a las {cerrada.hasta.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} ({formatoARS(ventasFuera.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + v.total, 0) + cobranzasFuera.reduce((s, c) => s + efectivoDe(c), 0))} en efectivo). Se rinden en el próximo cierre.
        </section>
      )}

      {!cerrada && (
        <div className="flex flex-wrap justify-end gap-2">
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
          <Button onClick={() => setConfirmando(true)} disabled={!hayMovimientos || efectivoContado.trim() === '' || mio.cobranzasPendientes > 0 || mio.calc.anulacionesPendientes > 0}>
            <Printer size={16} className="mr-1.5" /> Cerrar mi caja e imprimir
          </Button>
          {hayMovimientos && efectivoContado.trim() === '' && <p className="w-full text-right text-xs text-gray-500">Cargá el efectivo contado para poder cerrar.</p>}
        </div>
      )}

      {confirmando && user && (
        <CierreLiquidacionModal
          repartidor={user.nombre}
          resumen={{ ventas: ventas.length, clientes: new Set(ventas.map((v) => v.clienteNombre)).size, cobranzas: mio.cobranzas.length }}
          efectivoARendir={mio.calc.efectivoARendir}
          efectivoRecibido={contado}
          guardando={guardando}
          error={error}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={cerrar}
          textos={{ ...TEXTOS_CAJA, valores: 'Cheques y retenciones de mis cobranzas: tildá cada uno que tenés en mano' }}
          motivos={MOTIVOS_CIERRE_MOSTRADOR}
          valores={papel}
        />
      )}
    </main>
  )
}
