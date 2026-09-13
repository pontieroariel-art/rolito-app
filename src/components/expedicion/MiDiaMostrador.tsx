import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import type { MostradorCalculado } from '@/utils/rendicionMostrador'
import { formatoARS } from '@/utils/money'

/** '$0,00' con cualquier formato: un importe en cero. */
const esCero = (importe: string) => /^[^0-9]*0([.,]0+)?$/.test(importe.trim())

// Tarjetas de "Mi día" de un usuario de caja (2026-09-09): lo que vendió por
// forma de pago, lo que cobró en mostrador, lo que recibió de repartidores y el
// efectivo que tiene en su caja. Las usan la ventanilla (resumen) y el cierre
// de caja (con el input de efectivo contado al lado).
export function TilesMostrador({ calc, compacto = false }: { calc: MostradorCalculado; compacto?: boolean }) {
  const v = calc.ventas, c = calc.cobranzas
  const Tile = ({ color, titulo, total, lineas }: { color: string; titulo: string; total: number; lineas: Array<[string, string]> }) => (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5" style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
      {/* Al abrir la caja está todo en cero: un cero pierde el peso y queda en
          gris secundario, así se distingue de un vistazo lo que ya se movió.
          Ver convenciones de diseño en CLAUDE.md. */}
      <p className={`text-xl font-bold tabular-nums ${total === 0 ? 'text-secundario' : 'text-gray-900'}`}>{formatoARS(total)}</p>
      {!compacto && (
        <div className="text-xs text-secundario space-y-0.5">
          {lineas.map(([k, val]) => <p key={k} className="flex justify-between gap-2"><span>{k}</span><b className={`tabular-nums ${esCero(val) ? 'text-secundario' : 'text-gray-900'}`}>{val}</b></p>)}
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
          <p className="text-xs text-secundario">{calc.ventas.cantidad} ventas · {calc.cobranzas.cantidad} cobranzas · {calc.recibido.liquidaciones.length} liquidaciones recibidas{calc.anuladas > 0 ? <span className="text-red-600"> · {calc.anuladas} anulada(s)</span> : null}{calc.anulacionesPendientes > 0 ? <span className="text-amber-700"> · {calc.anulacionesPendientes} anulación(es) esperando autorización</span> : null}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-secundario font-semibold">Efectivo en mi caja</p>
            <p className={`text-2xl font-bold tabular-nums ${calc.efectivoARendir === 0 ? 'text-secundario' : 'text-gray-900'}`}>{formatoARS(calc.efectivoARendir)}</p>
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
