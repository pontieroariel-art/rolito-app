import { Fragment, useState } from 'react'
import { PackageCheck, ShoppingCart, Ticket } from 'lucide-react'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useLiveDelDia } from '@/hooks/useLiveDelDia'
import { sinDevolver, type FilaCalle, type FilaVentanilla, type ProductoLive } from '@/utils/tesoreriaLive'
import { formatoARS } from '@/utils/money'
import { Plegable } from '@/components/ui/Plegable'
import StatusStrip from '@/components/common/StatusStrip'
import VentasDeCajero from '@/components/tesoreria/VentasDeCajero'
import { BadgeCaja, BadgeCalle, BarraProducto, BotonDetalle, CantidadPartida, CeldasEmpresas, CuadroEmpresas, EncabezadoLive, PasosCamiones, TarjetasEmpresa, ThEmpresas, num, sumaEmpresas } from '@/components/tesoreria/live'
import { PLANTAS, type PlantaId } from '@/types'
import { TH, TD } from '@/components/common/tabla'

// VENTAS en vivo (2026-09-16, pedido de Ariel): la MERCADERÍA del día para
// mirar en el momento, también por directores. Todo va partido en Redonhielo,
// Rolito y Total, en el mismo orden en todos lados: qué se vendió en la calle
// y en las ventanillas, producto por producto qué salió, qué se vendió y qué
// volvió, y los turnos del mostrador. La plata se mira en Tesorería en vivo.
export default function VentasLivePage() {
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const { resumen: r, ultimoCambio } = useLiveDelDia(dia)
  const t = r.totales
  const calle = t.ventasCalle, vent = t.ventasVentanilla
  const lineas = (c: typeof calle.contado, v: typeof vent.contado): Array<[string, string]> => [
    ['En la calle', c.cantidad ? `${formatoARS(c.total)} (${c.cantidad})` : '—'],
    ['En ventanilla', v.cantidad ? `${formatoARS(v.total)} (${v.cantidad})` : '—'],
    ['Cobrado en el momento', formatoARS(c.efectivo + c.transferencia + v.efectivo + v.transferencia)],
    ['A cuenta corriente', formatoARS(c.cuentaCorriente + v.cuentaCorriente)],
  ]
  const suma = (a: typeof calle.contado, b: typeof calle.contado) => ({ cantidad: a.cantidad + b.cantidad, efectivo: a.efectivo + b.efectivo, transferencia: a.transferencia + b.transferencia, cuentaCorriente: a.cuentaCorriente + b.cuentaCorriente, total: a.total + b.total })

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-5 pb-10">
      <EncabezadoLive icono={<ShoppingCart size={22} className="text-accent" />} titulo="Ventas · en vivo" bajada="Lo que se vendió hoy, en la calle y en las ventanillas, y qué mercadería salió y volvió." dia={dia} hoy={hoy} onDia={setDia} ultimoCambio={ultimoCambio} />

      <TarjetasEmpresa etiqueta="Ventas del día"
        redonhielo={{ importe: calle.contado.total + vent.contado.total, cantidad: calle.contado.cantidad + vent.contado.cantidad, lineas: lineas(calle.contado, vent.contado) }}
        rolito={{ importe: calle.promo.total + vent.promo.total, cantidad: calle.promo.cantidad + vent.promo.cantidad, lineas: lineas(calle.promo, vent.promo) }}
        total={{ importe: calle.contado.total + vent.contado.total + calle.promo.total + vent.promo.total, cantidad: calle.contado.cantidad + vent.contado.cantidad + calle.promo.cantidad + vent.promo.cantidad, lineas: lineas(suma(calle.contado, calle.promo), suma(vent.contado, vent.promo)) }}
      />

      <Plegable titulo="Mercadería del día · por producto" abiertoInicial extra={<span className="text-xs text-secundario">{t.productos.length} productos</span>}>
        <TablaProductos productos={t.productos} conVentanilla />
      </Plegable>

      <PasosCamiones filas={r.calle} />

      <StatusStrip titulo="Turnos de ventanilla" segmentos={[
        { id: 'turnos',     etiqueta: 'Vendidos',          valor: t.turnos.vendidos,   icono: <Ticket size={14} />,       tono: 'confirmado' },
        { id: 'entregados', etiqueta: 'Entregados',        valor: t.turnos.entregados, icono: <PackageCheck size={14} />, tono: 'entregado' },
        { id: 'cola',       etiqueta: 'En cola de muelle', valor: t.turnos.enCola,     icono: <Ticket size={14} />,       tono: 'pendiente', alerta: true },
      ]} />

      <Plegable titulo={`Calle · ${r.calle.length} repartidores`} abiertoInicial>
        <TablaCalle filas={r.calle} />
      </Plegable>

      {(Object.keys(PLANTAS) as PlantaId[]).map((p) => (
        <Plegable key={p} titulo={`Ventanilla ${PLANTAS[p].label.replace('Planta ', '')} · ${r.ventanilla[p].length} cajeros`} abiertoInicial>
          <TablaVentanilla filas={r.ventanilla[p]} />
        </Plegable>
      ))}
    </main>
  )
}

const FILA = `${TD} py-3`

/**
 * Producto por producto. La barra dice de un vistazo cuánto de lo cargado ya
 * se vendió (azul Redonhielo, violeta Rolito) y cuánto volvió (gris). Lo
 * vendido va partido por empresa bajo el total. "Sin devolver" = cargado −
 * vendido en la calle − lo que volvió: con el camión en la calle es lo que
 * lleva arriba; una vez contado por muelle, si queda algo, falta (rojo) o
 * sobra (ámbar).
 */
function TablaProductos({ productos, conVentanilla, contado }: { productos: ProductoLive[]; conVentanilla?: boolean; contado?: boolean }) {
  const cols = ['Producto', 'Avance', 'Cargado', 'Vendido calle', ...(conVentanilla ? ['Vendido ventanilla', 'Vendido total'] : []), 'Volvió', 'Sin devolver']
  return (
    <table className="w-full min-w-[820px]">
      <thead><tr>{cols.map((h, i) => <th key={h} className={`${TH} ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {productos.map((p) => {
          const resto = sinDevolver(p)
          const clase = resto === 0 ? 'text-secundario' : contado ? (resto < 0 ? 'text-red-700 font-semibold' : 'text-[#8A5203] font-semibold') : 'text-gray-900'
          const vendidoTotal = sumaEmpresas(p.vendidoCalle.redonhielo + p.vendidoVentanilla.redonhielo, p.vendidoCalle.rolito + p.vendidoVentanilla.rolito)
          return (
            <tr key={p.productoId}>
              <td className={`${FILA} font-semibold text-gray-900 truncate max-w-[260px]`} title={p.nombre}>{p.nombre}</td>
              <td className={FILA}><BarraProducto cargado={p.cargado} vendido={p.vendidoCalle} descargado={p.descargado} /></td>
              <td className={`${FILA} text-right tabular-nums`}>{num(p.cargado)}</td>
              <td className={`${FILA} text-right`}><CantidadPartida v={p.vendidoCalle} /></td>
              {conVentanilla && <td className={`${FILA} text-right`}><CantidadPartida v={p.vendidoVentanilla} /></td>}
              {conVentanilla && <td className={`${FILA} text-right`}><CantidadPartida v={vendidoTotal} /></td>}
              <td className={`${FILA} text-right tabular-nums`}>{num(p.descargado)}</td>
              <td className={`${FILA} text-right tabular-nums ${clase}`} title={contado ? (resto < 0 ? 'Falta contra lo cargado' : resto > 0 ? 'Sobra contra lo cargado' : 'Cuadra') : 'Sigue en el camión'}>{p.cargado ? num(resto) : '—'}</td>
            </tr>
          )
        })}
        {productos.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={cols.length}>Sin movimientos de mercadería.</td></tr>}
      </tbody>
    </table>
  )
}

function TablaCalle({ filas }: { filas: FilaCalle[] }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  return (
    <table className="w-full min-w-[860px]">
      <thead><tr>
        <th className={TH}>Repartidor</th>
        <ThEmpresas />
        <th className={`${TH} text-right`}>Volvió</th>
        <th className={TH}>Estado</th>
        <th className={TH}></th>
      </tr></thead>
      <tbody>
        {filas.map((f) => {
          const expandido = abierto === f.choferId
          return (
            <Fragment key={f.choferId}>
              <tr className="hover:bg-[#FCFBF8]">
                <td className={`${FILA} font-semibold text-gray-900`}>{f.deposito ? <span className="font-normal text-secundario mr-1.5">{f.deposito}</span> : null}{f.nombre || f.choferId}</td>
                <CeldasEmpresas valores={sumaEmpresas(f.contado.total, f.promo.total)} cantidades={sumaEmpresas(f.contado.cantidad, f.promo.cantidad)} />
                <td className={`${FILA} text-right text-secundario`}>{f.descargas ? 'contado por muelle' : f.volvio ? 'en planta' : '—'}</td>
                <td className={FILA}><BadgeCalle estado={f.estado} /></td>
                <td className={`${FILA} text-right`}><BotonDetalle abierto={expandido} onClick={() => setAbierto(expandido ? null : f.choferId)} /></td>
              </tr>
              {expandido && (
                <tr>
                  <td colSpan={7} className="bg-[#F8F7F2] px-3 py-3 border-b border-[#E7E5DC] space-y-3">
                    <CuadroEmpresas compacto titulo="Cómo vendió" filas={[
                      { etiqueta: 'Cobrado en el momento', nota: 'efectivo y transferencia', valores: sumaEmpresas(f.contado.efectivo + f.contado.transferencia, f.promo.efectivo + f.promo.transferencia) },
                      { etiqueta: 'A cuenta corriente', valores: sumaEmpresas(f.contado.cuentaCorriente, f.promo.cuentaCorriente) },
                      { etiqueta: 'Total', destacada: true, valores: sumaEmpresas(f.contado.total, f.promo.total), cantidades: sumaEmpresas(f.contado.cantidad, f.promo.cantidad) },
                    ]} />
                    <div className="bg-white rounded-xl border border-[#E7E5DC] overflow-x-auto">
                      <TablaProductos productos={f.productos} contado={f.descargas > 0} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {filas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={7}>Sin movimientos en la calle.</td></tr>}
      </tbody>
    </table>
  )
}

// Cada cajero se expande con sus ventas una por una (2026-09-14): qué llevó
// cada cliente, el ticket y el comprobante.
function TablaVentanilla({ filas }: { filas: FilaVentanilla[] }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  return (
    <table className="w-full min-w-[960px]">
      <thead><tr>
        <th className={TH}>Cajero</th>
        <th className={`${TH} text-right`}>Turnos</th>
        <th className={`${TH} text-right`}>Entregados</th>
        <th className={`${TH} text-right`}>En cola</th>
        <ThEmpresas />
        <th className={TH}>Estado</th>
        <th className={TH}></th>
      </tr></thead>
      <tbody>
        {filas.map((f) => {
          const expandido = abierto === f.cajaId
          return (
            <Fragment key={f.cajaId}>
              <tr className="hover:bg-[#FCFBF8]">
                <td className={`${FILA} font-semibold text-gray-900`}>{f.nombre}</td>
                <td className={`${FILA} text-right tabular-nums`}>{f.turnos.vendidos || '—'}</td>
                <td className={`${FILA} text-right tabular-nums`}>{f.turnos.entregados || '—'}</td>
                <td className={`${FILA} text-right tabular-nums ${f.turnos.enCola ? 'text-[#8A5203] font-semibold' : ''}`}>{f.turnos.enCola || '—'}</td>
                <CeldasEmpresas valores={sumaEmpresas(f.contado.total, f.promo.total)} cantidades={sumaEmpresas(f.contado.cantidad, f.promo.cantidad)} />
                <td className={FILA}><BadgeCaja estado={f.estado} /></td>
                <td className={`${FILA} text-right`}><BotonDetalle abierto={expandido} onClick={() => setAbierto(expandido ? null : f.cajaId)} etiqueta={`Ventas (${f.ventas.length})`} /></td>
              </tr>
              {expandido && (
                <tr>
                  <td colSpan={9} className="bg-[#F8F7F2] px-3 py-3 border-b border-[#E7E5DC]">
                    <VentasDeCajero fila={f} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {filas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={9}>Sin ventas de mostrador.</td></tr>}
      </tbody>
    </table>
  )
}
