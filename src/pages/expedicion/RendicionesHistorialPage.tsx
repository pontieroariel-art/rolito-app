import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, History, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { formatoARS } from '@/utils/money'
import { codigoDeEntregaId } from '@/utils/entregaTesoreria'
import { useDiaActual } from '@/hooks/useDiaActual'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS, type Rendicion } from '@/types'
import AnuladasDespuesDeCerrar from '@/components/expedicion/AnuladasDespuesDeCerrar'

// Historial de cierres de caja (2026-09-09): mes × cajero, con la diferencia
// de cada cierre y los totales por persona, para ver quién viene con
// faltantes repetidos y qué quedó sin validar. Lo usan caja (/caja/…),
// tesorería y gerencia (/tesoreria/…): mismo componente, distinta ruta.
export default function RendicionesHistorialPage({ enTesoreria }: { enTesoreria: boolean }) {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    const [y, m] = mes.split('-').map(Number)
    const sig = new Date(y, m, 1)
    const hasta = `${sig.getFullYear()}-${String(sig.getMonth() + 1).padStart(2, '0')}-01`
    return subscribeRendicionesEnRango(`${mes}-01`, hasta, setRendiciones)
  }, [mes])

  // Caja ve su planta; tesorería y gerencia, todo.
  const visibles = useMemo(() => rendiciones.filter((r) => enTesoreria || !user?.planta || r.plantaId === user.planta), [rendiciones, enTesoreria, user?.planta])

  const porCajero = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; planta: string; cierres: number; aRendir: number; contado: number; diferencia: number; conDiferencia: number; sinValidar: number }>()
    for (const r of visibles) {
      let x = m.get(r.sujetoId)
      if (!x) { x = { id: r.sujetoId, nombre: r.sujetoNombre, planta: PLANTAS[r.plantaId].label.replace('Planta ', ''), cierres: 0, aRendir: 0, contado: 0, diferencia: 0, conDiferencia: 0, sinValidar: 0 }; m.set(r.sujetoId, x) }
      x.cierres++; x.aRendir += r.efectivoARendir; x.contado += r.efectivoContado; x.diferencia += r.diferenciaEfectivo
      if (r.diferenciaEfectivo !== 0) x.conDiferencia++
      if (!r.validacion) x.sinValidar++
    }
    return [...m.values()].sort((a, b) => a.diferencia - b.diferencia || a.nombre.localeCompare(b.nombre, 'es'))
  }, [visibles])

  const filas = useMemo(
    () => visibles.filter((r) => !filtro || r.sujetoId === filtro).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.sujetoNombre.localeCompare(b.sujetoNombre, 'es')),
    [visibles, filtro],
  )
  const totalDiferencia = visibles.reduce((s, r) => s + r.diferenciaEfectivo, 0)
  const dif = (n: number) => <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
  const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
  const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
  const selectClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={enTesoreria ? '/tesoreria/rendiciones' : '/caja/rendiciones'} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-accent mb-1"><ArrowLeft size={14} /> {enTesoreria ? 'Rendiciones del día' : 'Mi caja'}</Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} className="text-accent" /> Historial de cierres de caja</h1>
          <p className="text-gray-500 text-sm">{enTesoreria || !user?.planta ? 'Las dos plantas' : PLANTAS[user.planta].label} · todos los cierres del mes, con su diferencia y su validación</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={mes} max={hoy.slice(0, 7)} onChange={(e) => { setMes(e.target.value); setFiltro('') }} className={selectClass} />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={selectClass}>
            <option value="">Todos los cajeros</option>
            {porCajero.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.planta}</option>)}
          </select>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
        <div className="flex flex-wrap justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-gray-900">Por cajero</p>
          <p className="text-sm text-gray-600">{visibles.length} cierres · diferencia del mes {dif(totalDiferencia)}</p>
        </div>
        <table className="w-full min-w-[720px]">
          <thead><tr>{['Cajero', 'Planta', 'Cierres', 'A rendir', 'Contado', 'Diferencia', 'Con diferencia', 'Sin validar'].map((h, i) => <th key={h} className={`${th} ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {porCajero.map((c) => (
              <tr key={c.id} className={filtro === c.id ? 'bg-accent/5' : ''}>
                <td className={td}><button type="button" onClick={() => setFiltro(filtro === c.id ? '' : c.id)} className="text-left hover:text-accent">{c.nombre}</button></td>
                <td className={td}>{c.planta}</td>
                <td className={`${td} text-right tabular-nums`}>{c.cierres}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(c.aRendir)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(c.contado)}</td>
                <td className={`${td} text-right`}>{dif(c.diferencia)}</td>
                <td className={`${td} text-right tabular-nums`}>{c.conDiferencia ? <span className="text-red-600 font-semibold">{c.conDiferencia}</span> : '0'}</td>
                <td className={`${td} text-right tabular-nums`}>{c.sinValidar ? <span className="text-amber-700 font-semibold">{c.sinValidar}</span> : '0'}</td>
              </tr>
            ))}
            {porCajero.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={8}>Sin cierres de caja en este mes.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
        <p className="text-sm font-semibold text-gray-900 mb-2">Cierres</p>
        <table className="w-full min-w-[820px]">
          <thead><tr>{['Fecha', 'Código', 'Cajero', 'Ventas', 'Cobranzas', 'A rendir', 'Contado', 'Diferencia', 'Motivo', 'Validada', 'Entrega'].map((h, i) => <th key={h} className={`${th} ${i >= 3 && i <= 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.fecha}</td>
                <td className={td}>{r.codigo}</td>
                <td className={td}>{r.sujetoNombre} <span className="text-gray-400">· {PLANTAS[r.plantaId].label.replace('Planta ', '')}</span></td>
                <td className={`${td} text-right tabular-nums`}>{r.cantidadVentas}</td>
                <td className={`${td} text-right tabular-nums`}>{r.cantidadCobranzas}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(r.efectivoARendir)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(r.efectivoContado)}</td>
                <td className={`${td} text-right`}>{dif(r.diferenciaEfectivo)}</td>
                <td className={`${td} text-gray-600`}>{r.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[r.diferencia.motivo]}${r.diferencia.nota ? ` · ${r.diferencia.nota}` : ''}` : ''}{r.anulacionesPosteriores?.length ? <span className="block"><AnuladasDespuesDeCerrar anulaciones={r.anulacionesPosteriores} compacto /></span> : null}</td>
                <td className={td}>{r.validacion ? <span className="inline-flex items-center gap-1 text-xs text-[#0F6B4E]"><ShieldCheck size={13} /> {r.validacion.nombre}</span> : <span className="text-xs text-amber-700">Pendiente</span>}</td>
                <td className={`${td} text-xs`}>{r.entregaId ? <span className="text-[#0F6B4E]">{codigoDeEntregaId(r.entregaId)}</span> : <span className="text-amber-700">en caja</span>}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={11}>Sin cierres.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  )
}
