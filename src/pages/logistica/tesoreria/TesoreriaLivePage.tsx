import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import { useDiaActual } from '@/hooks/useDiaActual'
import { subscribeVentasCamionDelDia } from '@/services/ventaCamionService'
import { subscribeVentanillaDelDia } from '@/services/ventaVentanillaService'
import { subscribeCobranzasDelDia } from '@/services/cobranzaService'
import { subscribeRemitosCargaDelDia } from '@/services/remitoCargaService'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { subscribeRendicionesEnRango } from '@/services/rendicionService'
import { custodiaTotal, useCustodiaTesoreria } from '@/hooks/useCustodiaTesoreria'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { resumenLive, type FilaCalle, type FilaVentanilla, type PlataCobranzas, type PlataVentas } from '@/utils/tesoreriaLive'
import { Plegable } from '@/components/ui/Plegable'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import VentasDeCajero from '@/components/tesoreria/VentasDeCajero'
import { PLANTAS, type Cobranza, type Liquidacion, type PlantaId, type RemitoCarga, type Rendicion, type VentaCamion, type VentaVentanilla } from '@/types'
import { TH, TD } from '@/components/common/tabla'

// Tablero en vivo de tesorería (2026-09-09): lo que se está vendiendo en la
// calle y en las ventanillas de Torcuato y Merlo, lo que cobran choferes y
// supervisores, y el estado de liquidaciones y cierres de caja. Todo por
// onSnapshot sobre los docs del día (un rango por colección, sin índices nuevos).
export default function TesoreriaLivePage() {
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const [ventasCamion, setVentasCamion] = useState<VentaCamion[]>([])
  const [vvT, setVvT] = useState<VentaVentanilla[]>([])
  const [vvM, setVvM] = useState<VentaVentanilla[]>([])
  const [cobranzas, setCobranzas] = useState<Cobranza[]>([])
  const [remT, setRemT] = useState<RemitoCarga[]>([])
  const [remM, setRemM] = useState<RemitoCarga[]>([])
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [ultimoCambio, setUltimoCambio] = useState<Date | null>(null)
  // Supervisor expandido en el bloque de abajo: sus recibos uno por uno (2026-09-09).
  const [supAbierto, setSupAbierto] = useState<string | null>(null)

  useEffect(() => {
    const fecha = new Date(`${dia}T12:00:00`)
    const manana = addDaysStr(dia, 1)
    const tick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setUltimoCambio(new Date()) }
    const offs = [
      subscribeVentasCamionDelDia(fecha, tick(setVentasCamion)),
      subscribeVentanillaDelDia('torcuato', fecha, tick(setVvT)),
      subscribeVentanillaDelDia('merlo', fecha, tick(setVvM)),
      subscribeCobranzasDelDia(fecha, tick(setCobranzas)),
      subscribeRemitosCargaDelDia('torcuato', fecha, tick(setRemT)),
      subscribeRemitosCargaDelDia('merlo', fecha, tick(setRemM)),
      subscribeLiquidacionesEnRango(dia, manana, tick(setLiquidaciones)),
      subscribeRendicionesEnRango(dia, manana, tick(setRendiciones)),
    ]
    return () => offs.forEach((off) => off())
  }, [dia])

  const r = useMemo(
    () => resumenLive({ ventasCamion, ventasVentanilla: [...vvT, ...vvM], cobranzas, remitos: [...remT, ...remM], liquidaciones, rendiciones }),
    [ventasCamion, vvT, vvM, cobranzas, remT, remM, liquidaciones, rendiciones],
  )
  const t = r.totales
  // Custodia de los sobres de ventanilla (rendición de fondos, 2026-09-14):
  // tiene que llegar / en camino / recibido / falta, las dos plantas sumadas.
  const custodia = useCustodiaTesoreria(dia)
  const cus = useMemo(() => custodiaTotal(custodia.porPlanta, 'todas'), [custodia.porPlanta])
  const inputClass = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Activity size={22} className="text-accent" /> Tesorería · en vivo</h1>
          <p className="text-secundario text-sm">Calle, ventanillas y supervisores del día, a medida que venden y cobran.</p>
        </div>
        <div className="flex items-center gap-3">
          {ultimoCambio && dia === hoy && <span className="inline-flex items-center gap-1.5 text-xs text-[#0F6B4E]"><span className="w-2 h-2 rounded-full bg-[#1D9E75] animate-pulse" /> en vivo · {ultimoCambio.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          <input type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} className={inputClass} />
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile color="#1D6FA8" titulo="Ventas calle" total={t.ventasCalle.contado.total + t.ventasCalle.promo.total} lineas={[['Contado efectivo', formatoARS(t.ventasCalle.contado.efectivo)], ['Promo efectivo', formatoARS(t.ventasCalle.promo.efectivo)], ['Cta. cte.', formatoARS(t.ventasCalle.contado.cuentaCorriente + t.ventasCalle.promo.cuentaCorriente)], ['Ventas', String(t.ventasCalle.contado.cantidad + t.ventasCalle.promo.cantidad)]]} />
        <Tile color="#1D6FA8" titulo="Ventas ventanilla" total={t.ventasVentanilla.contado.total + t.ventasVentanilla.promo.total} lineas={[['Contado efectivo', formatoARS(t.ventasVentanilla.contado.efectivo)], ['Promo efectivo', formatoARS(t.ventasVentanilla.promo.efectivo)], ['Cta. cte.', formatoARS(t.ventasVentanilla.contado.cuentaCorriente + t.ventasVentanilla.promo.cuentaCorriente)], ['Ventas', String(t.ventasVentanilla.contado.cantidad + t.ventasVentanilla.promo.cantidad)]]} />
        <Tile color="#0F6B4E" titulo="Cobranzas calle" total={t.cobranzas.calle.total} lineas={lineasCob(t.cobranzas.calle)} />
        <Tile color="#0F6B4E" titulo="Cobranzas supervisores" total={t.cobranzas.supervisores.total} lineas={lineasCob(t.cobranzas.supervisores)} />
        <Tile color="#B4531A" titulo="Efectivo del día" total={t.efectivoDelDia} lineas={[['Ventas + cobranzas', 'todos los puntos'], ['Cobranzas mostrador', formatoARS(t.cobranzas.ventanilla.efectivo)]]} />
        <Tile color="#6B21A8" titulo="Tiene que llegar" total={cus.totales.tieneQueLlegar} lineas={[[`En camino (${cus.enCamino.length})`, formatoARS(cus.totales.enCamino)], ['Recibido hoy', formatoARS(cus.totales.recibidoHoy)], ['Falta', formatoARS(cus.totales.falta)], ['Cajas abiertas', String(cus.cajasAbiertas.length)]]} to="/tesoreria/recepcion" linkTexto="Ver recepción" />
      </section>

      <Plegable titulo={`Calle · ${r.calle.length} camiones`} abiertoInicial extra={<span className="text-xs text-secundario">{r.calle.filter((f) => f.estado === 'liquidado').length} liquidados</span>}>
        <TablaCalle filas={r.calle} dia={dia} />
      </Plegable>

      {(Object.keys(PLANTAS) as PlantaId[]).map((p) => (
        <Plegable key={p} titulo={`Ventanilla ${PLANTAS[p].label.replace('Planta ', '')} · ${r.ventanilla[p].length} cajeros`} abiertoInicial>
          <TablaVentanilla filas={r.ventanilla[p]} />
        </Plegable>
      ))}

      <Plegable titulo={`Supervisores · ${r.supervisores.length} cobrando`} abiertoInicial>
        <table className="w-full min-w-[640px]">
          <thead><tr>{['Supervisor', 'Recibos', 'Efectivo', 'Transferencia', 'Cheques', 'Retenciones', 'Total'].map((h, i) => <th key={h} className={`${TH} ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {r.supervisores.map((s) => {
              const abierto = supAbierto === s.uid
              const recibos = abierto ? cobranzas.filter((c) => c.origen === 'supervisor' && c.registradoPor.uid === s.uid).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()) : []
              return (
                <Fragment key={s.uid}>
                  <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setSupAbierto(abierto ? null : s.uid)}>
                    <td className={TD}><span className="inline-flex items-center gap-1.5">{abierto ? <ChevronDown size={14} className="text-inerte" /> : <ChevronRight size={14} className="text-inerte" />}{s.nombre}</span></td>
                    <td className={`${TD} text-right tabular-nums`}>{s.cobranzas.cantidad}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatoARS(s.cobranzas.efectivo)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatoARS(s.cobranzas.transferencia)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{s.cobranzas.cheques.cantidad ? `${s.cobranzas.cheques.cantidad} · ${formatoARS(s.cobranzas.cheques.total)}` : '—'}</td>
                    <td className={`${TD} text-right tabular-nums`}>{s.cobranzas.retenciones.cantidad ? `${s.cobranzas.retenciones.cantidad} · ${formatoARS(s.cobranzas.retenciones.total)}` : '—'}</td>
                    <td className={`${TD} text-right tabular-nums font-semibold`}>{formatoARS(s.cobranzas.total)}</td>
                  </tr>
                  {abierto && (
                    <tr>
                      <td colSpan={7} className="bg-[#F8F7F2] px-3 py-3 border-b border-[#E7E5DC]">
                        <p className="text-xs text-secundario mb-2">Recibos de {s.nombre} en el día. Cada uno se abre con su detalle y su PDF.</p>
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {recibos.map((c) => <CobranzaSupervisorCard key={c.id} c={c} />)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {r.supervisores.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={7}>Sin cobranzas de supervisores.</td></tr>}
          </tbody>
        </table>
      </Plegable>
    </main>
  )
}


const lineasCob = (c: PlataCobranzas): Array<[string, string]> => [['Efectivo', formatoARS(c.efectivo)], ['Transferencia', formatoARS(c.transferencia)], [`Cheques (${c.cheques.cantidad})`, formatoARS(c.cheques.total)], [`Retenciones (${c.retenciones.cantidad})`, formatoARS(c.retenciones.total)]]

function Tile({ color, titulo, total, lineas, to, linkTexto = 'Ver más' }: { color: string; titulo: string; total: number; lineas: Array<[string, string]>; to?: string; linkTexto?: string }) {
  return (
    <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 space-y-1.5" style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{titulo}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{formatoARS(total)}</p>
      <div className="text-xs text-gray-600 space-y-0.5">
        {lineas.map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span>{k}</span><b className="text-gray-800 tabular-nums">{v}</b></p>)}
      </div>
      {to && <Link to={to} className="block text-xs text-accent underline underline-offset-2">{linkTexto}</Link>}
    </div>
  )
}

const ESTADO_CALLE: Record<FilaCalle['estado'], { texto: string; clase: string }> = {
  sin_carga: { texto: 'Sin carga', clase: 'bg-gray-100 text-gray-600 border-gray-200' },
  cargado:   { texto: 'Cargado', clase: 'bg-blue-50 text-blue-700 border-blue-200' },
  vendiendo: { texto: 'Vendiendo', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  liquidado: { texto: 'Liquidado', clase: 'bg-green-100 text-green-700 border-green-200' },
}
const ESTADO_CAJA: Record<FilaVentanilla['estado'], { texto: string; clase: string }> = {
  abierta:  { texto: 'Caja abierta', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  cerrada:  { texto: 'Cerrada · sin validar', clase: 'bg-blue-50 text-blue-700 border-blue-200' },
  validada: { texto: 'Validada', clase: 'bg-green-100 text-green-700 border-green-200' },
}
const ventasTxt = (p: PlataVentas) => `${p.cantidad} · ${formatoARS(p.total)}`

function TablaCalle({ filas, dia }: { filas: FilaCalle[]; dia: string }) {
  return (
    <table className="w-full min-w-[860px]">
      <thead><tr>{['Chofer', 'Carga', 'Contado', 'Promo', 'Bultos vend.', 'Cobranzas', 'Efectivo', 'Liquidación', 'Estado'].map((h, i) => <th key={h} className={`${TH} ${i > 0 && i < 8 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {filas.map((f) => {
          const efectivo = f.contado.efectivo + f.promo.efectivo + f.cobranzas.efectivo
          const e = ESTADO_CALLE[f.estado]
          return (
            <tr key={f.choferId}>
              <td className={TD}>{f.deposito ? <span className="text-secundario mr-1.5">{f.deposito}</span> : null}{f.nombre || f.choferId}</td>
              <td className={`${TD} text-right tabular-nums`}>{f.remitos ? `${f.remitos} rem · ${f.cargaBultos} b.` : '—'}</td>
              <td className={`${TD} text-right tabular-nums`}>{ventasTxt(f.contado)}</td>
              <td className={`${TD} text-right tabular-nums`}>{ventasTxt(f.promo)}</td>
              <td className={`${TD} text-right tabular-nums`}>{f.bultosVendidos}</td>
              <td className={`${TD} text-right tabular-nums`}>{f.cobranzas.cantidad ? `${f.cobranzas.cantidad} · ${formatoARS(f.cobranzas.total)}` : '—'}</td>
              <td className={`${TD} text-right tabular-nums font-semibold`}>{formatoARS(efectivo)}</td>
              <td className={`${TD} text-right tabular-nums`}>
                {f.liquidacion
                  ? <Link to={`/tesoreria/liquidaciones?fecha=${dia}&repartidor=${encodeURIComponent(f.choferId)}`} className="text-accent underline underline-offset-2">{formatoARS(f.liquidacion.efectivoRecibido)}{f.liquidacion.diferenciaEfectivo !== 0 && <span className="text-red-600"> ({formatoARS(f.liquidacion.diferenciaEfectivo)})</span>}</Link>
                  : '—'}
              </td>
              <td className={TD}><span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${e.clase}`}>{e.texto}</span></td>
            </tr>
          )
        })}
        {filas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={9}>Sin movimientos en la calle.</td></tr>}
      </tbody>
    </table>
  )
}

// Cada cajero se expande con sus ventas y cobranzas una por una (2026-09-14,
// pedido de Ariel): qué llevó cada cliente, el ticket y el comprobante.
function TablaVentanilla({ filas }: { filas: FilaVentanilla[] }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  return (
    <table className="w-full min-w-[860px]">
      <thead><tr>{['Cajero', 'Contado', 'Promo', 'Bultos', 'Cobranzas', 'Efectivo', 'Cierre', 'Estado', ''].map((h, i) => <th key={i} className={`${TH} ${i > 0 && i < 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
      <tbody>
        {filas.map((f) => {
          const efectivo = f.contado.efectivo + f.promo.efectivo + f.cobranzas.efectivo + (f.rendicion?.recibido.efectivo ?? 0)
          const e = ESTADO_CAJA[f.estado]
          const expandido = abierto === f.cajaId
          const movimientos = f.ventas.length + f.recibos.length
          return (
            <Fragment key={f.cajaId}>
            <tr>
              <td className={TD}>{f.nombre}</td>
              <td className={`${TD} text-right tabular-nums`}>{ventasTxt(f.contado)}</td>
              <td className={`${TD} text-right tabular-nums`}>{ventasTxt(f.promo)}</td>
              <td className={`${TD} text-right tabular-nums`} title={f.bultos.map((b) => `${b.cantidad} × ${b.nombre}`).join(', ')}>{f.bultos.reduce((s, b) => s + b.cantidad, 0)}</td>
              <td className={`${TD} text-right tabular-nums`}>{f.cobranzas.cantidad ? `${f.cobranzas.cantidad} · ${formatoARS(f.cobranzas.total)}` : '—'}</td>
              <td className={`${TD} text-right tabular-nums font-semibold`}>{formatoARS(efectivo)}</td>
              <td className={`${TD} text-right tabular-nums`}>
                {f.rendicion
                  ? <Link to="/tesoreria/rendiciones" className="text-accent underline underline-offset-2">{f.rendicion.codigo} · {formatoARS(f.rendicion.efectivoContado)}{f.rendicion.diferenciaEfectivo !== 0 && <span className="text-red-600"> ({formatoARS(f.rendicion.diferenciaEfectivo)})</span>}</Link>
                  : '—'}
              </td>
              <td className={TD}><span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${e.clase}`}>{f.estado === 'validada' && <ShieldCheck size={12} />}{e.texto}</span></td>
              <td className={`${TD} text-right`}>
                <button type="button" onClick={() => setAbierto(expandido ? null : f.cajaId)} aria-expanded={expandido}
                  className="inline-flex items-center gap-1 min-h-[44px] px-2 -my-2 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg whitespace-nowrap">
                  {expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expandido ? 'Ocultar' : `Ver ventas (${movimientos})`}
                </button>
              </td>
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
        {filas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={9}>Sin ventas ni cobranzas de mostrador.</td></tr>}
      </tbody>
    </table>
  )
}
