import { useEffect, useMemo, useState } from 'react'
import { CloudOff, HandCoins, History, Package, Truck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import MiRendicionCard from '@/components/chofer/MiRendicionCard'
import Plata from '@/components/supervisor/Plata'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual, useFechaDelDia } from '@/hooks/useDiaActual'
import { useDepositoDelUsuario } from '@/hooks/useDepositosReparto'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { formatoARS } from '@/utils/money'
import { SISTEMA_LABELS, sistemasDeUsuario } from '@/utils/sistemas'
import { pantallasVisiblesDe } from '@/rutas/catalogo'
import { Cobranza } from '@/types'
import { resumenPorMedio } from '@/pages/comercial/supervisor/resumenCobranzas'

// Home del supervisor de cobranzas (rediseño 2026-09-13): tres accesos —cuatro
// si además entrega desde un depósito— y el pulso del día.
//
// Tenía SEIS tarjetas y cuatro arrancaban buscando un cliente con tres
// buscadores distintos. Ahora "Clientes" es la única puerta al cliente y se
// cobra desde su ficha, que es donde está el saldo completo: en la calle el
// orden natural es cliente → qué le hago, no acción → cliente.
//
// El detalle de los recibos del día NO está acá: es idéntico al primer grupo de
// "Mis cobranzas" (misma consulta, misma tarjeta) y se veía dos veces en la app.
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
  const recibos = cobranzasHoy.length
  // Pantallas de oficina que este supervisor tiene por un rol adicional (p. ej.
  // Tesorería → Liquidaciones), ya recortadas por el super_admin (2026-09-15,
  // pedido de Ariel: que las tenga en su app, no solo en el menú de escritorio).
  const accesosOficina = useMemo(
    () => (user ? sistemasDeUsuario(user).flatMap((s) => pantallasVisiblesDe(user, s).map((i) => ({ ...i, sistema: s }))) : []),
    [user],
  )

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        <Tarjeta to="/supervisor/clientes" icono={<Users size={22} className="text-accent" />}
          titulo="Clientes" bajada="Buscá cualquier cliente, mirá quién debe y cobrá desde su ficha" />

        <Tarjeta to="/supervisor/reparto" icono={<Truck size={22} className="text-accent" />}
          titulo="Reparto en vivo" bajada="Qué cargó, qué bajó y qué le queda a cada camión, con sus ventas" />

        <Tarjeta to="/supervisor/historial" icono={<History size={22} className="text-accent" />}
          titulo="Mis cobranzas"
          bajada={recibos
            ? `Hoy ${formatoARS(resumen.total)} · ${recibos} ${recibos === 1 ? 'recibo' : 'recibos'} · últimos 30 días`
            : 'Últimos 30 días, por día, con reimpresión de recibos'} />

        {deposito && (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm">
            <Link to="/supervisor/vender" className="block p-4 active:scale-[0.99] transition-transform">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <Package size={22} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Vender</p>
                  <p className="text-xs text-secundario">Entregas a demanda desde tu depósito {deposito.codigo} · {deposito.nombre}</p>
                </div>
              </div>
            </Link>
            {/* Mis ventas no tenía ningún link: el que vendía no podía entregar el
                comprobante ni anular un remito (la venta le dice "entregalo desde
                Mis ventas" y no había forma de llegar). */}
            <Link to="/supervisor/ventas" className="flex items-center border-t border-[#E7E5DC] px-4 h-11 text-xs font-medium text-accent">
              Mis ventas — entregá el comprobante →
            </Link>
          </div>
        )}

        {accesosOficina.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario">Oficina</h2>
            {accesosOficina.map((a) => {
              const Icono = a.icon
              return (
                <Tarjeta key={a.to} to={a.to} icono={<Icono size={22} className="text-accent" />}
                  titulo={a.label} bajada={`${SISTEMA_LABELS[a.sistema]} · pantalla de escritorio`} />
              )
            })}
          </section>
        )}

        {sinSubir > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <CloudOff size={16} className="text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              {sinSubir === 1 ? 'Hay 1 cobranza guardada en el teléfono que todavía no se subió' : `Hay ${sinSubir} cobranzas guardadas en el teléfono que todavía no se subieron`}. Se envían solas al volver la señal; no cierres la app.
            </p>
          </div>
        )}

        {recibos > 0 && <CobradoHoy resumen={resumen} />}

        {user && <MiRendicionCard uid={user.uid} hoy={hoy} />}
      </main>
    </div>
  )
}

function Tarjeta({ to, icono, titulo, bajada }: { to: string; icono: React.ReactNode; titulo: string; bajada: string }) {
  return (
    <Link to={to} className="block bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 active:scale-[0.99] transition-transform">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">{icono}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{titulo}</p>
          <p className="text-xs text-secundario">{bajada}</p>
        </div>
      </div>
    </Link>
  )
}

/**
 * Lo cobrado hoy, con el EFECTIVO adelante y aparte: es lo único que el
 * supervisor lleva encima y lo que arriesga en la calle; el resto ya está en el
 * banco o en papel. Antes era un número más entre cuatro iguales.
 */
function CobradoHoy({ resumen }: { resumen: ReturnType<typeof resumenPorMedio> }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Cobrado hoy</h2>
      <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
        <div className="px-3.5 py-3 bg-[#F1F9F6] border-b border-[#E7E5DC]">
          <div className="flex items-center gap-1.5 mb-0.5">
            <HandCoins size={14} className="text-[#0F6E56]" />
            <p className="text-xs font-medium text-[#0F6E56]">Llevás en efectivo</p>
          </div>
          <Plata n={resumen.efectivo} className="block text-2xl font-bold leading-none text-[#0F6E56]" />
        </div>
        <div className="grid grid-cols-3 divide-x divide-[#E7E5DC]">
          {([['Transferencia', resumen.transferencia], ['Cheques', resumen.cheques],
            ['Retenciones', resumen.retenciones]] as const).map(([k, v]) => (
            <div key={k} className="px-3 py-2 min-w-0">
              <p className="text-xs text-secundario truncate" title={k}>{k}</p>
              <Plata n={v} className="block text-sm font-semibold text-gray-900" />
            </div>
          ))}
        </div>
        <div className="px-3.5 py-2 border-t border-[#E7E5DC] flex items-baseline justify-between">
          <p className="text-xs text-secundario">Total cobrado hoy</p>
          <Plata n={resumen.total} className="text-base font-bold text-gray-900" />
        </div>
      </div>
    </section>
  )
}
