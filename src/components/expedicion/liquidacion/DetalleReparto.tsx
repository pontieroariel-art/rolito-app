import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Download, Share2 } from 'lucide-react'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { entregarReciboSupervisor, EstadoTangoChip } from '@/components/supervisor/CobranzaSupervisorCard'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from '@/services/remitoOficialConfigService'
import { generateRemitoCarga } from '@/utils/pdf'
import { describirComprobante, entregarComprobanteVenta, estadoTangoVenta, problemasDeVenta } from '@/utils/comprobanteDeVenta'
import { clasificarReparto, type BloqueVentas, type RepartoClasificado } from '@/utils/liquidacion'
import { nombreDelCambio } from '@/utils/cambios'
import { envasesDeDescarga, envasesDeRemito, filasDeEnvases } from '@/utils/envases'
import { formatoARS } from '@/utils/money'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { reportError } from '@/services/observability'
import type { CaiRemito } from '@/utils/comprobanteInterno'
import type { CambioCamion, Cobranza, DescargaCamion, RemitoCarga, VentaCamion, VentaCamionItem } from '@/types'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'

// Detalle del reparto de un repartidor, CLASIFICADO por tipo de operación
// (decisión de Ariel 2026-09-06, maqueta 1bd0e922): contado Redonhielo
// (efectivo / transferencia), cuenta corriente Redonhielo (remitos), promo
// Rolito (contado / cta cte), cobranzas (por empresa), cambios. Cada bloque
// con su subtotal; cada venta con sus artículos renglón por renglón, el
// comprobante (Ver / Enviar), el estado en Tango y la firma del cliente.
// Lo usan la liquidación de caja y el Reparto en vivo del supervisor.

export interface DetalleRepartoProps {
  remitos:   RemitoCarga[]
  ventas:    VentaCamion[]
  cambios:   CambioCamion[]
  descargas: DescargaCamion[]
  cobranzas: Cobranza[]
  /** Solo resaltar las filas con problema (chip de la barra de estado). */
  soloProblemas?: boolean
}

const hora = (ts: { toDate(): Date } | undefined) => ts ? ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

// Colores por bloque: azul Redonhielo, violeta Rolito, verde cobranzas, ámbar cambios.
const ESTILO = {
  redonhielo: { borde: 'border-l-[#1D6FA8]', fondo: 'bg-[#E8F1F8]' },
  rolito:     { borde: 'border-l-[#8A4FBF]', fondo: 'bg-[#F1EAF8]' },
  cobranzas:  { borde: 'border-l-[#0F6B4E]', fondo: 'bg-[#E6F5EF]' },
  cambios:    { borde: 'border-l-[#B45309]', fondo: 'bg-[#FEF3C7]' },
  recorrido:  { borde: 'border-l-gray-400',  fondo: 'bg-[#F1F0EA]' },
} as const

export function useReparto(p: Omit<DetalleRepartoProps, 'soloProblemas'>): RepartoClasificado {
  return useMemo(() => clasificarReparto(p.ventas, p.cobranzas, p.cambios, p.descargas, problemasDeVenta), [p.ventas, p.cobranzas, p.cambios, p.descargas])
}

export default function DetalleReparto({ remitos, ventas, cambios, descargas, cobranzas, soloProblemas = false }: DetalleRepartoProps) {
  const reparto = useReparto({ remitos, ventas, cambios, descargas, cobranzas })
  const [cai, setCai] = useState<CaiRemito | null>(() => caiRemitoOficialCacheado())
  useEffect(() => { getCaiRemitoOficial().then(setCai).catch(() => undefined) }, [])
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const compartible = puedeCompartirArchivos()
  const problemas = useMemo(() => new Set(reparto.problemas.map((p) => p.venta.id)), [reparto.problemas])

  const entregar = async (v: VentaCamion, modo: 'ver' | 'enviar') => {
    setOcupado(v.id)
    setAviso('')
    try { setAviso(await entregarComprobanteVenta(v, undefined, cai, modo)) }
    finally { setOcupado(null) }
  }
  const entregarRecibo = async (c: Cobranza, compartir: boolean) => {
    setOcupado(c.id)
    setAviso('')
    try { setAviso(await entregarReciboSupervisor(c, compartir)) }
    catch (err) { reportError(err, { origen: 'DetalleReparto', cobranzaId: c.id }); setAviso('No se pudo generar el recibo.') }
    finally { setOcupado(null) }
  }
  const verRemitoCarga = (r: RemitoCarga) =>
    generateRemitoCarga({ codigo: r.codigo, plantaId: r.plantaId, camionLabel: r.camionLabel, choferNombre: r.choferNombre, items: r.items, palletsCarga: r.palletsCarga, envases: r.envases, creadoPor: r.creadoPor, fecha: r.fecha.toDate() })
      .catch((err) => reportError(err, { origen: 'DetalleReparto', accion: 'remito de carga' }))

  const filaVenta = (v: VentaCamion) => (
    <FilaVenta key={v.id} venta={v} ocupado={ocupado === v.id} compartible={compartible} atenuada={soloProblemas && !problemas.has(v.id)}
      onVer={() => entregar(v, 'ver')} onEnviar={() => entregar(v, 'enviar')} />
  )
  const filaCobranza = (c: Cobranza) => (
    <FilaCobranza key={c.id} cobranza={c} ocupado={ocupado === c.id} compartible={compartible} atenuada={soloProblemas}
      onVer={() => entregarRecibo(c, false)} onEnviar={() => entregarRecibo(c, true)} />
  )
  const subBloque = (titulo: string, b: BloqueVentas) => b.ventas.length === 0 ? null : (
    <div key={titulo}>
      <SubHeader titulo={titulo} total={b.total} />
      {b.ventas.map(filaVenta)}
    </div>
  )

  return (
    <div className="space-y-4">
      {aviso && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      <Bloque estilo="recorrido" titulo="Recorrido" subtitulo="carga y descarga">
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          <div className="p-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Salida</p>
            {remitos.length === 0 && <p className="text-sm text-gray-500">Sin remito de carga de esta planta.</p>}
            {remitos.map((r) => (
              <div key={r.id} className="space-y-1">
                <p className="text-sm text-gray-700">
                  Remito de carga <b className="text-gray-900">{r.codigo}</b> · {r.camionLabel} · {hora(r.fecha)}
                  {r.entregadoPor && <> · muelle {hora(r.entregadoPor.hora)} ({r.entregadoPor.nombre})</>}
                  {r.salida && <> · <b className="text-gray-900">salió {hora(r.salida.hora)}</b> ({r.salida.nombre})</>}
                </p>
                <Articulos items={r.items} extra={filasDeEnvases(envasesDeRemito(r))} />
                <button type="button" onClick={() => verRemitoCarga(r)} className={btn}>Ver remito de carga</button>
              </div>
            ))}
          </div>
          <div className="p-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Vuelta</p>
            {descargas.length === 0 && (
              <p className="text-sm text-amber-700">Muelle todavía no registró la descarga: la devolución se compara contra 0.</p>
            )}
            {descargas.map((d) => (
              <div key={d.id} className="space-y-1">
                <p className="text-sm text-gray-700">Descarga contada por muelle · <b className="text-gray-900">{hora(d.fecha)}</b> ({d.registradoPor.nombre})</p>
                <Articulos items={d.items} extra={[
                  ...d.bolsasRotas.map((b) => ({ q: b.cantidad, nombre: `${b.nombre} · rotas recibidas`, cambio: true })),
                  ...filasDeEnvases(envasesDeDescarga(d)),
                ].filter((x) => x.q > 0)} />
              </div>
            ))}
          </div>
        </div>
      </Bloque>

      <Bloque estilo="redonhielo" titulo="Ventas contado · Redonhielo" subtitulo="facturas electrónicas" total={reparto.contado.total}
        pie={`${reparto.contado.efectivo.ventas.length + reparto.contado.transferencia.ventas.length} ventas · efectivo ${formatoARS(reparto.contado.efectivo.total)} se rinde · transferencia ${formatoARS(reparto.contado.transferencia.total)}`}>
        {subBloque('Efectivo', reparto.contado.efectivo)}
        {subBloque('Transferencia', reparto.contado.transferencia)}
        {reparto.contado.efectivo.ventas.length + reparto.contado.transferencia.ventas.length === 0 && <Vacio>Sin ventas de contado.</Vacio>}
      </Bloque>

      <Bloque estilo="redonhielo" titulo="Ventas cuenta corriente · Redonhielo" subtitulo="remitos" total={reparto.cuentaCorriente.total}
        pie={`${reparto.cuentaCorriente.ventas.length} remitos · va a la cuenta corriente del cliente, no se rinde`}>
        {reparto.cuentaCorriente.ventas.length === 0 ? <Vacio>Sin remitos de cuenta corriente.</Vacio> : reparto.cuentaCorriente.ventas.map(filaVenta)}
      </Bloque>

      <Bloque estilo="rolito" titulo="Promo · Rolito" subtitulo="facturas X" total={reparto.promo.total}
        pie={`efectivo ${formatoARS(reparto.promo.contado.ventas.filter((v) => v.formaPago === 'contado_efectivo').reduce((s, v) => s + v.total, 0))} se rinde · cta. cte. ${formatoARS(reparto.promo.cuentaCorriente.total)} a la cuenta del cliente en Rolito`}>
        {subBloque('Contado', reparto.promo.contado)}
        {subBloque('Cuenta corriente', reparto.promo.cuentaCorriente)}
        {reparto.promo.contado.ventas.length + reparto.promo.cuentaCorriente.ventas.length === 0 && <Vacio>Sin ventas de promo.</Vacio>}
      </Bloque>

      <Bloque estilo="cobranzas" titulo="Cobranzas" subtitulo="recibos de cuenta corriente" total={reparto.cobranzas.total}
        pie={`${cobranzas.length} recibos · efectivo ${formatoARS(reparto.cobranzas.efectivo)} se rinde${reparto.cobranzas.cheques.cantidad ? ` · cheques (${reparto.cobranzas.cheques.cantidad}) ${formatoARS(reparto.cobranzas.cheques.total)} van a caja con el papel` : ''}${reparto.cobranzas.retenciones.cantidad ? ` · retenciones (${reparto.cobranzas.retenciones.cantidad}) ${formatoARS(reparto.cobranzas.retenciones.total)}` : ''}`}>
        {reparto.cobranzas.redonhielo.length > 0 && <><SubHeader titulo="Redonhielo" total={reparto.cobranzas.redonhielo.reduce((s, c) => s + c.importe, 0)} />{reparto.cobranzas.redonhielo.map(filaCobranza)}</>}
        {reparto.cobranzas.rolito.length > 0 && <><SubHeader titulo="Rolito" total={reparto.cobranzas.rolito.reduce((s, c) => s + c.importe, 0)} />{reparto.cobranzas.rolito.map(filaCobranza)}</>}
        {cobranzas.length === 0 && <Vacio>Sin cobranzas.</Vacio>}
      </Bloque>

      <Bloque estilo="cambios" titulo="Cambios" subtitulo="bolsas rotas repuestas" totalTexto={`${reparto.cambios.unidades} ${reparto.cambios.unidades === 1 ? 'bolsa' : 'bolsas'}`}
        pie={`registradas por el repartidor ${reparto.cambios.unidades} · rotas recibidas en muelle ${reparto.cambios.rotasRecibidas}${reparto.cambios.unidades === reparto.cambios.rotasRecibidas ? ' · sin diferencia' : ` · diferencia ${reparto.cambios.rotasRecibidas - reparto.cambios.unidades}`}`}>
        {reparto.cambios.lista.length === 0 ? <Vacio>Sin cambios.</Vacio> : reparto.cambios.lista.map((c) => (
          <div key={c.ventaId} className="grid grid-cols-[52px_1fr] gap-3 px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500 tabular-nums pt-0.5">{hora(c.fecha)}</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{c.clienteNombre}{c.clienteCodigoTango && <span className="ml-1.5 text-xs font-normal text-gray-500">{c.clienteCodigoTango}</span>}</p>
              <Articulos items={c.items.map((i) => ({ ...i, nombre: nombreDelCambio(i.nombre) }))} cambio sinImporte />
              {c.venta && <p className="text-xs text-gray-500 mt-1">En la venta {describirComprobante(c.venta).etiqueta} {describirComprobante(c.venta).numero}</p>}
            </div>
          </div>
        ))}
      </Bloque>
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'

function Bloque({ estilo, titulo, subtitulo, total, totalTexto, pie, children }: {
  estilo: keyof typeof ESTILO; titulo: string; subtitulo?: string; total?: number; totalTexto?: string; pie?: string; children: ReactNode
}) {
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm overflow-hidden">
      <div className={`flex items-center justify-between gap-3 px-4 py-3 border-l-4 ${ESTILO[estilo].borde} ${ESTILO[estilo].fondo}`}>
        <p className="font-bold text-gray-900">{titulo}{subtitulo && <span className="ml-2 text-xs font-medium text-gray-500">{subtitulo}</span>}</p>
        {total !== undefined && <p className="font-bold text-gray-900 tabular-nums">{formatoARS(total)}</p>}
        {totalTexto && <p className="font-bold text-gray-900">{totalTexto}</p>}
      </div>
      {children}
      {pie && <div className="px-4 py-2 border-t border-[#D3D1C7] bg-[#FBFAF6] text-xs text-gray-600">{pie}</div>}
    </section>
  )
}

const SubHeader = ({ titulo, total }: { titulo: string; total: number }) => (
  <div className="flex justify-between px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">
    <span>{titulo}</span><span className="tabular-nums normal-case tracking-normal text-xs font-semibold text-gray-700">{formatoARS(total)}</span>
  </div>
)

const Vacio = ({ children }: { children: ReactNode }) => <p className="px-4 py-3 text-sm text-gray-500">{children}</p>

function Articulos({ items, extra = [], cambio = false, sinImporte = false }: {
  items: Array<Pick<VentaCamionItem, 'nombre' | 'cantidad'> & { precioUnitario?: number }>
  extra?: Array<{ q: number; nombre: string; cambio?: boolean }>
  cambio?: boolean
  sinImporte?: boolean
}) {
  return (
    <div className="grid grid-cols-[2.4em_1fr_auto] gap-x-3 gap-y-0.5 text-sm text-gray-700 max-w-md mt-1">
      {items.map((i, idx) => (
        <FragmentRow key={idx} q={i.cantidad} nombre={i.nombre} importe={sinImporte || cambio ? (cambio ? 'sin cargo' : '') : formatoARS((i.precioUnitario ?? 0) * i.cantidad)} cambio={cambio} />
      ))}
      {extra.map((e, idx) => <FragmentRow key={`e${idx}`} q={e.q} nombre={e.nombre} importe="" cambio={!!e.cambio} />)}
    </div>
  )
}
const FragmentRow = ({ q, nombre, importe, cambio }: { q: number; nombre: string; importe: string; cambio: boolean }) => (
  <>
    <span className={`text-right tabular-nums font-semibold ${cambio ? 'text-amber-700' : 'text-gray-900'}`}>{q}</span>
    <span className={cambio ? 'text-amber-700' : ''}>{nombre}</span>
    <span className={`text-right tabular-nums ${cambio ? 'text-amber-700' : ''}`}>{importe}</span>
  </>
)

function Chip({ tono, children }: { tono: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const c = { ok: 'bg-[#E6F5EF] text-[#0F6B4E]', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-700', neutral: 'bg-gray-100 text-gray-600' }[tono]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${c}`}>{children}</span>
}

function FilaVenta({ venta: v, ocupado, compartible, atenuada, onVer, onEnviar }: { venta: VentaCamion; ocupado: boolean; compartible: boolean; atenuada: boolean; onVer: () => void; onEnviar: () => void }) {
  const comp = describirComprobante(v)
  const tango = estadoTangoVenta(v)
  const conProblema = problemasDeVenta(v).length > 0
  return (
    <div className={`grid grid-cols-[52px_1fr_auto] gap-3 px-4 py-3 border-t border-gray-100 ${conProblema ? 'bg-[#FFF7F7]' : ''} ${atenuada ? 'opacity-40' : ''}`}>
      <span className="text-sm text-gray-500 tabular-nums pt-0.5">{hora(v.fecha)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">
          {nombreClienteVenta(v)}
          {v.clienteCodigoTango && <span className="ml-1.5 text-xs font-normal text-gray-500">{v.clienteCodigoTango}</span>}
        </p>
        <Articulos items={v.items} />
        {(v.cambios?.length ?? 0) > 0 && <Articulos items={(v.cambios ?? []).map((i) => ({ ...i, nombre: `${nombreDelCambio(i.nombre)} · cambio por rotas` }))} cambio />}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-600">
          <span className="font-semibold text-gray-900">{comp.etiqueta} {comp.numero}</span>
          {comp.estado === 'ok' && comp.detalle && <Chip tono="ok">{comp.detalle}</Chip>}
          {(comp.estado === 'rechazada' || comp.estado === 'incierta') && <Chip tono="bad"><AlertTriangle size={11} /> {comp.detalle}</Chip>}
          {(comp.estado === 'sin_numero' || comp.estado === 'sin_comprobante') && <Chip tono="warn">{comp.detalle}</Chip>}
          <button type="button" onClick={onVer} disabled={ocupado} className={btn}><Download size={12} /> Ver</button>
          <button type="button" onClick={onEnviar} disabled={ocupado} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Enviar'}</button>
          {tango.estado === 'confirmado' && <Chip tono="ok"><CheckCircle2 size={11} /> {tango.texto}</Chip>}
          {tango.estado === 'pendiente' && <Chip tono="neutral"><Clock size={11} /> {tango.texto}</Chip>}
          {tango.estado === 'error' && <Chip tono="bad"><AlertTriangle size={11} /> {tango.texto}</Chip>}
          {tango.stock && <Chip tono="neutral">Stock ✓ {tango.stock}</Chip>}
          {v.firmaCliente && (
            <span className="inline-flex items-center gap-1.5">
              Firmó {v.firmanteNombre || 'el cliente'}
              <img src={v.firmaCliente} alt="" className="h-6 w-16 rounded border border-gray-200 bg-white object-contain" />
            </span>
          )}
        </div>
      </div>
      <p className="text-sm font-bold text-gray-900 tabular-nums text-right">{formatoARS(v.total)}</p>
    </div>
  )
}

function FilaCobranza({ cobranza: c, ocupado, compartible, atenuada, onVer, onEnviar }: { cobranza: Cobranza; ocupado: boolean; compartible: boolean; atenuada: boolean; onVer: () => void; onEnviar: () => void }) {
  const medios: string[] = []
  if (c.medios) {
    if (c.medios.efectivo > 0) medios.push(`Efectivo ${formatoARS(c.medios.efectivo)}`)
    if (c.medios.transferencia > 0) medios.push(`Transferencia ${formatoARS(c.medios.transferencia)}`)
    c.medios.cheques.forEach((ch) => medios.push(`Cheque ${ch.bancoNombre} ${ch.numero} · acredita ${ch.fechaAcreditacion || `${ch.dias} días`} · ${formatoARS(ch.importe)}`))
    c.medios.retenciones.forEach((r) => medios.push(`${RETENCION_LABELS[r.tipo]} cert. ${r.nroCertificado} · ${formatoARS(r.importe)}`))
    ;(c.medios.aCuentaAplicado ?? []).forEach((a) => medios.push(`Saldo a favor aplicado (${a.reciboNumero}) ${formatoARS(a.importe)}`))
    if (c.aCuenta) medios.push(`A cuenta del cliente ${formatoARS(c.aCuenta)}`)
  } else {
    medios.push(c.formaPago === 'contado_transferencia' ? 'Transferencia' : 'Efectivo')
  }
  const imputa = (c.imputaciones ?? []).map((i) => `${i.comprobanteTipo} ${i.comprobanteNumero}${i.importeImputado < i.saldoAlMomento ? ` (parcial, quedan ${formatoARS(i.saldoAlMomento - i.importeImputado)})` : ''}`)
  return (
    <div className={`grid grid-cols-[52px_1fr_auto] gap-3 px-4 py-3 border-t border-gray-100 ${atenuada ? 'opacity-40' : ''}`}>
      <span className="text-sm text-gray-500 tabular-nums pt-0.5">{hora(c.fecha)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{c.clienteNombre}{c.codigoTango && <span className="ml-1.5 text-xs font-normal text-gray-500">{c.codigoTango}</span>}</p>
        <p className="text-sm text-gray-700">{medios.join(' · ')}{imputa.length ? ` · imputa ${imputa.join(', ')}` : ''}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-600">
          <span className="font-semibold text-gray-900">Recibo {c.numeroRecibo ?? 'sin número'}</span>
          <button type="button" onClick={onVer} disabled={ocupado} className={btn}><Download size={12} /> Ver recibo</button>
          <button type="button" onClick={onEnviar} disabled={ocupado} className={btn}><Share2 size={12} /> {compartible ? 'Enviar' : 'Enviar'}</button>
          <EstadoTangoChip c={c} />
        </div>
      </div>
      <p className="text-sm font-bold text-gray-900 tabular-nums text-right">{formatoARS(c.importe)}</p>
    </div>
  )
}
