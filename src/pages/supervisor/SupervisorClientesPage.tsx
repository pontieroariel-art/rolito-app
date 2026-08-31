import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { subscribeClientesConDeuda } from '@/services/saldosTangoService'
import { formatoARS } from '@/utils/money'
import { SaldoTango } from '@/types'

// "Hace 5 min" / "hace 3 h" / "hace 2 días" — el supervisor necesita saber qué
// tan fresco es el cache de Tango antes de confiar en un saldo.
export function haceCuanto(ts: { toDate(): Date } | undefined): string {
  if (!ts) return ''
  const ms = Date.now() - ts.toDate().getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

// Lista de clientes con deuda en Tango (cache saldosTango), ordenada por saldo.
// Tocar un cliente lleva directo a cobrarle.
export default function SupervisorClientesPage() {
  const [saldos, setSaldos] = useState<SaldoTango[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const unsub = subscribeClientesConDeuda((s) => {
      setSaldos(s)
      setCargando(false)
    })
    return unsub
  }, [])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return saldos
    return saldos.filter((s) =>
      s.razonSocial.toLowerCase().includes(q) || s.codigoTango.includes(q),
    )
  }, [saldos, busqueda])

  const totalDeuda = useMemo(() => saldos.reduce((t, s) => t + s.saldoTotal, 0), [saldos])

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <SupervisorHeader title="Clientes con deuda" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o código…"
            className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {cargando ? (
          <p className="text-sm text-gray-500 text-center pt-8">Cargando saldos…</p>
        ) : saldos.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">No hay saldos de Tango cargados todavía.</p>
            <p className="text-xs text-gray-400 mt-1">El cache se actualiza automáticamente desde el servidor de Tango.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-gray-500">{filtrados.length} {filtrados.length === 1 ? 'cliente' : 'clientes'}</p>
              <p className="text-xs text-gray-500">Deuda total: <span className="font-semibold text-gray-900">{formatoARS(totalDeuda)}</span></p>
            </div>
            <div className="space-y-2">
              {filtrados.map((s) => (
                <Link key={s.id} to={`/supervisor/cobrar?cliente=${s.id}`}
                  className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 active:scale-[0.99] transition-transform">
                  <div className="flex justify-between items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.razonSocial}</p>
                    <p className="text-sm font-semibold text-gray-900 shrink-0">{formatoARS(s.saldoTotal)}</p>
                  </div>
                  <div className="flex justify-between items-center mt-0.5">
                    <p className="text-xs text-gray-500">
                      {s.comprobantes.length} {s.comprobantes.length === 1 ? 'comprobante' : 'comprobantes'} · cód. {s.codigoTango}
                    </p>
                    <p className="text-xs text-gray-400">{haceCuanto(s.actualizadoEn)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
