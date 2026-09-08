import { useEffect, useMemo, useState } from 'react'
import { coincideBusqueda, normalizarBusqueda, INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import { Link } from 'react-router-dom'
import { Search, UserRound } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import ChipMora, { BORDE_MORA } from '@/components/supervisor/ChipMora'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { nivelMora } from '@/utils/mora'
import { subscribeClientesConDeuda } from '@/services/saldosTangoService'
import { formatoARS } from '@/utils/money'
import { NOMBRE_EMPRESA_CORTO } from '@/utils/tangoEmpresas'
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
  const [filtro, setFiltro] = useState<'todos' | 'vencidos' | 'mora'>('todos')
  const soloVencidos = filtro !== 'todos'
  const [cargando, setCargando] = useState(true)
  const alertas = useAlertasMora()
  const nivelDe = (s: SaldoTango) => nivelMora(s.saldoTotal, atrasoDe(s), alertas)

  useEffect(() => {
    const unsub = subscribeClientesConDeuda((s) => {
      setSaldos(s)
      setCargando(false)
    })
    return unsub
  }, [])

  // Días de atraso de la factura más vieja de cada cliente (0 si nada venció).
  const atrasoDe = (s: SaldoTango) => Math.max(0, ...s.comprobantes.map((c) => c.diasAtraso ?? 0))

  // "Redonhielo $1.200 · Rolito $300" cuando debe en las dos empresas.
  const desglose = (s: SaldoTango): string => {
    const partes = (['redonhielo', 'rolito'] as const)
      .map((e) => [e, s.porEmpresa?.[e]?.saldoTotal ?? 0] as const)
      .filter(([, t]) => t > 0)
    if (partes.length < 2) return ''
    return partes.map(([e, t]) => `${NOMBRE_EMPRESA_CORTO[e]} ${formatoARS(t)}`).join(' · ')
  }

  const filtrados = useMemo(() => {
    const base = soloVencidos ? saldos.filter((s) => atrasoDe(s) > 0) : saldos
    if (!normalizarBusqueda(busqueda)) return base
    const conMora = filtro === 'mora' ? base.filter((s) => nivelDe(s) !== 'ok') : base
    return conMora.filter((s) => coincideBusqueda(busqueda, s.razonSocial, s.codigoTango))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nivelDe depende solo de `alertas`, que sí está en la lista
  }, [saldos, busqueda, soloVencidos, filtro, alertas])

  const totalDeuda = useMemo(() => filtrados.reduce((t, s) => t + s.saldoTotal, 0), [filtrados])
  const vencidos = useMemo(() => saldos.filter((s) => atrasoDe(s) > 0).length, [saldos])
  const enMora = useMemo(() => saldos.filter((s) => nivelMora(s.saldoTotal, atrasoDe(s), alertas) !== 'ok').length, [saldos, alertas])

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Clientes con deuda" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            {...INPUT_BUSQUEDA_PROPS}
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
            <div className="flex gap-2">
              {([['todos', `Todos (${saldos.length})`], ['vencidos', `Vencidos (${vencidos})`], ['mora', `En mora (${enMora})`]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setFiltro(id)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${filtro === id ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-gray-500">{filtrados.length} {filtrados.length === 1 ? 'cliente' : 'clientes'}</p>
              <p className="text-xs text-gray-500">Deuda: <span className="font-semibold text-gray-900">{formatoARS(totalDeuda)}</span></p>
            </div>
            {filtrados.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">Ningún cliente coincide.</p>
            )}
            <div className="space-y-2">
              {filtrados.map((s) => {
                const atraso = atrasoDe(s)
                const nivel = nivelDe(s)
                return (
                  <div key={s.id} className={`flex bg-white rounded-xl border shadow-sm overflow-hidden ${BORDE_MORA[nivel]}`}>
                    <Link to={`/supervisor/cobrar?cliente=${s.id}`} className="block flex-1 min-w-0 p-3 active:bg-gray-50">
                      <div className="flex justify-between items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5 min-w-0"><span className="truncate">{s.razonSocial}</span><ChipMora nivel={nivel} /></p>
                        <p className="text-sm font-semibold text-gray-900 shrink-0">{formatoARS(s.saldoTotal)}</p>
                      </div>
                      <div className="flex justify-between items-center mt-0.5 gap-2">
                        <p className="text-xs text-gray-500 truncate">
                          {s.comprobantes.length} {s.comprobantes.length === 1 ? 'comprobante' : 'comprobantes'} · cód. {s.codigoTango}
                          {atraso > 0 && <span className="text-red-500"> · {atraso} {atraso === 1 ? 'día' : 'días'} de atraso</span>}
                        </p>
                        <p className="text-xs text-gray-400 shrink-0">{haceCuanto(s.actualizadoEn)}</p>
                      </div>
                      {desglose(s) && <p className="text-xs text-gray-500 mt-0.5">{desglose(s)}</p>}
                    </Link>
                    {/* Ficha: contacto, cómo llegar, composición de saldos. */}
                    <Link to={`/supervisor/cliente/${s.id}`} aria-label={`Ficha de ${s.razonSocial}`}
                      className="flex flex-col items-center justify-center gap-0.5 px-3 border-l border-[#D3D1C7] text-accent active:bg-accent/10">
                      <UserRound size={18} />
                      <span className="text-[10px] font-medium">Ficha</span>
                    </Link>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
