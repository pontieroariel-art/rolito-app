import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Truck } from 'lucide-react'
import SupervisorHeader from '@/components/supervisor/SupervisorHeader'
import { useFechaDelDia } from '@/hooks/useDiaActual'
import { subscribeRepartoEnVivo, type FuentesRepartoEnVivo } from '@/services/repartoEnVivoService'
import { agruparRepartoEnVivo, type CamionEnVivo } from '@/utils/repartoEnVivo'
import { formatoARS } from '@/utils/money'
import { haceCuanto } from '@/pages/comercial/supervisor/SupervisorClientesPage'
import DetalleReparto from '@/components/expedicion/liquidacion/DetalleReparto'

// Reparto en vivo: la liquidación de cada repartidor calculada al momento
// (misma cuenta que caja al cerrar el día), para que el supervisor vea qué
// salió, qué bajó y qué le queda a cada camión, y a quién le vendió. Se
// actualiza sola con cada venta. Pedido de Ariel 2026-09-05: "que puedan ver
// la liquidación en vivo de todos los camiones".

const ESTADO: Record<CamionEnVivo['estado'], { label: string; clase: string }> = {
  en_calle: { label: 'En la calle', clase: 'bg-accent/10 text-accent' },
  cargando: { label: 'Cargando',    clase: 'bg-amber-50 text-amber-700' },
  volvio:   { label: 'Volvió',      clase: 'bg-gray-100 text-gray-600' },
}

const hora = (d: Date | null) => (d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—')
const PAGO: Record<string, string> = { contado_efectivo: 'Efectivo', contado_transferencia: 'Transferencia', cuenta_corriente: 'Cta. cte.', mixto: 'Recibo' }

export default function RepartoEnVivoPage() {
  const fecha = useFechaDelDia()
  const [fuentes, setFuentes] = useState<FuentesRepartoEnVivo | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => subscribeRepartoEnVivo(new Date(fecha), setFuentes), [fecha])

  const camiones = useMemo(
    () => (fuentes ? agruparRepartoEnVivo(fuentes.remitos, fuentes.ventas, fuentes.cambios, fuentes.descargas, fuentes.cobranzas) : []),
    [fuentes],
  )
  const totales = useMemo(() => ({
    enCalle:  camiones.filter((c) => c.estado === 'en_calle').length,
    ventas:   camiones.reduce((s, c) => s + c.liquidacion.importes.total, 0),
    efectivo: camiones.reduce((s, c) => s + c.efectivo, 0),
    cargado:  camiones.reduce((s, c) => s + c.cargado, 0),
    bajado:   camiones.reduce((s, c) => s + c.bajado, 0),
  }), [camiones])

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <SupervisorHeader title="Reparto en vivo" back />
      <main className="max-w-md mx-auto p-4 space-y-3 pb-10">
        {!fuentes ? (
          <p className="text-sm text-gray-500 text-center pt-8">Cargando el reparto de hoy…</p>
        ) : camiones.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4 text-center">
            <p className="text-sm text-gray-600">Todavía no salió ningún camión hoy.</p>
            <p className="text-xs text-gray-400 mt-1">Apenas caja emita un remito de carga o un chofer venda, aparece acá.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 grid grid-cols-2 gap-x-4 gap-y-1">
              <p className="text-xs text-gray-500 flex justify-between">Camiones en calle <span className="font-medium text-gray-900">{totales.enCalle} de {camiones.length}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Bajado <span className="font-medium text-gray-900">{totales.bajado} de {totales.cargado}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Vendido <span className="font-medium text-gray-900">{formatoARS(totales.ventas)}</span></p>
              <p className="text-xs text-gray-500 flex justify-between">Efectivo en calle <span className="font-medium text-gray-900">{formatoARS(totales.efectivo)}</span></p>
            </div>

            {camiones.map((c) => {
              const estaAbierto = abierto === c.choferId
              const pct = c.cargado > 0 ? Math.min(100, Math.round((c.bajado / c.cargado) * 100)) : 0
              return (
                <div key={c.choferId} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm overflow-hidden">
                  <button type="button" onClick={() => setAbierto(estaAbierto ? null : c.choferId)} className="w-full text-left p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                        <Truck size={20} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">{c.choferNombre}</p>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${ESTADO[c.estado].clase}`}>{ESTADO[c.estado].label}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {c.camionLabel || 'Sin camión asignado'}{c.salida ? ` · salió ${hora(c.salida)}` : ''}{c.vuelta ? ` · volvió ${hora(c.vuelta)}` : ''}
                        </p>
                      </div>
                      {estaAbierto ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                    </div>

                    {/* Barra: cuánto bajó de lo que cargó */}
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Bajó <span className="font-semibold text-gray-900">{c.bajado}</span> de {c.cargado}</span>
                        <span>Le quedan <span className="font-semibold text-gray-900">{Math.max(0, c.cargado - c.bajado)}</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-[#F0EEE7] overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-xs text-gray-400">Vendido</p><p className="text-sm font-semibold text-gray-900">{formatoARS(c.liquidacion.importes.total)}</p></div>
                      <div><p className="text-xs text-gray-400">Clientes</p><p className="text-sm font-semibold text-gray-900">{c.clientes}</p></div>
                      <div><p className="text-xs text-gray-400">Última venta</p><p className="text-sm font-semibold text-gray-900">{c.ultimaVenta ? haceCuanto({ toDate: () => c.ultimaVenta! }) : '—'}</p></div>
                    </div>
                  </button>

                  {estaAbierto && (
                    <div className="border-t border-[#D3D1C7] p-3 space-y-3">
                      {/* Por producto */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Por producto</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left font-normal">Producto</th>
                              <th className="text-right font-normal">Cargó</th>
                              <th className="text-right font-normal">Bajó</th>
                              <th className="text-right font-normal">Quedan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.liquidacion.productos.map((p) => (
                              <tr key={p.productoId} className="text-gray-700">
                                <td className="py-0.5">{p.nombre}</td>
                                <td className="text-right">{p.carga}</td>
                                <td className="text-right">{p.ventaContado + p.ventaPromo + p.cambios}{p.cambios > 0 ? <span className="text-gray-400"> ({p.cambios} camb.)</span> : null}</td>
                                <td className={`text-right font-semibold ${p.devolucionTeorica < 0 ? 'text-red-500' : 'text-gray-900'}`}>{p.devolucionTeorica}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Plata */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                        <p className="flex justify-between">Contado efectivo <span className="font-medium text-gray-900">{formatoARS(c.liquidacion.importes.contadoEfectivo)}</span></p>
                        <p className="flex justify-between">Transferencia <span className="font-medium text-gray-900">{formatoARS(c.liquidacion.importes.contadoTransferencia)}</span></p>
                        <p className="flex justify-between">Cuenta corriente <span className="font-medium text-gray-900">{formatoARS(c.liquidacion.importes.cuentaCorriente)}</span></p>
                        <p className="flex justify-between">Cobranzas en calle <span className="font-medium text-gray-900">{formatoARS(c.liquidacion.cobranzasCalle?.total ?? 0)}</span></p>
                        <p className="flex justify-between col-span-2 border-t border-[#D3D1C7] pt-1 mt-1">Efectivo que lleva <span className="font-semibold text-gray-900">{formatoARS(c.efectivo)}</span></p>
                      </div>

                      {/* Detalle clasificado (el mismo de la liquidación de caja):
                          ventas por tipo con su comprobante y estado en Tango,
                          cobranzas con su recibo, cambios, recorrido. */}
                      <DetalleReparto remitos={c.detalle.remitos} ventas={c.detalle.ventas} cambios={c.detalle.cambios}
                        descargas={c.detalle.descargas} cobranzas={c.detalle.cobranzas} />
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
