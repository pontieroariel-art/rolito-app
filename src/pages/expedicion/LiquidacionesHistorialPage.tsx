import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, History } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { subscribeLiquidacionesEnRango } from '../../services/liquidacionService'
import { formatoARS } from '../../utils/money'
import { useDiaActual } from '../../hooks/useDiaActual'
import { Liquidacion, MOTIVOS_DIFERENCIA_LIQUIDACION, PLANTAS } from '../../types'

// Historial de liquidaciones (2026-09-06): mes × repartidor, con la diferencia
// de efectivo de cada cierre y los totales por repartidor, para ver quién
// viene con faltantes repetidos. Cada fila abre el cierre en modo lectura.
export default function LiquidacionesHistorialPage() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/tesoreria') ? '/tesoreria' : '/caja'
  const hoy = useDiaActual()
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])
  const [filtroChofer, setFiltroChofer] = useState('')

  useEffect(() => {
    const desde = `${mes}-01`
    const [y, m] = mes.split('-').map(Number)
    const hasta = `${new Date(y, m, 1).getFullYear()}-${String(new Date(y, m, 1).getMonth() + 1).padStart(2, '0')}-01`
    return subscribeLiquidacionesEnRango(desde, hasta, setLiquidaciones, user?.planta)
  }, [mes, user?.planta])

  const porRepartidor = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; deposito?: string; cierres: number; aRendir: number; recibido: number; diferencia: number; conDiferencia: number }>()
    for (const l of liquidaciones) {
      let r = m.get(l.choferId)
      if (!r) { r = { id: l.choferId, nombre: l.choferNombre, deposito: l.depositoTango, cierres: 0, aRendir: 0, recibido: 0, diferencia: 0, conDiferencia: 0 }; m.set(l.choferId, r) }
      r.cierres++
      r.aRendir += l.efectivoARendir
      r.recibido += l.efectivoRecibido
      r.diferencia += l.diferenciaEfectivo
      if (l.diferenciaEfectivo !== 0) r.conDiferencia++
    }
    return [...m.values()].sort((a, b) => a.diferencia - b.diferencia || a.nombre.localeCompare(b.nombre, 'es'))
  }, [liquidaciones])

  const filas = useMemo(
    () => liquidaciones.filter((l) => !filtroChofer || l.choferId === filtroChofer).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.choferNombre.localeCompare(b.choferNombre, 'es')),
    [liquidaciones, filtroChofer],
  )
  const totalDiferencia = liquidaciones.reduce((s, l) => s + l.diferenciaEfectivo, 0)
  const dif = (n: number) => <span className={`tabular-nums font-semibold ${n === 0 ? 'text-gray-500' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{formatoARS(n)}</span>
  const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
  const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
  const selectClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`${base}/liquidaciones`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-accent mb-1"><ArrowLeft size={14} /> Liquidación del día</Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} className="text-accent" /> Historial de liquidaciones</h1>
          <p className="text-gray-500 text-sm">{user?.planta ? PLANTAS[user.planta].label : "Todas las plantas"} · todos los cierres del mes, con su diferencia de efectivo</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={mes} max={hoy.slice(0, 7)} onChange={(e) => { setMes(e.target.value); setFiltroChofer('') }} className={selectClass} />
          <select value={filtroChofer} onChange={(e) => setFiltroChofer(e.target.value)} className={selectClass}>
            <option value="">Todos los repartidores</option>
            {porRepartidor.map((r) => <option key={r.id} value={r.id}>{r.deposito ? `${r.deposito} · ` : ''}{r.nombre}</option>)}
          </select>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
        <div className="flex flex-wrap justify-between gap-2 mb-2">
          <p className="text-sm font-semibold text-gray-900">Por repartidor</p>
          <p className="text-sm text-gray-600">{liquidaciones.length} cierres · diferencia del mes {dif(totalDiferencia)}</p>
        </div>
        <table className="w-full min-w-[640px]">
          <thead><tr>{['Repartidor', 'Cierres', 'A rendir', 'Recibido', 'Diferencia', 'Con diferencia'].map((h, i) => <th key={h} className={`${th} ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {porRepartidor.map((r) => (
              <tr key={r.id} className={filtroChofer === r.id ? 'bg-accent/5' : ''}>
                <td className={td}><button type="button" onClick={() => setFiltroChofer(filtroChofer === r.id ? '' : r.id)} className="text-left hover:text-accent">{r.deposito ? <span className="text-gray-500 mr-1.5">{r.deposito}</span> : null}{r.nombre}</button></td>
                <td className={`${td} text-right tabular-nums`}>{r.cierres}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(r.aRendir)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(r.recibido)}</td>
                <td className={`${td} text-right`}>{dif(r.diferencia)}</td>
                <td className={`${td} text-right tabular-nums`}>{r.conDiferencia ? <span className="text-red-600 font-semibold">{r.conDiferencia}</span> : '0'}</td>
              </tr>
            ))}
            {porRepartidor.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={6}>Sin liquidaciones cerradas en este mes.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 overflow-x-auto">
        <p className="text-sm font-semibold text-gray-900 mb-2">Cierres</p>
        <table className="w-full min-w-[760px]">
          <thead><tr>{['Fecha', 'Repartidor', 'Ventas', 'Cobranzas', 'A rendir', 'Recibido', 'Diferencia', 'Motivo', 'Cerró'].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {filas.map((l) => (
              <tr key={l.id}>
                <td className={td}><Link to={`${base}/liquidaciones?fecha=${l.fecha}&repartidor=${encodeURIComponent(l.choferId)}`} className="text-accent underline underline-offset-2">{l.fecha}</Link></td>
                <td className={td}>{l.depositoTango ? <span className="text-gray-500 mr-1.5">{l.depositoTango}</span> : null}{l.choferNombre}</td>
                <td className={`${td} text-right tabular-nums`}>{l.cantidadVentas ?? '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{l.cantidadCobranzas ?? l.cobranzasCalle?.cantidad ?? '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(l.efectivoARendir)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(l.efectivoRecibido)}</td>
                <td className={`${td} text-right`}>{dif(l.diferenciaEfectivo)}</td>
                <td className={`${td} text-gray-600`}>{l.diferencia ? `${MOTIVOS_DIFERENCIA_LIQUIDACION[l.diferencia.motivo]}${l.diferencia.nota ? ` · ${l.diferencia.nota}` : ''}` : ''}</td>
                <td className={`${td} text-gray-600`}>{l.cerradaPor.nombre}{l.firmanteRepartidor ? ' · firmó' : ''}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={9}>Sin cierres.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  )
}
