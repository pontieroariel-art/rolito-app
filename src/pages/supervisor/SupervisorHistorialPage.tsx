import { useEffect, useMemo, useState } from 'react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import { useAuth } from '@/context/AuthContext'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { formatoARS } from '@/utils/money'
import { Cobranza } from '@/types'
import { diaDe, resumenPorMedio } from './resumenCobranzas'

const DIAS = 30

// Cobranzas anteriores del supervisor: últimos 30 días agrupados por día, con
// el total y el desglose por medio de cada día. Cada cobranza abre su detalle
// (enviar / descargar el recibo, estado en Tango) — igual que en Inicio.
export default function SupervisorHistorialPage() {
  const { user } = useAuth()
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!user) return
    const hasta = new Date(); hasta.setHours(0, 0, 0, 0); hasta.setDate(hasta.getDate() + 1)
    const desde = new Date(hasta); desde.setDate(desde.getDate() - DIAS)
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, (c) => { setCobranzas(c); setCargando(false) })
  }, [user])

  const porDia = useMemo(() => {
    const grupos = new Map<string, Cobranza[]>()
    for (const c of cobranzas) {
      const k = diaDe(c)
      grupos.set(k, [...(grupos.get(k) ?? []), c])
    }
    return [...grupos.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([dia, items]) => ({ dia, items: items.sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()), resumen: resumenPorMedio(items) }))
  }, [cobranzas])

  const totalPeriodo = useMemo(() => resumenPorMedio(cobranzas), [cobranzas])

  const tituloDia = (dia: string) => {
    const [y, m, d] = dia.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Cobranzas anteriores" back />
      <main className="max-w-md mx-auto p-4 space-y-4 pb-10">
        {cargando ? (
          <p className="text-sm text-gray-500 text-center pt-8">Cargando cobranzas…</p>
        ) : cobranzas.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">No registraste cobranzas en los últimos {DIAS} días.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Últimos {DIAS} días</p>
                <p className="text-sm font-semibold text-gray-900">{formatoARS(totalPeriodo.total)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <p className="text-xs text-gray-500 flex justify-between">Efectivo <span className="font-medium text-gray-900">{formatoARS(totalPeriodo.efectivo)}</span></p>
                <p className="text-xs text-gray-500 flex justify-between">Transferencia <span className="font-medium text-gray-900">{formatoARS(totalPeriodo.transferencia)}</span></p>
                <p className="text-xs text-gray-500 flex justify-between">Cheques <span className="font-medium text-gray-900">{formatoARS(totalPeriodo.cheques)}</span></p>
                <p className="text-xs text-gray-500 flex justify-between">Retenciones <span className="font-medium text-gray-900">{formatoARS(totalPeriodo.retenciones)}</span></p>
              </div>
              <p className="text-xs text-gray-400 mt-1">{cobranzas.length} {cobranzas.length === 1 ? 'recibo' : 'recibos'}</p>
            </div>

            {porDia.map(({ dia, items, resumen }) => (
              <section key={dia}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-500 capitalize">{tituloDia(dia)}</h2>
                  <p className="text-sm font-semibold text-gray-900">{formatoARS(resumen.total)}</p>
                </div>
                <div className="space-y-2">
                  {items.map((c) => <CobranzaSupervisorCard key={c.id} c={c} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
