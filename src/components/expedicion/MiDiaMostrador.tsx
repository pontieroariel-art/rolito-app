import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import type { MostradorCalculado } from '@/utils/rendicionMostrador'
import { formatoARS } from '@/utils/money'

// Tarjetas de "Mi día" de un usuario de caja (2026-09-09): lo que vendió por
// forma de pago, lo que cobró en mostrador, lo que recibió de repartidores y el
// efectivo que tiene en su caja. Las usan la ventanilla (resumen) y el cierre
// de caja (con el input de efectivo contado al lado).
export function TilesMostrador({ calc, compacto = false }: { calc: MostradorCalculado; compacto?: boolean }) {
  const v = calc.ventas, c = calc.cobranzas
  const Tile = ({ color, titulo, total, lineas }: { color: string; titulo: string; total: number; lineas: Array<[string, string]> }) => (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5" style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{formatoARS(total)}</p>
      {!compacto && (
        <div className="text-xs text-gray-600 space-y-0.5">
          {lineas.map(([k, val]) => <p key={k} className="flex justify-between gap-2"><span>{k}</span><b className="text-gray-800 tabular-nums">{val}</b></p>)}
        </div>
      )}
    </div>
  )
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile color="#1D6FA8" titulo="Contado · Redonhielo" total={v.contadoEfectivo + v.contadoTransferencia + v.cuentaCorriente}
        lineas={[['Efectivo', formatoARS(v.contadoEfectivo)], ['Transferencia', formatoARS(v.contadoTransferencia)], ['Cuenta corriente', formatoARS(v.cuentaCorriente)]]} />
      <Tile color="#8A4FBF" titulo="Promo · Rolito" total={v.promoEfectivo + v.promoTransferencia + v.promoCuentaCorriente}
        lineas={[['Efectivo', formatoARS(v.promoEfectivo)], ['Transferencia', formatoARS(v.promoTransferencia)], ['Cuenta corriente', formatoARS(v.promoCuentaCorriente)]]} />
      <Tile color="#0F6B4E" titulo={`Cobranzas (${c.cantidad})`} total={c.total}
        lineas={[['Efectivo', formatoARS(c.efectivo)], ['Transferencia', formatoARS(c.transferencia)], [`Cheques (${c.cheques.cantidad})`, formatoARS(c.cheques.total)], ...(c.retenciones.cantidad ? [[`Retenciones (${c.retenciones.cantidad})`, formatoARS(c.retenciones.total)] as [string, string]] : [])]} />
      <Tile color="#B4531A" titulo={`Recibido de repartidores (${calc.recibido.liquidaciones.length})`} total={calc.recibido.efectivo}
        lineas={calc.recibido.liquidaciones.slice(0, 3).map((l) => [l.choferNombre, formatoARS(l.efectivoRecibido)] as [string, string])} />
    </div>
  )
}

export default function MiDiaMostrador({ calc, nombre, cerrarHref }: { calc: MostradorCalculado; nombre: string; cerrarHref?: string }) {
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-800">Mi día · {nombre}</h2>
          <p className="text-xs text-gray-500">{calc.ventas.cantidad} ventas · {calc.cobranzas.cantidad} cobranzas · {calc.recibido.liquidaciones.length} liquidaciones recibidas</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Efectivo en mi caja</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(calc.efectivoARendir)}</p>
          </div>
          {cerrarHref && (
            <Link to={cerrarHref} className="inline-flex items-center gap-2 rounded-lg bg-accent text-white text-sm font-medium px-3 py-2 hover:opacity-90">
              <Wallet size={16} /> Cerrar mi caja
            </Link>
          )}
        </div>
      </div>
      <TilesMostrador calc={calc} compacto />
      {calc.bultos.length > 0 && (
        <p className="text-xs text-gray-600">
          <span className="font-semibold text-gray-700">Saqué del depósito:</span>{' '}
          {calc.bultos.map((b) => `${b.cantidad} × ${b.nombre}`).join(' · ')}
        </p>
      )}
    </section>
  )
}
