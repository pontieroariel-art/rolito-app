import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Truck } from 'lucide-react'
import { subscribeRepartoDelChofer, type FuentesRepartoEnVivo } from '@/services/repartoEnVivoService'
import { agruparRepartoEnVivo, type CamionEnVivo, type EstadoCamion } from '@/utils/repartoEnVivo'
import { formatoARS } from '@/utils/money'

// "Mi camión hoy" (2026-09-10, pedido de un chofer): lo que cargó, lo que ya
// bajó, lo que le queda en el camión por producto, la descarga que contó muelle
// al volver y la plata que lleva encima. Es el mismo cálculo que ve el
// supervisor en "Reparto en vivo" (utils/repartoEnVivo), solo para su camión.

const ESTADO: Record<EstadoCamion, { label: string; clase: string }> = {
  cargando: { label: 'Cargando',  clase: 'bg-amber-50 text-amber-700 border border-amber-200' },
  en_calle: { label: 'En calle',  clase: 'bg-accent/10 text-accent border border-accent/30' },
  volvio:   { label: 'Volvió',    clase: 'bg-gray-100 text-gray-600 border border-gray-200' },
}
const hora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default function MiCamionHoyCard({ uid, hoy }: { uid: string; hoy: string }) {
  const [fuentes, setFuentes] = useState<FuentesRepartoEnVivo | null>(null)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    setFuentes(null)
    const [y, m, d] = hoy.split('-').map(Number)
    return subscribeRepartoDelChofer(new Date(y, m - 1, d), uid, setFuentes)
  }, [uid, hoy])

  const camion: CamionEnVivo | null = useMemo(() => {
    if (!fuentes) return null
    return agruparRepartoEnVivo(fuentes.remitos, fuentes.ventas, fuentes.cambios, fuentes.descargas, fuentes.cobranzas).find((c) => c.choferId === uid) ?? null
  }, [fuentes, uid])

  if (!fuentes) return null
  if (!camion || camion.cargado === 0 && camion.liquidacion.importes.total === 0) return null

  const c = camion
  const liq = c.liquidacion
  const quedan = Math.max(0, c.cargado - c.bajado)
  const pct = c.cargado > 0 ? Math.min(100, Math.round((c.bajado / c.cargado) * 100)) : 0
  const cobr = liq.cobranzasCalle
  const conDescarga = c.detalle.descargas.length > 0
  const difProductos = liq.productos.filter((p) => conDescarga && p.diferencia !== 0)

  return (
    <section className="bg-white border border-[#D3D1C7] rounded-2xl shadow-sm overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="w-full text-left p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Truck size={20} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Mi camión hoy</h2>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${ESTADO[c.estado].clase}`}>{ESTADO[c.estado].label}</span>
            </div>
            <p className="text-xs text-gray-500 truncate">
              {c.camionLabel || 'Sin camión asignado'}{c.salida ? ` · salí ${hora(c.salida)}` : ''}{c.vuelta ? ` · descarga ${hora(c.vuelta)}` : ''}
            </p>
          </div>
          {abierto ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
        </div>

        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Bajé <span className="font-semibold text-gray-900">{c.bajado}</span> de {c.cargado}</span>
            <span>Me quedan <span className="font-semibold text-gray-900">{quedan}</span></span>
          </div>
          <div className="h-2 rounded-full bg-[#F0EEE7] overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-xs text-gray-400">Vendido</p><p className="text-sm font-semibold text-gray-900">{formatoARS(liq.importes.total)}</p></div>
          <div><p className="text-xs text-gray-400">Efectivo encima</p><p className="text-sm font-semibold text-gray-900">{formatoARS(c.efectivo)}</p></div>
          <div><p className="text-xs text-gray-400">Clientes</p><p className="text-sm font-semibold text-gray-900">{c.clientes}</p></div>
        </div>
        {difProductos.length > 0 && (
          <p className="mt-2 text-xs text-red-600">La descarga no cuadra en {difProductos.length === 1 ? 'un producto' : `${difProductos.length} productos`}: abrí para ver.</p>
        )}
      </button>

      {abierto && (
        <div className="border-t border-[#D3D1C7] p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Por producto</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left font-normal">Producto</th>
                  <th className="text-right font-normal">Cargué</th>
                  <th className="text-right font-normal">Vendí</th>
                  <th className="text-right font-normal">Cambios</th>
                  <th className="text-right font-normal">Quedan</th>
                  {conDescarga && <th className="text-right font-normal">Bajó muelle</th>}
                </tr>
              </thead>
              <tbody>
                {liq.productos.map((p) => (
                  <tr key={p.productoId} className="border-t border-gray-100">
                    <td className="py-1 text-gray-900">{p.nombre}</td>
                    <td className="py-1 text-right tabular-nums">{p.carga}</td>
                    <td className="py-1 text-right tabular-nums">{p.ventaContado + p.ventaPromo}</td>
                    <td className="py-1 text-right tabular-nums">{p.cambios || ''}</td>
                    <td className="py-1 text-right tabular-nums font-semibold">{p.devolucionTeorica}</td>
                    {conDescarga && (
                      <td className={`py-1 text-right tabular-nums ${p.diferencia !== 0 ? 'text-red-600 font-semibold' : ''}`}>
                        {p.descarga}{p.diferencia !== 0 ? ` (${p.diferencia > 0 ? '+' : ''}${p.diferencia})` : ''}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!conDescarga && <p className="text-[11px] text-gray-400 mt-1">"Quedan" es lo que tenés que devolver: lo cargado menos lo vendido y los cambios. Muelle lo cuenta cuando volvés.</p>}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Plata</p>
            <div className="text-xs space-y-1">
              <p className="flex justify-between text-gray-600">Ventas en efectivo <span className="text-gray-900 tabular-nums">{formatoARS(liq.importes.contadoEfectivo)}</span></p>
              <p className="flex justify-between text-gray-600">Ventas por transferencia <span className="text-gray-900 tabular-nums">{formatoARS(liq.importes.contadoTransferencia)}</span></p>
              <p className="flex justify-between text-gray-600">Ventas en cuenta corriente <span className="text-gray-900 tabular-nums">{formatoARS(liq.importes.cuentaCorriente)}</span></p>
              {cobr && cobr.cantidad > 0 && (
                <>
                  <p className="flex justify-between text-gray-600">Cobranzas en efectivo ({cobr.cantidad}) <span className="text-gray-900 tabular-nums">{formatoARS(cobr.efectivo)}</span></p>
                  {cobr.transferencia > 0 && <p className="flex justify-between text-gray-600">Cobranzas por transferencia <span className="text-gray-900 tabular-nums">{formatoARS(cobr.transferencia)}</span></p>}
                  {cobr.cheques && cobr.cheques.cantidad > 0 && <p className="flex justify-between text-gray-600">Cheques ({cobr.cheques.cantidad}) <span className="text-gray-900 tabular-nums">{formatoARS(cobr.cheques.total)}</span></p>}
                  {cobr.retenciones && cobr.retenciones.cantidad > 0 && <p className="flex justify-between text-gray-600">Retenciones ({cobr.retenciones.cantidad}) <span className="text-gray-900 tabular-nums">{formatoARS(cobr.retenciones.total)}</span></p>}
                </>
              )}
              <p className="flex justify-between font-semibold text-gray-900 border-t border-gray-100 pt-1">Efectivo a rendir <span className="tabular-nums">{formatoARS(liq.efectivoARendir)}</span></p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
