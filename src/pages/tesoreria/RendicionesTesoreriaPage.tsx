import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, Printer, ShieldCheck } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { subscribeRendicionesEnRango, validarRendicion } from '@/services/rendicionService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { generateRendicionMostrador } from '@/utils/rendicionPdf'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type PlantaId, type Rendicion } from '@/types'

// Rendiciones para tesorería (2026-09-09): todos los cierres de caja del día
// (por ahora los de mostrador; después repartidores y supervisores), con su
// detalle, y el botón Validar (una vez, con nota opcional).
export default function RendicionesTesoreriaPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const [planta, setPlanta] = useState<PlantaId | ''>('')
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [validando, setValidando] = useState<Rendicion | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeRendicionesEnRango(dia, addDaysStr(dia, 1), setRendiciones), [dia])

  const filas = useMemo(
    () => rendiciones.filter((r) => !planta || r.plantaId === planta).sort((a, b) => a.plantaId.localeCompare(b.plantaId) || a.sujetoNombre.localeCompare(b.sujetoNombre, 'es')),
    [rendiciones, planta],
  )
  const tot = useMemo(() => ({
    aRendir: filas.reduce((s, r) => s + r.efectivoARendir, 0),
    contado: filas.reduce((s, r) => s + r.efectivoContado, 0),
    diferencia: filas.reduce((s, r) => s + r.diferenciaEfectivo, 0),
    sinValidar: filas.filter((r) => !r.validacion).length,
  }), [filas])

  const validar = async () => {
    if (!user || !validando) return
    setGuardando(true); setError('')
    try {
      await validarRendicion(validando.id, { uid: user.uid, nombre: user.nombre }, nota)
      setValidando(null); setNota('')
    } catch (err) {
      reportError(err, { origen: 'RendicionesTesoreriaPage', accion: 'error al validar' })
      setError('No se pudo validar. ¿Ya estaba validada?')
    } finally {
      setGuardando(false)
    }
  }
  const imprimir = (r: Rendicion) => generateRendicionMostrador(r).catch((err) => reportError(err, { origen: 'RendicionesTesoreriaPage', accion: 'error al generar el PDF' }))

  const dif = (n: number) => <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
  const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
  const puedeValidar = user?.rol === 'tesoreria' || user?.rol === 'super_admin' || user?.rol === 'logistica'

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ShieldCheck size={22} className="text-accent" /> Rendiciones</h1>
          <p className="text-gray-500 text-sm">Cierres de caja de ventanilla del día. Tesorería los revisa y valida.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} className={inputClass} />
          <select value={planta} onChange={(e) => setPlanta(e.target.value as PlantaId | '')} className={inputClass}>
            <option value="">Las dos plantas</option>
            {(Object.keys(PLANTAS) as PlantaId[]).map((p) => <option key={p} value={p}>{PLANTAS[p].label}</option>)}
          </select>
          <Link to="/tesoreria/rendiciones/historial" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-accent"><History size={16} /> Historial</Link>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
        <span><b>{filas.length}</b> cierres</span>
        <span>a rendir <b className="tabular-nums">{formatoARS(tot.aRendir)}</b></span>
        <span>contado <b className="tabular-nums">{formatoARS(tot.contado)}</b></span>
        <span>diferencias {dif(tot.diferencia)}</span>
        <span className={tot.sinValidar ? 'text-amber-700 font-semibold' : 'text-[#0F6B4E]'}>{tot.sinValidar} sin validar</span>
      </section>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead><tr>{['Código', 'Planta', 'Cajero', 'Ventas', 'Cobranzas', 'Recibido rep.', 'A rendir', 'Contado', 'Diferencia', 'Cerró', 'Validación', ''].map((h, i) => <th key={h} className={`${th} ${i >= 3 && i <= 8 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {filas.map((r) => (
              <RowRendicion key={r.id} r={r} abierta={abierta === r.id} onToggle={() => setAbierta(abierta === r.id ? null : r.id)} onValidar={puedeValidar ? () => { setValidando(r); setNota('') } : undefined} onImprimir={() => imprimir(r)} td={td} dif={dif} />
            ))}
            {filas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={12}>Sin cierres de caja en este día.</td></tr>}
          </tbody>
        </table>
      </section>

      {validando && (
        <Modal open onClose={() => setValidando(null)} title={`Validar ${validando.codigo}`}>
          <div className="space-y-3">
            <p className="text-sm text-gray-700"><b>{validando.sujetoNombre}</b> · {PLANTAS[validando.plantaId].label} · {validando.fecha}</p>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">A rendir</p><p className="font-semibold tabular-nums">{formatoARS(validando.efectivoARendir)}</p></div>
              <div className="rounded-lg bg-gray-50 p-2"><p className="text-xs text-gray-500">Contado</p><p className="font-semibold tabular-nums">{formatoARS(validando.efectivoContado)}</p></div>
              <div className={`rounded-lg p-2 ${validando.diferenciaEfectivo === 0 ? 'bg-[#E6F5EF]' : 'bg-red-50'}`}><p className="text-xs text-gray-500">Diferencia</p><p className="font-semibold tabular-nums">{formatoARS(validando.diferenciaEfectivo)}</p></div>
            </div>
            {validando.diferencia && <p className="text-sm text-red-700">Motivo declarado: {MOTIVOS_DIFERENCIA_LIQUIDACION[validando.diferencia.motivo]}{validando.diferencia.nota ? ` · ${validando.diferencia.nota}` : ''}</p>}
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota de tesorería (opcional)" rows={2} className={`${inputClass} w-full`} />
            <p className="text-xs text-gray-500">La validación queda registrada con tu nombre y hora y no se puede deshacer.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setValidando(null)} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={validar} loading={guardando} className="flex-1"><ShieldCheck size={16} className="mr-1.5" /> Validar</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}

function RowRendicion({ r, abierta, onToggle, onValidar, onImprimir, td, dif }: {
  r: Rendicion; abierta: boolean; onToggle: () => void; onValidar?: () => void; onImprimir: () => void
  td: string; dif: (n: number) => React.ReactNode
}) {
  const hora = (t: { toDate(): Date }) => t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <tr className={abierta ? 'bg-accent/5' : ''}>
        <td className={td}><button type="button" onClick={onToggle} className="text-accent underline underline-offset-2">{r.codigo}</button></td>
        <td className={td}>{PLANTAS[r.plantaId].label.replace('Planta ', '')}</td>
        <td className={td}>{r.sujetoNombre}</td>
        <td className={`${td} text-right tabular-nums`}>{r.ventas.cantidad} · {formatoARS(r.ventas.total)}</td>
        <td className={`${td} text-right tabular-nums`}>{r.cobranzas.cantidad} · {formatoARS(r.cobranzas.total)}</td>
        <td className={`${td} text-right tabular-nums`}>{r.recibido.liquidaciones.length ? `${r.recibido.liquidaciones.length} · ${formatoARS(r.recibido.efectivo)}` : '—'}</td>
        <td className={`${td} text-right tabular-nums`}>{formatoARS(r.efectivoARendir)}</td>
        <td className={`${td} text-right tabular-nums`}>{formatoARS(r.efectivoContado)}</td>
        <td className={`${td} text-right`}>{dif(r.diferenciaEfectivo)}</td>
        <td className={`${td} text-gray-600`}>{hora(r.hasta)}{r.firmante ? ' · firmó' : ''}</td>
        <td className={td}>
          {r.validacion
            ? <span className="inline-flex items-center gap-1 text-xs text-[#0F6B4E]"><ShieldCheck size={13} /> {r.validacion.nombre} · {hora(r.validacion.fecha)}</span>
            : onValidar ? <Button onClick={onValidar} className="py-1 px-2.5 text-xs"><ShieldCheck size={14} className="mr-1" /> Validar</Button> : <span className="text-xs text-amber-700">Pendiente</span>}
        </td>
        <td className={td}><button type="button" onClick={onImprimir} title="PDF" className="text-gray-400 hover:text-accent p-1"><Printer size={16} /></button></td>
      </tr>
      {abierta && (
        <tr className="bg-accent/5">
          <td className={`${td} text-xs text-gray-700`} colSpan={12}>
            <div className="grid sm:grid-cols-3 gap-4 py-1">
              <div>
                <p className="font-semibold mb-1">Ventas</p>
                <p>Contado: efectivo {formatoARS(r.ventas.contadoEfectivo)} · transf. {formatoARS(r.ventas.contadoTransferencia)} · cta. cte. {formatoARS(r.ventas.cuentaCorriente)}</p>
                <p>Promo: efectivo {formatoARS(r.ventas.promoEfectivo)} · transf. {formatoARS(r.ventas.promoTransferencia)} · cta. cte. {formatoARS(r.ventas.promoCuentaCorriente)}</p>
                {r.bultos.length > 0 && <p className="mt-1 text-gray-500">Bultos: {r.bultos.map((b) => `${b.cantidad} × ${b.nombre}`).join(' · ')}</p>}
              </div>
              <div>
                <p className="font-semibold mb-1">Cobranzas y valores en papel</p>
                <p>Efectivo {formatoARS(r.cobranzas.efectivo)} · transf. {formatoARS(r.cobranzas.transferencia)} · cheques {r.cobranzas.cheques.cantidad} ({formatoARS(r.cobranzas.cheques.total)}) · retenciones {r.cobranzas.retenciones.cantidad} ({formatoARS(r.cobranzas.retenciones.total)})</p>
                {r.cheques.map((ch, i) => <p key={`c${i}`} className={ch.recibido === false ? 'text-red-700' : 'text-gray-500'}>{ch.recibido === false ? '✗' : '✓'} Cheque {ch.numero} · {ch.bancoNombre} · {ch.clienteNombre} · {formatoARS(ch.importe)}{ch.recibido === false ? ` · no entregado${ch.motivoNoEntregado ? `: ${ch.motivoNoEntregado}` : ''}` : ''}</p>)}
                {r.retenciones.map((re, i) => <p key={`r${i}`} className={re.recibido === false ? 'text-red-700' : 'text-gray-500'}>{re.recibido === false ? '✗' : '✓'} Ret. {re.tipo.toUpperCase()} cert. {re.nroCertificado} · {re.clienteNombre} · {formatoARS(re.importe)}{re.recibido === false ? ` · no entregado${re.motivoNoEntregado ? `: ${re.motivoNoEntregado}` : ''}` : ''}</p>)}
              </div>
              <div>
                <p className="font-semibold mb-1">Recibido de repartidores</p>
                {r.recibido.liquidaciones.length === 0 && <p className="text-gray-500">Ninguna liquidación.</p>}
                {r.recibido.liquidaciones.map((l) => <p key={l.id}>{l.choferNombre}: {formatoARS(l.efectivoRecibido)}{l.diferenciaEfectivo !== 0 ? ` (dif. ${formatoARS(l.diferenciaEfectivo)})` : ''}</p>)}
                {r.diferencia && <p className="mt-1 text-red-700">Diferencia: {MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}{r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}</p>}
                {r.validacion?.nota && <p className="mt-1 text-[#0F6B4E]">Nota de tesorería: {r.validacion.nota}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
