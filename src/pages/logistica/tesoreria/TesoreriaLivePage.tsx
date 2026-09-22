import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useLiveDelDia } from '@/hooks/useLiveDelDia'
import { custodiaTotal, useCustodiaTesoreria } from '@/hooks/useCustodiaTesoreria'
import { formatoARS } from '@/utils/money'
import type { FilaCalle, FilaVentanilla, PorEmpresaLive } from '@/utils/tesoreriaLive'
import { Plegable } from '@/components/ui/Plegable'
import TiraSobres from '@/components/tesoreria/TiraSobres'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import VentasDeCajero from '@/components/tesoreria/VentasDeCajero'
import { BadgeCaja, BadgeCalle, BotonDetalle, CeldasEmpresas, CuadroEmpresas, EncabezadoLive, TarjetasEmpresa, ThEmpresas, sumaEmpresas, type TarjetaEmpresa } from '@/components/tesoreria/live'
import { PLANTAS, type Cobranza, type PlantaId } from '@/types'
import { TH, TD } from '@/components/common/tabla'

// TESORERÍA en vivo (2026-09-09; desde el 2026-09-16 solo la PLATA, para
// mirar en el momento, también por directores). Un cuadro arriba con lo que
// entró hoy partido en Redonhielo, Rolito y Total —efectivo a rendir, cheques,
// retenciones y transferencias (informativas: no pasan por el sobre)—, la
// custodia de los sobres, y una tabla corta por persona con esas mismas tres
// columnas. La cuenta corriente no aparece: no es plata que entre hoy. Todo lo
// demás se despliega por fila.
export default function TesoreriaLivePage() {
  const hoy = useDiaActual()
  const [dia, setDia] = useState(hoy)
  const { resumen: r, cobranzas, ultimoCambio } = useLiveDelDia(dia)
  const pe = r.totales.porEmpresa
  // Custodia de los sobres de ventanilla (rendición de fondos, 2026-09-14):
  // tiene que llegar / en camino / recibido / falta, las dos plantas sumadas.
  const custodia = useCustodiaTesoreria(dia)
  const cus = useMemo(() => custodiaTotal(custodia.porPlanta, 'todas'), [custodia.porPlanta])

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-5 pb-10">
      <EncabezadoLive icono={<Activity size={22} className="text-accent" />} titulo="Tesorería · en vivo" bajada="La plata que entró hoy y dónde está ahora: en la calle, en la ventanilla, en un sobre en camino o ya recibida." dia={dia} hoy={hoy} onDia={setDia} ultimoCambio={ultimoCambio} />

      <TarjetasEmpresa etiqueta="Efectivo a rendir hoy" redonhielo={tarjeta(pe.redonhielo)} rolito={tarjeta(pe.rolito)} total={tarjeta({
        efectivo: pe.redonhielo.efectivo + pe.rolito.efectivo, transferencia: pe.redonhielo.transferencia + pe.rolito.transferencia,
        cheques: { cantidad: pe.redonhielo.cheques.cantidad + pe.rolito.cheques.cantidad, total: pe.redonhielo.cheques.total + pe.rolito.cheques.total },
        retenciones: { cantidad: pe.redonhielo.retenciones.cantidad + pe.rolito.retenciones.cantidad, total: pe.redonhielo.retenciones.total + pe.rolito.retenciones.total },
      })} />

      <TiraSobres custodia={cus} horasAviso={custodia.config.horasAvisoSobre} linkRecepcion error={custodia.error} />

      <Plegable titulo={`Calle · ${r.calle.length} repartidores`} abiertoInicial extra={<span className="text-xs text-secundario">{r.calle.filter((f) => f.estado === 'liquidado').length} liquidados</span>}>
        <TablaPersonas filas={r.calle.map((f) => ({ id: f.choferId, nombre: f.deposito ? `${f.deposito} · ${f.nombre || f.choferId}` : (f.nombre || f.choferId), porEmpresa: f.porEmpresa, cierre: <LinkLiquidacion f={f} dia={dia} />, estado: <BadgeCalle estado={f.estado} /> }))} vacio="Sin plata en la calle." />
      </Plegable>

      {(Object.keys(PLANTAS) as PlantaId[]).map((p) => (
        <Plegable key={p} titulo={`Ventanilla ${PLANTAS[p].label.replace('Planta ', '')} · ${r.ventanilla[p].length} cajeros`} abiertoInicial>
          <TablaPersonas filas={r.ventanilla[p].map((f) => ({ id: f.cajaId, nombre: f.nombre, porEmpresa: f.porEmpresa, extraEfectivo: f.rendicion?.recibido.efectivo ?? 0, cierre: <Cierre f={f} />, estado: <BadgeCaja estado={f.estado} />, detalle: <VentasDeCajero fila={f} />, etiquetaDetalle: `Movimientos (${f.ventas.length + f.recibos.length})` }))} vacio="Sin ventas ni cobranzas de mostrador." />
        </Plegable>
      ))}

      <Plegable titulo={`Supervisores · ${r.supervisores.length} cobrando`} abiertoInicial>
        <TablaPersonas filas={r.supervisores.map((s) => ({ id: s.uid, nombre: s.nombre, porEmpresa: s.porEmpresa, cantidad: s.cobranzas.cantidad, cierre: <LinkLiquidacion f={s} dia={dia} />, estado: s.liquidacion ? <BadgeCalle estado="liquidado" /> : <span className="text-xs text-secundario">Sin liquidar</span>, detalle: <Recibos cobranzas={cobranzas} uid={s.uid} nombre={s.nombre} />, etiquetaDetalle: `Recibos (${s.cobranzas.cantidad})` }))} vacio="Sin cobranzas de supervisores." conCantidad />
      </Plegable>
    </main>
  )
}

/** La tarjeta grande de una empresa: el efectivo a rendir y, abajo, los valores en papel y las transferencias. */
function tarjeta(p: PorEmpresaLive['redonhielo']): TarjetaEmpresa {
  const valor = (v: { cantidad: number; total: number }) => (v.cantidad ? `${v.cantidad} · ${formatoARS(v.total)}` : '—')
  return {
    importe: p.efectivo,
    lineas: [['Cheques', valor(p.cheques)], ['Retenciones', valor(p.retenciones)], ['Transferencias (no se rinden)', p.transferencia ? formatoARS(p.transferencia) : '—']],
  }
}

function LinkLiquidacion({ f, dia }: { f: { choferId?: string; uid?: string; liquidacion: FilaCalle['liquidacion'] }; dia: string }) {
  const l = f.liquidacion
  if (!l) return <span className="text-secundario">—</span>
  const id = f.choferId ?? f.uid ?? ''
  return (
    <Link to={`/tesoreria/liquidaciones?fecha=${dia}&repartidor=${encodeURIComponent(id)}`} className="text-accent underline underline-offset-2 whitespace-nowrap">
      {l.codigo ?? 'Ver'} · {formatoARS(l.efectivoRecibido)}{l.diferenciaEfectivo !== 0 && <span className="text-red-600"> ({formatoARS(l.diferenciaEfectivo)})</span>}
    </Link>
  )
}

/** El sobre del turno (declarado y diferencia) o el cierre viejo. */
function Cierre({ f }: { f: FilaVentanilla }) {
  if (f.sobre) {
    const s = f.sobre
    const contado = s.recepcion?.efectivoContado
    return (
      <Link to="/tesoreria/recepcion" className="text-accent underline underline-offset-2 whitespace-nowrap">
        {s.codigo} · {formatoARS(contado ?? s.declarado.efectivo)}
        {s.diferenciaDeclarada.efectivo !== 0 && <span className="text-red-600"> ({formatoARS(s.diferenciaDeclarada.efectivo)})</span>}
      </Link>
    )
  }
  if (f.rendicion) {
    return (
      <Link to="/tesoreria/rendiciones/historial" className="text-accent underline underline-offset-2 whitespace-nowrap">
        {f.rendicion.codigo} · {formatoARS(f.rendicion.efectivoContado)}{f.rendicion.diferenciaEfectivo !== 0 && <span className="text-red-600"> ({formatoARS(f.rendicion.diferenciaEfectivo)})</span>}
      </Link>
    )
  }
  return <span className="text-secundario">—</span>
}

function Recibos({ cobranzas, uid, nombre }: { cobranzas: Cobranza[]; uid: string; nombre: string }) {
  const recibos = cobranzas.filter((c) => c.origen === 'supervisor' && c.registradoPor.uid === uid).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
  return (
    <div>
      <p className="text-xs text-secundario mb-2">Recibos de {nombre} en el día. Cada uno se abre con su detalle y su PDF.</p>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {recibos.map((c) => <CobranzaSupervisorCard key={c.id} c={c} />)}
      </div>
    </div>
  )
}

interface FilaPersona {
  id: string
  nombre: string
  porEmpresa: PorEmpresaLive
  /** Recibos (supervisores). */
  cantidad?: number
  /** Efectivo que un cierre viejo de caja recibió de liquidaciones (se suma al a rendir). */
  extraEfectivo?: number
  cierre: ReactNode
  estado: ReactNode
  detalle?: ReactNode
  etiquetaDetalle?: string
}

/**
 * UNA tabla para las tres poblaciones (calle, ventanilla, supervisores):
 * persona, efectivo a rendir por empresa y total, valores en papel, cierre y
 * estado. El resto (transferencias, cheques y retenciones por empresa, y los
 * movimientos uno por uno) se despliega.
 */
function TablaPersonas({ filas, vacio, conCantidad }: { filas: FilaPersona[]; vacio: string; conCantidad?: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const columnas = 7 + (conCantidad ? 1 : 0)
  return (
    <table className="w-full min-w-[900px]">
      <thead><tr>
        <th className={TH}>{conCantidad ? 'Supervisor' : 'Persona'}</th>
        {conCantidad && <th className={`${TH} text-right`}>Recibos</th>}
        <ThEmpresas />
        <th className={`${TH} text-right`}>Cheques y ret.</th>
        <th className={`${TH} text-right`}>Cierre</th>
        <th className={TH}>Estado</th>
        <th className={TH}></th>
      </tr></thead>
      <tbody>
        {filas.map((f) => {
          const pe = f.porEmpresa
          const expandido = abierto === f.id
          const valores = pe.redonhielo.cheques.total + pe.rolito.cheques.total + pe.redonhielo.retenciones.total + pe.rolito.retenciones.total
          const nValores = pe.redonhielo.cheques.cantidad + pe.rolito.cheques.cantidad + pe.redonhielo.retenciones.cantidad + pe.rolito.retenciones.cantidad
          return (
            <Fragment key={f.id}>
              <tr className="hover:bg-[#FCFBF8]">
                <td className={`${TD} py-3 font-semibold text-gray-900`}>{f.nombre}</td>
                {conCantidad && <td className={`${TD} py-3 text-right tabular-nums`}>{f.cantidad ?? '—'}</td>}
                <CeldasEmpresas valores={sumaEmpresas(pe.redonhielo.efectivo + (f.extraEfectivo ?? 0), pe.rolito.efectivo)} />
                <td className={`${TD} text-right tabular-nums`}>{nValores ? `${nValores} · ${formatoARS(valores)}` : '—'}</td>
                <td className={`${TD} text-right tabular-nums`}>{f.cierre}</td>
                <td className={TD}>{f.estado}</td>
                <td className={`${TD} text-right`}><BotonDetalle abierto={expandido} onClick={() => setAbierto(expandido ? null : f.id)} etiqueta={f.etiquetaDetalle ?? 'Detalle'} /></td>
              </tr>
              {expandido && (
                <tr>
                  <td colSpan={columnas} className="bg-[#F8F7F2] px-3 py-3 border-b border-[#E7E5DC] space-y-3">
                    <CuadroEmpresas compacto titulo={`Plata de ${f.nombre}`} filas={[
                      { etiqueta: 'Efectivo a rendir', destacada: true, valores: sumaEmpresas(pe.redonhielo.efectivo + (f.extraEfectivo ?? 0), pe.rolito.efectivo) },
                      { etiqueta: 'Cheques', valores: sumaEmpresas(pe.redonhielo.cheques.total, pe.rolito.cheques.total), cantidades: sumaEmpresas(pe.redonhielo.cheques.cantidad, pe.rolito.cheques.cantidad) },
                      { etiqueta: 'Retenciones', valores: sumaEmpresas(pe.redonhielo.retenciones.total, pe.rolito.retenciones.total), cantidades: sumaEmpresas(pe.redonhielo.retenciones.cantidad, pe.rolito.retenciones.cantidad) },
                      { etiqueta: 'Transferencias', nota: 'no pasan por el sobre', secundaria: true, valores: sumaEmpresas(pe.redonhielo.transferencia, pe.rolito.transferencia) },
                    ]} />
                    {f.detalle}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {filas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={columnas}>{vacio}</td></tr>}
      </tbody>
    </table>
  )
}
