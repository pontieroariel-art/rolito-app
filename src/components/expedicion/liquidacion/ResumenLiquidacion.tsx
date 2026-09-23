import { AlertTriangle, CheckCircle2, PackageX, Truck } from 'lucide-react'
import { formatoARS } from '@/utils/money'
import { describirRacks } from '@/utils/envases'
import type { LiquidacionCalculada, RepartoClasificado } from '@/utils/liquidacion'
import type { ConteoBilletes, DescargaCamion, Liquidacion, RemitoCarga } from '@/types'
import { MOTIVOS_DESVIO_DESCARGA } from '@/types'
import TablaConteoBilletes, { ChipEmpresa, COLOR_EMPRESA } from '@/components/common/TablaConteoBilletes'
import { NOMBRE_EMPRESA } from '@/utils/inhabilitadoTango'
import { conteoCompleto, desgloseContado, EMPRESAS_CONTEO, totalConteo } from '@/utils/billetes'
import { textoFaltante, type FaltanteCalculado } from '@/utils/faltantes'
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
          {cerrada.desvio.autorizadoPor ? 'Faltante autorizado' : 'Desvío observado'}: faltan {textoFaltante(cerrada.desvio.productos, cerrada.desvio.bolsasFaltantes)} · {MOTIVOS_DESVIO_DESCARGA[cerrada.desvio.motivo]}
        </span>
      )}
      {/* Sin descarga contada no hay control que mostrar: el camión sigue en la
          calle o muelle no contó. Chip neutro, no rojo (2026-09-14). */}
      {!cerrada && faltante?.sinDescarga && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700"
          title="El control de mercadería se hace cuando muelle cuenta la descarga">
          <Truck size={12} /> Sin conteo del muelle todavía
        </span>
      )}
      {/* En vivo, antes de cerrar. Un faltante por debajo del umbral también se
          muestra (en ámbar): es información, no una alarma. */}
      {!cerrada && faltante && faltante.bolsasFaltantes > 0 && (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${faltante.grave ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}
          title={faltante.productos.map((p) => `${p.nombre} −${p.faltan}`).join(' · ')}>
          <PackageX size={12} /> Faltan {textoFaltante(faltante.productos, faltante.bolsasFaltantes)}
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

// Rendición por sobres, etapa 1 (2026-09-16): la plata se rinde POR EMPRESA
// (Redonhielo = oficial, Rolito = no oficial) y caja la cuenta billete por
// billete en la tabla de cada empresa; el "efectivo recibido" ya no se escribe.
// Con la liquidación cerrada se muestra el conteo guardado (los cierres
// anteriores no lo tienen: solo el total).
export function TarjetasPlata({ calc, conteo, onConteo, soloLectura, efectivoRecibidoCerrado }: {
  reparto: RepartoClasificado; calc: LiquidacionCalculada
  /** El conteo en curso (o el guardado, en una cerrada). undefined en una cerrada vieja sin conteo. */
  conteo?: ConteoBilletes
  onConteo?: (c: ConteoBilletes) => void
  soloLectura: boolean
  /** En una cerrada sin conteo guardado: el total que se escribió en su momento. */
  efectivoRecibidoCerrado?: number
}) {
  const completo = conteo ? conteoCompleto(conteo) : false
  const recibido = conteo ? (completo || soloLectura ? totalConteo(conteo) : null) : (efectivoRecibidoCerrado ?? null)
  const diferencia = recibido === null ? null : recibido - calc.efectivoARendir
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-4">
      {/* Dos columnas por empresa con la misma denominación (2026-09-16, pedido
          de Ariel): arriba el contado (lo cobrado en el momento, con factura o
          factura X), abajo las cobranzas (recibos de cuenta corriente, con sus
          cheques y retenciones). La cuenta corriente no tiene tarjeta: el
          remito de Redonhielo no se factura y la factura X de Rolito en cuenta
          corriente entra el día que el cliente la paga con un recibo. */}
      <div className="grid md:grid-cols-2 gap-3">
        {EMPRESAS_CONTEO.map((e) => {
          const p = calc.porEmpresa[e]
          const color = e === 'redonhielo' ? '#1D6FA8' : '#8A4FBF'
          const contado = p.ventasContado ?? { cantidad: 0, total: 0 }
          return (
            <div key={e} className="grid sm:grid-cols-2 gap-3">
              <Tile color={color} titulo={`Contado · ${NOMBRE_EMPRESA[e]}`} total={contado.total} lineas={[
                ['Efectivo', formatoARS(p.ventasEfectivo ?? 0)],
                ['Transferencia', formatoARS(p.ventasTransferencia ?? 0)],
                [e === 'redonhielo' ? 'Facturas' : 'Facturas X', String(contado.cantidad)],
              ]} />
              <Tile color={color} titulo={`Cobranzas · ${NOMBRE_EMPRESA[e]}`} total={p.cobranzas.total} lineas={[
                ['Efectivo', formatoARS(p.cobranzasEfectivo ?? 0)],
                ['Transferencia', formatoARS(p.cobranzasTransferencia ?? 0)],
                [`Cheques (${p.cheques.cantidad})`, p.cheques.cantidad ? formatoARS(p.cheques.total) : '—'],
                [`Retenciones (${p.retenciones.cantidad})`, p.retenciones.cantidad ? formatoARS(p.retenciones.total) : '—'],
              ]} />
            </div>
          )
        })}
      </div>

      <div className="pt-3 border-t border-[#E7E5DC]">
        <p className="text-xs font-semibold uppercase tracking-wide text-secundario mb-2">{soloLectura ? 'Rendido por empresa' : 'Contá el efectivo que te entrega, por empresa'}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {EMPRESAS_CONTEO.map((e) => {
            const p = calc.porEmpresa[e]
            const d = conteo?.[e]
            const difE = d && (completo || soloLectura) ? d.total - p.efectivo : null
            return (
              <div key={e} className="space-y-2">
                <div className={`rounded-xl border ${COLOR_EMPRESA[e].borde} border-opacity-60 bg-white p-3`}>
                  <div className="flex items-center justify-between gap-2">
                    <ChipEmpresa empresa={e} />
                    <span className="text-xs text-secundario">{p.ventas.cantidad} ventas · {p.cobranzas.cantidad} cobranzas</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <span className="text-secundario">Efectivo a rendir</span><b className="text-right tabular-nums text-gray-900">{formatoARS(p.efectivo)}</b>
                    <span className="text-secundario">Cheques ({p.cheques.cantidad})</span><span className="text-right tabular-nums">{p.cheques.cantidad ? formatoARS(p.cheques.total) : '—'}</span>
                    <span className="text-secundario">Retenciones ({p.retenciones.cantidad})</span><span className="text-right tabular-nums">{p.retenciones.cantidad ? formatoARS(p.retenciones.total) : '—'}</span>
                    <span className="text-secundario">Transferencias (no se rinden)</span><span className="text-right tabular-nums text-secundario">{p.transferencia ? formatoARS(p.transferencia) : '—'}</span>
                  </div>
                </div>
                {d ? (
                  <TablaConteoBilletes empresa={e} valor={d} soloLectura={soloLectura} onChange={onConteo ? (nuevo) => onConteo({ ...conteo!, [e]: nuevo }) : undefined} />
                ) : (
                  <p className="text-xs text-secundario px-1">Este cierre no tiene el conteo de billetes (es anterior al 16/09).</p>
                )}
                {difE !== null && (
                  <p className={`text-sm font-semibold tabular-nums px-1 ${difE === 0 ? 'text-[#0F6B4E]' : 'text-red-600'}`}>
                    {difE === 0 ? 'Cuadra ✓' : `Diferencia ${formatoARS(difE)}`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 items-end pt-3 border-t border-[#E7E5DC]">
        <div>
          <p className="text-xs text-secundario">Efectivo a rendir</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(calc.efectivoARendir)}</p>
          <p className="text-[11px] text-secundario">Redonhielo {formatoARS(calc.porEmpresa.redonhielo.efectivo)} + Rolito {formatoARS(calc.porEmpresa.rolito.efectivo)} (contado en efectivo + cobranzas en efectivo de cada empresa)</p>
        </div>
        <div>
          <p className="text-xs text-secundario">{soloLectura ? 'Efectivo recibido' : 'Contado en billetes'}</p>
          {recibido === null
            ? <p className="text-2xl font-bold text-secundario">—</p>
            : <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatoARS(recibido)}</p>}
          {!soloLectura && !completo && <p className="text-[11px] text-amber-700">Falta contar {conteo && !desgloseContado(conteo.redonhielo) ? 'Redonhielo' : ''}{conteo && !desgloseContado(conteo.redonhielo) && !desgloseContado(conteo.rolito) ? ' y ' : ''}{conteo && !desgloseContado(conteo.rolito) ? 'Rolito' : ''}.</p>}
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

export function DetallePorProducto({ calc, sinDescarga = false }: {
  calc: LiquidacionCalculada
  /**
   * Todavía no hay descarga contada (2026-09-14): las columnas que dependen
   * del conteo van con "—" en vez de un cero y una diferencia en rojo que, con
   * el camión en la calle, no significan nada.
   */
  sinDescarga?: boolean
}) {
  const dif = (n: number) => n === 0 ? <span className="text-secundario">0</span> : <span className="font-semibold text-red-600">{n > 0 ? `+${n}` : n}</span>
  const pendiente = <span className="text-secundario">—</span>
  const conFabrica = calc.productos.some((p) => (p.entregasFabrica ?? 0) > 0)
  return (
    <div className="space-y-4">
      {sinDescarga && (
        <p className="text-sm text-gray-700 bg-gray-50 border border-[#E7E5DC] rounded-lg px-3 py-2">
          Muelle todavía no contó la descarga: la diferencia por producto y los envases se completan cuando el camión vuelve.
        </p>
      )}
      <table className="w-full min-w-[640px]">
        {/* "Rem. fábrica" (Coto/Carrefour, 2026-09-23) solo cuando hubo: entregas sin venta de la app que igual bajaron del camión. */}
        <thead><tr>{['Producto', 'Carga', 'Contado', 'Promo', ...(conFabrica ? ['Rem. fábrica'] : []), 'Cambios', 'Dev. teórica', 'Descarga', 'Diferencia'].map((h, i) => <th key={h} className={`${th} ${i > 0 ? 'text-right' : ''}`} title={h === 'Rem. fábrica' ? 'Entregas con remito de fábrica: sin comprobante de la app, descuentan del camión' : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {calc.productos.map((p) => (
            <tr key={p.productoId}>
              <td className={td}>{p.nombre}</td>
              <td className={`${td} text-right`}>{num(p.carga)}</td>
              <td className={`${td} text-right`}>{num(p.ventaContado)}</td>
              <td className={`${td} text-right`}>{num(p.ventaPromo)}</td>
              {conFabrica && <td className={`${td} text-right`}>{num(p.entregasFabrica ?? 0)}</td>}
              <td className={`${td} text-right`}>{num(p.cambios)}</td>
              <td className={`${td} text-right`}>{num(p.devolucionTeorica)}</td>
              <td className={`${td} text-right`}>{sinDescarga ? pendiente : num(p.descarga)}</td>
              <td className={`${td} text-right`}>{sinDescarga ? pendiente : dif(p.diferencia)}</td>
            </tr>
          ))}
          {calc.productos.length === 0 && <tr><td className={`${td} text-secundario`} colSpan={conFabrica ? 9 : 8}>Sin movimientos.</td></tr>}
        </tbody>
      </table>
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-700 max-w-xl">
        <p className="flex justify-between"><span>Cambios registrados por el repartidor</span><b>{calc.cambios.registrados}</b></p>
        <p className="flex justify-between"><span>Rotas recibidas en muelle</span><b>{sinDescarga ? pendiente : calc.cambios.rotasRecibidas}</b></p>
        <p className="flex justify-between sm:col-start-2"><span>Diferencia de cambios</span>{sinDescarga ? pendiente : dif(calc.cambios.rotasRecibidas - calc.cambios.registrados)}</p>
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
              <td className={`${td} text-right`}>{sinDescarga ? pendiente : num(calc.envases.volvieron[k])}</td>
              <td className={`${td} text-right`}>{sinDescarga ? pendiente : dif(calc.envases.diferencia[k])}</td>
            </tr>
          ))}
          <tr>
            <td className={td}>Racks de agua</td>
            <td className={`${td} text-right`}>{num(calc.envases.salieron.racks.length)}</td>
            <td className={`${td} text-right`}>{sinDescarga ? pendiente : num(calc.envases.volvieron.racks.length)}</td>
            <td className={`${td} text-right`}>{sinDescarga ? pendiente : dif(calc.envases.volvieron.racks.length - calc.envases.salieron.racks.length)}</td>
          </tr>
        </tbody>
      </table>
      {!sinDescarga && calc.envases.racksFaltantes.length > 0 && (
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
