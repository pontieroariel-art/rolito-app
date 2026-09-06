import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import type { LiquidacionCalculada, RepartoClasificado } from '@/utils/liquidacion'
import type { DescargaCamion, Liquidacion, RemitoCarga } from '@/types'

// Barra de estado, tarjetas de plata con el cuadre, y los plegables de resumen
// por cliente / por producto / envases de la liquidación detallada.

const hora = (ts: { toDate(): Date } | undefined) => ts ? ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

export function BarraEstado({ remitos, descargas, reparto, cerrada, onProblemas, soloProblemas }: {
  remitos: RemitoCarga[]; descargas: DescargaCamion[]; reparto: RepartoClasificado; cerrada: Liquidacion | null
  onProblemas: () => void; soloProblemas: boolean
}) {
  const salida = remitos.map((r) => r.salida?.hora ?? r.entregadoPor?.hora).find(Boolean)
  const vuelta = descargas[descargas.length - 1]?.fecha
  const ventas = reparto.contado.efectivo.ventas.length + reparto.contado.transferencia.ventas.length + reparto.cuentaCorriente.ventas.length + reparto.promo.contado.ventas.length + reparto.promo.cuentaCorriente.ventas.length
  const cobranzas = reparto.cobranzas.redonhielo.length + reparto.cobranzas.rolito.length
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
      {cerrada ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700"><CheckCircle2 size={12} /> Cerrada · {cerrada.cerradaPor.nombre} {hora(cerrada.createdAt)}</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EF] px-2.5 py-0.5 text-xs font-semibold text-[#0F6B4E]"><span className="h-2 w-2 rounded-full bg-current" /> Abierta</span>
      )}
      <span>Salida <b className="text-gray-900">{salida ? hora(salida) : '—'}</b> · vuelta <b className="text-gray-900">{vuelta ? hora(vuelta) : '—'}</b></span>
      <span><b className="text-gray-900">{ventas}</b> ventas · <b className="text-gray-900">{reparto.clientes.length}</b> clientes · <b className="text-gray-900">{cobranzas}</b> cobranzas</span>
      {reparto.problemas.length > 0 && (
        <button type="button" onClick={onProblemas}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${soloProblemas ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}>
          <AlertTriangle size={12} /> {reparto.problemas.length === 1 ? '1 venta con problema' : `${reparto.problemas.length} ventas con problema`}
        </button>
      )}
    </section>
  )
}

export function TarjetasPlata({ reparto, calc, efectivoRecibido, onEfectivoRecibido, soloLectura, diferencia }: {
  reparto: RepartoClasificado; calc: LiquidacionCalculada; efectivoRecibido: string; onEfectivoRecibido: (v: string) => void
  soloLectura: boolean; diferencia: number | null
}) {
  const promoEfectivo = reparto.promo.contado.ventas.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + v.total, 0)
  const Tile = ({ color, titulo, total, lineas }: { color: string; titulo: string; total: number; lineas: Array<[string, string]> }) => (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5" style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{formatoARS(total)}</p>
      <div className="text-xs text-gray-600 space-y-0.5">
        {lineas.map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span>{k}</span><b className="text-gray-800 tabular-nums">{v}</b></p>)}
      </div>
    </div>
  )
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile color="#1D6FA8" titulo="Contado · Redonhielo" total={reparto.contado.total} lineas={[['Efectivo', formatoARS(reparto.contado.efectivo.total)], ['Transferencia', formatoARS(reparto.contado.transferencia.total)], ['Facturas', String(reparto.contado.efectivo.ventas.length + reparto.contado.transferencia.ventas.length)]]} />
        <Tile color="#1D6FA8" titulo="Cuenta corriente · Redonhielo" total={reparto.cuentaCorriente.total} lineas={[['Remitos', String(reparto.cuentaCorriente.ventas.length)], ['', 'no entra a rendición']]} />
        <Tile color="#8A4FBF" titulo="Promo · Rolito" total={reparto.promo.total} lineas={[['Contado efectivo', formatoARS(promoEfectivo)], ['Cuenta corriente', formatoARS(reparto.promo.cuentaCorriente.total)], ['Facturas X', String(reparto.promo.contado.ventas.length + reparto.promo.cuentaCorriente.ventas.length)]]} />
        <Tile color="#0F6B4E" titulo="Cobranzas" total={reparto.cobranzas.total} lineas={[['Efectivo', formatoARS(reparto.cobranzas.efectivo)], ['Transferencia', formatoARS(reparto.cobranzas.transferencia)], [`Cheques (${reparto.cobranzas.cheques.cantidad})`, formatoARS(reparto.cobranzas.cheques.total)], ...(reparto.cobranzas.retenciones.cantidad ? [[`Retenciones (${reparto.cobranzas.retenciones.cantidad})`, formatoARS(reparto.cobranzas.retenciones.total)] as [string, string]] : [])]} />
      </div>
      <div className="grid sm:grid-cols-[1fr_1.3fr_1fr] gap-4 items-end pt-3 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500">Efectivo a rendir</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(calc.efectivoARendir)}</p>
          <p className="text-[11px] text-gray-500">Contado efectivo {formatoARS(reparto.contado.efectivo.total)} + promo efectivo {formatoARS(promoEfectivo)} + cobranzas efectivo {formatoARS(reparto.cobranzas.efectivo)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Efectivo recibido</p>
          {soloLectura ? (
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(Number(efectivoRecibido) || 0)}</p>
          ) : (
            <input value={efectivoRecibido} onChange={(e) => onEfectivoRecibido(e.target.value)} inputMode="numeric" placeholder="0"
              className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-lg text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent tabular-nums" />
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500">Diferencia</p>
          {diferencia === null ? <p className="text-2xl font-bold text-gray-400">—</p> : (
            <p className={`text-2xl font-bold tabular-nums ${diferencia === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(diferencia)}{diferencia === 0 ? ' ✓' : ''}</p>
          )}
        </div>
      </div>
    </section>
  )
}

export function Plegable({ titulo, children, abiertoInicial = false }: { titulo: string; children: ReactNode; abiertoInicial?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="font-semibold text-gray-900">{titulo}</span>
        {abierto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {abierto && <div className="px-4 pb-4 overflow-x-auto">{children}</div>}
    </section>
  )
}

const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
const num = (n: number) => <span className="tabular-nums">{n}</span>

export function ResumenPorCliente({ reparto }: { reparto: RepartoClasificado }) {
  return (
    <table className="w-full min-w-[640px]">
      <thead><tr>{['Cliente', 'Código', 'Contado', 'Cta. cte.', 'Promo', 'Cobrado', 'Cambios', 'Comprobantes'].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {reparto.clientes.map((c) => (
          <tr key={c.clienteId}>
            <td className={td}>{c.nombre}</td>
            <td className={`${td} text-gray-500`}>{c.codigoTango}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.contado)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.cuentaCorriente)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.promo)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.cobrado)}</td>
            <td className={`${td} text-right`}>{num(c.cambios)}</td>
            <td className={`${td} text-gray-600`}>{c.ventas} {c.ventas === 1 ? 'venta' : 'ventas'}{c.cobranzas ? ` · ${c.cobranzas} ${c.cobranzas === 1 ? 'recibo' : 'recibos'}` : ''}{c.problemas ? <span className="text-red-600 font-semibold"> · {c.problemas} con problema</span> : null}</td>
          </tr>
        ))}
        {reparto.clientes.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={8}>Sin movimientos.</td></tr>}
      </tbody>
    </table>
  )
}

export function DetallePorProducto({ calc }: { calc: LiquidacionCalculada }) {
  const dif = (n: number) => n === 0 ? <span className="text-gray-500">0</span> : <span className="font-semibold text-red-600">{n > 0 ? `+${n}` : n}</span>
  return (
    <div className="space-y-4">
      <table className="w-full min-w-[640px]">
        <thead><tr>{['Producto', 'Carga', 'Contado', 'Promo', 'Cambios', 'Dev. teórica', 'Descarga', 'Diferencia'].map((h, i) => <th key={h} className={`${th} ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>
          {calc.productos.map((p) => (
            <tr key={p.productoId}>
              <td className={td}>{p.nombre}</td>
              <td className={`${td} text-right`}>{num(p.carga)}</td>
              <td className={`${td} text-right`}>{num(p.ventaContado)}</td>
              <td className={`${td} text-right`}>{num(p.ventaPromo)}</td>
              <td className={`${td} text-right`}>{num(p.cambios)}</td>
              <td className={`${td} text-right`}>{num(p.devolucionTeorica)}</td>
              <td className={`${td} text-right`}>{num(p.descarga)}</td>
              <td className={`${td} text-right`}>{dif(p.diferencia)}</td>
            </tr>
          ))}
          {calc.productos.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={8}>Sin movimientos.</td></tr>}
        </tbody>
      </table>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-700 max-w-xl">
        <p className="flex justify-between"><span>Pallets que salieron</span><b>{calc.pallets.salidos}</b></p>
        <p className="flex justify-between"><span>Cambios registrados por el repartidor</span><b>{calc.cambios.registrados}</b></p>
        <p className="flex justify-between"><span>Volvieron completos</span><b>{calc.pallets.completos}</b></p>
        <p className="flex justify-between"><span>Rotas recibidas en muelle</span><b>{calc.cambios.rotasRecibidas}</b></p>
        <p className="flex justify-between"><span>Volvieron parciales</span><b>{calc.pallets.parciales}</b></p>
        <p className="flex justify-between"><span>Diferencia de cambios</span>{dif(calc.cambios.rotasRecibidas - calc.cambios.registrados)}</p>
        <p className="flex justify-between"><span>Volvieron vacíos</span><b>{calc.pallets.vacios}</b></p>
        <p className="flex justify-between"><span>Diferencia de pallets</span>{dif(calc.pallets.diferencia)}</p>
      </div>
    </div>
  )
}
