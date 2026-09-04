import { useEffect, useMemo, useState } from 'react'
import { HandCoins, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { useAuth } from '@/context/AuthContext'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { subscribeCobranzasChoferEnRango } from '@/services/cobranzaService'
import { generateReciboCobranzaSupervisor } from '@/utils/pdf'
import { aCentavos, formatoARS, sumaCentavos } from '@/utils/money'
import { Cobranza } from '@/types'

// Home del supervisor de cobranzas — hub mobile tipo chofer: accesos a las
// tareas + resumen de lo cobrado hoy desglosado por medio de pago.
export default function SupervisorHome() {
  const { user } = useAuth()
  const fecha = useFechaDelDia()
  const [cobranzasHoy, setCobranzasHoy] = useState<Cobranza[]>([])

  useEffect(() => {
    if (!user) return
    const desde = new Date(fecha); desde.setHours(0, 0, 0, 0)
    const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
    // Filtra por registradoPor.uid — sirve para cualquier persona que cobra.
    return subscribeCobranzasChoferEnRango(user.uid, desde, hasta, setCobranzasHoy)
  }, [user, fecha])

  const resumen = useMemo(() => {
    let efectivo = 0, transferencia = 0, chequesCent = 0, retencionesCent = 0
    for (const c of cobranzasHoy) {
      if (c.medios) {
        efectivo += aCentavos(c.medios.efectivo)
        transferencia += aCentavos(c.medios.transferencia)
        chequesCent += sumaCentavos(c.medios.cheques.map((ch) => ch.importe))
        retencionesCent += sumaCentavos(c.medios.retenciones.map((r) => r.importe))
      } else {
        // Por si esta persona registró alguna cobranza simple.
        if (c.formaPago === 'contado_efectivo') efectivo += aCentavos(c.importe)
        else transferencia += aCentavos(c.importe)
      }
    }
    return {
      efectivo: efectivo / 100,
      transferencia: transferencia / 100,
      cheques: chequesCent / 100,
      retenciones: retencionesCent / 100,
      total: (efectivo + transferencia + chequesCent + retencionesCent) / 100,
    }
  }, [cobranzasHoy])

  const descargarRecibo = (c: Cobranza) => {
    if (!c.imputaciones || !c.medios) return
    generateReciboCobranzaSupervisor({
      numeroRecibo:  c.numeroRecibo,
      clienteNombre: c.clienteNombre,
      empresa:       c.empresa ?? 'redonhielo',
      importe:       c.importe,
      imputaciones:  c.imputaciones,
      medios:        c.medios,
      registradoPor: c.registradoPor.nombre,
      fecha:         c.fecha.toDate(),
    })
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
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
              {cobranzasHoy
                .slice()
                .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
                .map((c) => (
                  <button key={c.id} type="button" onClick={() => descargarRecibo(c)}
                    className="w-full text-left bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 active:scale-[0.99] transition-transform">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.clienteNombre}</p>
                      <p className="text-sm font-semibold text-gray-900 shrink-0">{formatoARS(c.importe)}</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      {c.numeroRecibo ?? 'Sin número'} · {c.imputaciones?.length ?? 0} {(c.imputaciones?.length ?? 0) === 1 ? 'factura' : 'facturas'} · tocá para reimprimir
                    </p>
                  </button>
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
