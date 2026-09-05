import { useEffect, useMemo, useState } from 'react'
import { CloudOff } from 'lucide-react'
import ChoferHeader from '../../components/chofer/ChoferHeader'
import CobranzaCompleta from '@/components/cobranzas/CobranzaCompleta'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import { useAuth } from '../../context/AuthContext'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { subscribeCobranzasChoferEnRango } from '../../services/cobranzaService'
import { formatoARS } from '@/utils/money'
import { Cobranza } from '../../types'

// Cobranza en la calle: el chofer cobra una deuda de cta. cte. con la misma
// cobranza completa del supervisor (composición de saldos, imputación,
// efectivo / transferencia / cheques / retenciones, recibo numerado → Tango).
// Offline-first: registra sin señal y sincroniza al reconectar. Entra a la
// liquidación del día: el efectivo se rinde junto con el de las ventas.
export default function CobranzaCalle() {
  const { user } = useAuth()
  const fecha = useFechaDelDia()
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, setCobranzasHoy, setPendientes)
  }, [user, fecha])

  const ordenadas = useMemo(() => cobranzasHoy.slice().sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()), [cobranzasHoy])
  const totalHoy = cobranzasHoy.reduce((s, c) => s + c.importe, 0)

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <ChoferHeader title="Cobrar" back />
      <CobranzaCompleta origen="cobrador" volverA="/chofer" />

      {(pendientes > 0 || cobranzasHoy.length > 0) && (
        <section className="max-w-md mx-auto px-4 pb-10 space-y-2">
          {pendientes > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <CloudOff size={16} className="text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700">{pendientes === 1 ? '1 cobranza' : `${pendientes} cobranzas`} sin subir: se envían solas al volver la señal.</p>
            </div>
          )}
          {cobranzasHoy.length > 0 && (
            <>
              <div className="flex items-center justify-between pt-2">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Cobrado hoy</h2>
                <p className="text-sm font-semibold text-gray-900">{formatoARS(totalHoy)}</p>
              </div>
              {ordenadas.map((c) => c.medios
                ? <CobranzaSupervisorCard key={c.id} c={c} />
                : (
                  <div key={c.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3">
                    <div className="flex justify-between items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.clienteNombre}</p>
                      <p className="text-sm font-semibold text-gray-900 shrink-0">{formatoARS(c.importe)}</p>
                    </div>
                    <p className="text-xs text-gray-500">{c.formaPago === 'contado_efectivo' ? 'Efectivo' : 'Transferencia'}{c.referencia ? ` · ${c.referencia}` : ''} · cobranza simple</p>
                  </div>
                ))}
            </>
          )}
        </section>
      )}
    </div>
  )
}
