import { useEffect, useMemo, useState } from 'react'
import { CloudOff, HandCoins, History, Package, Search, Truck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import MiRendicionCard from '@/components/chofer/MiRendicionCard'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual, useFechaDelDia } from '@/hooks/useDiaActual'
import { useDepositoDelUsuario } from '@/hooks/useDepositosReparto'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { formatoARS } from '@/utils/money'
import { Cobranza } from '@/types'
import { resumenPorMedio } from './resumenCobranzas'

// Home del supervisor de cobranzas — hub mobile tipo chofer: accesos a las
// tareas + resumen de lo cobrado hoy desglosado por medio de pago. Cada
// cobranza abre su detalle (enviar / descargar el recibo, estado en Tango).
export default function SupervisorHome() {
  const { user } = useAuth()
  const fecha = useFechaDelDia()
  const hoy = useDiaActual()
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])
  const [sinSubir, setSinSubir] = useState(0)
  // Un supervisor con depósito de Tango vinculado también entrega mercadería
  // (Ajustes → Depósitos); sin depósito la tarjeta Vender no aparece.
  const { deposito } = useDepositoDelUsuario(user?.uid)

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    // Filtra por registradoPor.uid — sirve para cualquier persona que cobra.
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, setCobranzasHoy, setSinSubir)
  }, [user, fecha])

  const resumen = useMemo(() => resumenPorMedio(cobranzasHoy), [cobranzasHoy])
  const ordenadas = useMemo(() => cobranzasHoy.slice().sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()), [cobranzasHoy])

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <Link to="/supervisor/reparto"
          className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <Truck size={22} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Reparto en vivo</p>
              <p className="text-xs text-gray-500">Qué cargó, qué bajó y qué le queda a cada camión, con sus ventas</p>
            </div>
          </div>
        </Link>

        {deposito && (
          <Link to="/supervisor/vender"
            className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                <Package size={22} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">Vender</p>
                <p className="text-xs text-gray-500">Entregas a demanda desde tu depósito {deposito.codigo} · {deposito.nombre}</p>
              </div>
            </div>
          </Link>
        )}

        <Link to="/supervisor/cobrar"
          className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <HandCoins size={22} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Cobrar</p>
              <p className="text-xs text-gray-500">Composición de saldos, facturas, cheques y retenciones</p>
            </div>
          </div>
        </Link>

        <Link to="/supervisor/buscar"
          className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <Search size={22} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Buscar cliente</p>
              <p className="text-xs text-gray-500">Ficha completa: contacto, cómo llegar, saldo y composición para enviar</p>
            </div>
          </div>
        </Link>

        <Link to="/supervisor/clientes"
          className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <Users size={22} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Clientes con deuda</p>
              <p className="text-xs text-gray-500">Saldos de cuenta corriente traídos de Tango</p>
            </div>
          </div>
        </Link>

        <Link to="/supervisor/historial"
          className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <History size={22} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Cobranzas anteriores</p>
              <p className="text-xs text-gray-500">Últimos 30 días, por día, con reimpresión de recibos</p>
            </div>
          </div>
        </Link>

        {sinSubir > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <CloudOff size={16} className="text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              {sinSubir === 1 ? 'Hay 1 cobranza guardada en el teléfono que todavía no se subió' : `Hay ${sinSubir} cobranzas guardadas en el teléfono que todavía no se subieron`}. Se envían solas al volver la señal; no cierres la app.
            </p>
          </div>
        )}

        {user && <MiRendicionCard uid={user.uid} hoy={hoy} />}

        {cobranzasHoy.length > 0 && (
          <section className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Cobrado hoy</h2>
              <p className="text-sm font-semibold text-gray-900">{formatoARS(resumen.total)}</p>
            </div>

            <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 mb-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <p className="text-xs text-gray-500 flex justify-between">Efectivo <span className="font-medium text-gray-900">{formatoARS(resumen.efectivo)}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Transferencia <span className="font-medium text-gray-900">{formatoARS(resumen.transferencia)}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Cheques <span className="font-medium text-gray-900">{formatoARS(resumen.cheques)}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Retenciones <span className="font-medium text-gray-900">{formatoARS(resumen.retenciones)}</span></p>
            </div>

            <div className="space-y-2">
              {ordenadas.map((c) => <CobranzaSupervisorCard key={c.id} c={c} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
