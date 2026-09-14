import { AlertTriangle, CheckCircle2, PackageX } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import { describirRacks } from '@/utils/envases'
import type { LiquidacionCalculada, RepartoClasificado } from '@/utils/liquidacion'
import type { DescargaCamion, Liquidacion, RemitoCarga } from '@/types'
import { MOTIVOS_DESVIO_DESCARGA } from '@/types'
import type { FaltanteCalculado } from '@/utils/faltantes'
import { TH as th, TD as td } from '@/components/common/tabla'

// Barra de estado, tarjetas de plata con el cuadre, y los plegables de resumen
// por cliente / por producto / envases de la liquidación detallada.

const hora = (ts: { toDate(): Date } | undefined) => ts ? ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

export function BarraEstado({ remitos, descargas, reparto, cerrada, onProblemas, soloProblemas, faltante }: {
  remitos: RemitoCarga[]; descargas: DescargaCamion[]; reparto: RepartoClasificado; cerrada: Liquidacion | null
  onProblemas: () => void; soloProblemas: boolean
  /**
   * Faltante de MERCADERÍA del día, en vivo (2026-09-13). Va acá, a la vista,
   * porque hasta hoy el desvío vivía dentro de un plegable cerrado: un camión
   * podía volver con 80 bolsas de menos y el cierre salía sin que nadie lo viera.
   */
  faltante?: FaltanteCalculado | null
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
      {/* Cerrada con desvío: queda visible para siempre en el cierre. */}
      {cerrada?.desvio && (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cerrada.desvio.autorizadoPor ? 'bg-amber-100 text-amber-800' : 'bg-red-600 text-white'}`}
          title={`${cerrada.desvio.productos.map((p) => `${p.nombre} −${p.faltan}`).join(' · ')}${cerrada.desvio.nota ? ` · ${cerrada.desvio.nota}` : ''} · cerró ${cerrada.desvio.observadoPor.nombre}${cerrada.desvio.autorizadoPor ? ` · autorizó ${cerrada.desvio.autorizadoPor.nombre}${cerrada.desvio.notaAutorizacion ? ` (${cerrada.desvio.notaAutorizacion})` : ''}` : ' · SIN autorización'}`}>
          <PackageX size={12} />
          {cerrada.desvio.autorizadoPor ? 'Faltante autorizado' : 'Desvío observado'}: faltan {cerrada.desvio.bolsasFaltantes} bolsas · {MOTIVOS_DESVIO_DESCARGA[cerrada.desvio.motivo]}
        </span>
      )}
      {/* En vivo, antes de cerrar. Un faltante por debajo del umbral también se
          muestra (en ámbar): es información, no una alarma. */}
      {!cerrada && faltante && faltante.bolsasFaltantes > 0 && (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${faltante.grave ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}
          title={faltante.productos.map((p) => `${p.nombre} −${p.faltan}`).join(' · ')}>
          <PackageX size={12} /> Faltan {faltante.bolsasFaltantes} bolsas
        </span>
      )}
      {reparto.problemas.length > 0 && (
        <button type="button" onClick={onProblemas}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${soloProblemas ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}>
          <AlertTriangle size={12} /> {reparto.problemas.length === 1 ? '1 venta con problema' : `${reparto.problemas.length} ventas con problema`}
        </button>
      )}
    </section>
  )
}

// A nivel módulo, no adentro de `TarjetasPlata`: definido adentro, React lo
// tomaba como un componente nuevo en cada render y desmontaba y volvía a montar
// las cuatro tarjetas con cada tecla del input "Efectivo recibido" (2026-09-14).
const Tile = ({ color, titulo, total, lineas }: { color: string; titulo: string; total: number; lineas: Array<[string, string]> }) => (
  <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5" style={{ borderTop: `4px solid ${color}` }}>
    <p className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
    <p className="text-xl font-bold text-gray-900 tabular-nums">{formatoARS(total)}</p>
    <div className="text-xs text-gray-600 space-y-0.5">
      {lineas.map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span>{k}</span><b className="text-gray-800 tabular-nums">{v}</b></p>)}
    </div>
  </div>
)

export function TarjetasPlata({ reparto, calc, efectivoRecibido, onEfectivoRecibido, soloLectura, diferencia }: {
  reparto: RepartoClasificado; calc: LiquidacionCalculada; efectivoRecibido: string; onEfectivoRecibido: (v: string) => void
  soloLectura: boolean; diferencia: number | null
}) {
  const promoEfectivo = reparto.promo.contado.ventas.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + v.total, 0)
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile color="#1D6FA8" titulo="Contado · Redonhielo" total={reparto.contado.total} lineas={[['Efectivo', formatoARS(reparto.contado.efectivo.total)], ['Transferencia', formatoARS(reparto.contado.transferencia.total)], ['Facturas', String(reparto.contado.efectivo.ventas.length + reparto.contado.transferencia.ventas.length)]]} />
        <Tile color="#1D6FA8" titulo="Cuenta corriente · Redonhielo" total={reparto.cuentaCorriente.total} lineas={[['Remitos', String(reparto.cuentaCorriente.ventas.length)], ['', 'no entra a rendición']]} />
        <Tile color="#8A4FBF" titulo="Promo · Rolito" total={reparto.promo.total} lineas={[['Contado efectivo', formatoARS(promoEfectivo)], ['Cuenta corriente', formatoARS(reparto.promo.cuentaCorriente.total)], ['Facturas X', String(reparto.promo.contado.ventas.length + reparto.promo.cuentaCorriente.ventas.length)]]} />
        <Tile color="#0F6B4E" titulo="Cobranzas" total={reparto.cobranzas.total} lineas={[['Efectivo', formatoARS(reparto.cobranzas.efectivo)], ['Transferencia', formatoARS(reparto.cobranzas.transferencia)], [`Cheques (${reparto.cobranzas.cheques.cantidad})`, formatoARS(reparto.cobranzas.cheques.total)], ...(reparto.cobranzas.retenciones.cantidad ? [[`Retenciones (${reparto.cobranzas.retenciones.cantidad})`, formatoARS(reparto.cobranzas.retenciones.total)] as [string, string]] : [])]} />
      </div>
      <div className="grid sm:grid-cols-[1fr_1.3fr_1fr] gap-4 items-end pt-3 border-t border-[#E7E5DC]">
        <div>
          <p className="text-xs text-secundario">Efectivo a rendir</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(calc.efectivoARendir)}</p>
          <p className="text-[11px] text-secundario">Contado efectivo {formatoARS(reparto.contado.efectivo.total)} + promo efectivo {formatoARS(promoEfectivo)} + cobranzas efectivo {formatoARS(reparto.cobranzas.efectivo)}</p>
        </div>
        <div>
          <p className="text-xs text-secundario mb-1">Efectivo recibido</p>
          {soloLectura ? (
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(Number(efectivoRecibido) || 0)}</p>
          ) : (
            <input value={efectivoRecibido} onChange={(e) => onEfectivoRecibido(e.target.value)} inputMode="numeric" placeholder="0"
              className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-lg text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent tabular-nums" />
          )}
        </div>
        <div>
          <p className="text-xs text-secundario">Diferencia</p>
          {diferencia === null ? <p className="text-2xl font-bold text-secundario">—</p> : (
            <p className={`text-2xl font-bold tabular-nums ${diferencia === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>{formatoARS(diferencia)}{diferencia === 0 ? ' ✓' : ''}</p>
          )}
        </div>
      </div>
    </section>
  )
}

// Plegable vive en components/ui/Plegable (lo comparte la ficha del supervisor).
export { Plegable } from '@/components/ui/Plegable'
const num = (n: number) => <span className="tabular-nums">{n}</span>

export function ResumenPorCliente({ reparto }: { reparto: RepartoClasificado }) {
  return (
    <table className="w-full min-w-[640px]">
      <thead><tr>{['Cliente', 'Código', 'Contado', 'Cta. cte.', 'Promo', 'Cobrado', 'Cambios', 'Comprobantes'].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {reparto.clientes.map((c) => (
          <tr key={c.clienteId}>
            <td className={td}>{c.nombre}</td>
            <td className={`${td} text-secundario`}>{c.codigoTango}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.contado)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.cuentaCorriente)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.promo)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatoARS(c.cobrado)}</td>
            <td className={`${td} text-right`}>{num(c.cambios)}</td>
            <td className={`${td} text-gray-600`}>{c.ventas} {c.ventas === 1 ? 'venta' : 'ventas'}{c.cobranzas ? ` · ${c.cobranzas} ${c.cobranzas === 1 ? 'recibo' : 'recibos'}` : ''}{c.problemas ? <span className="text-red-600 font-semibold"> · {c.problemas} con problema</span> : null}</td>
          </tr>
        ))}
        {reparto.clientes.length === 0 && <tr><td className={`${td} text-secundario`} colSpan={8}>Sin movimientos.</td></tr>}
      </tbody>
    </table>
  )
}

export function DetallePorProducto({ calc }: { calc: LiquidacionCalculada }) {
  const dif = (n: number) => n === 0 ? <span className="text-secundario">0</span> : <span className="font-semibold text-red-600">{n > 0 ? `+${n}` : n}</span>
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
          {calc.productos.length === 0 && <tr><td className={`${td} text-secundario`} colSpan={8}>Sin movimientos.</td></tr>}
        </tbody>
      </table>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-700 max-w-xl">
        <p className="flex justify-between"><span>Cambios registrados por el repartidor</span><b>{calc.cambios.registrados}</b></p>
        <p className="flex justify-between"><span>Rotas recibidas en muelle</span><b>{calc.cambios.rotasRecibidas}</b></p>
        <p className="flex justify-between sm:col-start-2"><span>Diferencia de cambios</span>{dif(calc.cambios.rotasRecibidas - calc.cambios.registrados)}</p>
      </div>
      {/* Envases retornables: lo que salió (remitos, puntales y aros
          implícitos) contra lo que muelle contó al descargar, y los racks por
          número. No bloquea el cierre: queda a la vista y en el PDF. */}
      <table className="w-full max-w-xl">
        <thead><tr>{['Envases', 'Salieron', 'Volvieron', 'Diferencia'].map((h, i) => <th key={h} className={`${th} ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>
          {([
            ['Pallets de madera', 'tarimasMadera'], ['Pallets de metal', 'palletsMetal'], ['Puntales', 'puntales'], ['Aros', 'aros'], ['Sombreros', 'sombreros'],
          ] as const).map(([nombre, k]) => (
            <tr key={k}>
              <td className={td}>{nombre}</td>
              <td className={`${td} text-right`}>{num(calc.envases.salieron[k])}</td>
              <td className={`${td} text-right`}>{num(calc.envases.volvieron[k])}</td>
              <td className={`${td} text-right`}>{dif(calc.envases.diferencia[k])}</td>
            </tr>
          ))}
          <tr>
            <td className={td}>Racks de agua</td>
            <td className={`${td} text-right`}>{num(calc.envases.salieron.racks.length)}</td>
            <td className={`${td} text-right`}>{num(calc.envases.volvieron.racks.length)}</td>
            <td className={`${td} text-right`}>{dif(calc.envases.volvieron.racks.length - calc.envases.salieron.racks.length)}</td>
          </tr>
        </tbody>
      </table>
      {calc.envases.racksFaltantes.length > 0 && (
        <p className="text-sm font-semibold text-red-600">Racks que no volvieron: {describirRacks(calc.envases.racksFaltantes)}</p>
      )}
      {calc.envases.racksSobrantes.length > 0 && (
        <p className="text-sm text-amber-700">Racks que volvieron sin haber salido en el remito: {describirRacks(calc.envases.racksSobrantes)}</p>
      )}
      {calc.envases.salieron.racks.length > 0 && calc.envases.racksFaltantes.length === 0 && (
        <p className="text-sm text-secundario">Todos los racks volvieron ({describirRacks(calc.envases.salieron.racks)}).</p>
      )}
    </div>
  )
}
