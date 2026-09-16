import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Printer, Receipt } from 'lucide-react'
import Badge, { type TonoBadge } from '@/components/common/Badge'
import { TH, TD } from '@/components/common/tabla'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { reciboSupervisorBlob } from '@/components/supervisor/CobranzaSupervisorCard'
import { abrirGenerado, useVisorComprobante } from '@/components/ui/VisorComprobante'
import { envioDeRecibo, envioDeVenta } from '@/utils/envioComprobante'
import { usePerfilesClientes } from '@/hooks/usePerfilesClientes'
import { useCopiasTicketVentanilla } from '@/hooks/useCopiasTicketVentanilla'
import { caiRemitoOficialCacheado, getCaiRemitoOficial } from '@/services/remitoOficialConfigService'
import { reportError } from '@/services/observability'
import { textoAnulacion } from '@/utils/anulacionVenta'
import { describirComprobante, generarComprobanteVenta } from '@/utils/comprobanteDeVenta'
import type { CaiRemito } from '@/utils/comprobanteInterno'
import { chequesDe, efectivoDe, retencionesDe, sumaImportes, transferenciaDe } from '@/utils/medios'
import { formatoARS } from '@/utils/money'
import { importeCobrado } from '@/utils/importeCobrado'
import { nombreClienteVenta } from '@/utils/nombreClienteVenta'
import { generateReciboCobranza } from '@/utils/pdf'
import { partesTicketDeVenta } from '@/utils/ticketDeVenta'
import type { FilaVentanilla } from '@/utils/tesoreriaLive'
import { generateTicketsVentanilla } from '@/utils/ventanillaTicket'
import type { Cobranza, VentaCamion, VentaVentanilla } from '@/types'

// Las ventas y las cobranzas de mostrador de UN cajero, una por una, dentro
// del tablero de Tesorería en vivo (2026-09-14, pedido de Ariel): qué llevó
// cada cliente, cómo pagó, qué papel salió, y el ticket de 80 mm o el
// comprobante (factura de ARCA, factura X, remito) para verlos. Tesorería ve
// todo: acá no se tapa ningún importe.

const hora = (ts: { toDate(): Date }) => ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1 min-h-[32px] text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap'

const CANAL: Record<string, string> = { contado: 'Contado', promo: 'Promo' }
const FORMA: Record<string, string> = { contado_efectivo: 'efectivo', contado_transferencia: 'transferencia', cuenta_corriente: 'cta. cte.' }
/** "Contado · efectivo", "Promo · efectivo", "Contado · cta. cte." */
export const chipPago = (v: Pick<VentaVentanilla, 'canal' | 'formaPago'>): string =>
  `${CANAL[v.canal] ?? v.canal} · ${FORMA[v.formaPago] ?? v.formaPago}`

/** "3 × Hielo bolsa 10 kg · 2 × Hielo picado" */
export const detalleItems = (items: { nombre: string; cantidad: number }[]): string =>
  items.map((i) => `${i.cantidad} × ${i.nombre}`).join(' · ')

/** Qué papel salió, como badge: etiqueta + tono. */
export function badgeComprobante(v: VentaVentanilla): { texto: string; tono: TonoBadge; title?: string } {
  if (v.anulacion?.estado === 'anulada') {
    const t = textoAnulacion(v.anulacion)
    return { texto: 'Anulada', tono: 'cancelado', title: t?.texto }
  }
  const c = describirComprobante(v)
  switch (c.estado) {
    case 'ok':              return { texto: `${c.etiqueta} ${c.numero}`.trim(), tono: c.etiqueta.startsWith('Factura') && !c.etiqueta.endsWith('X') ? 'confirmado' : 'neutro' }
    case 'rechazada':       return { texto: `${c.etiqueta} rechazada`, tono: 'cancelado', title: c.detalle }
    case 'incierta':        return { texto: `${c.etiqueta} en revisión`, tono: 'aviso', title: c.detalle }
    case 'sin_numero':      return { texto: `${c.etiqueta} sin número`, tono: 'aviso' }
    case 'sin_comprobante': return { texto: 'Ticket', tono: 'neutro', title: 'Sin factura todavía' }
  }
}

/** Medios de una cobranza de mostrador en una línea: "Efectivo $ 1.000 · Cheque 123 $ 900". */
export function mediosTexto(c: Cobranza): string {
  const partes: string[] = []
  const ef = efectivoDe(c), tr = transferenciaDe(c), ch = chequesDe(c), re = retencionesDe(c)
  if (ef > 0) partes.push(`Efectivo ${formatoARS(ef)}`)
  if (tr > 0) partes.push(`Transferencia ${formatoARS(tr)}`)
  if (ch.length) partes.push(`${ch.length} ${ch.length === 1 ? 'cheque' : 'cheques'} ${formatoARS(sumaImportes(ch))}`)
  if (re.length) partes.push(`${re.length} ${re.length === 1 ? 'retención' : 'retenciones'} ${formatoARS(sumaImportes(re))}`)
  return partes.join(' · ') || '—'
}
const mediosDetalle = (c: Cobranza): string => [
  ...chequesDe(c).map((ch) => `Cheque ${ch.numero} · ${ch.bancoNombre} · ${formatoARS(ch.importe)}`),
  ...retencionesDe(c).map((r) => `${RETENCION_LABELS[r.tipo]} cert. ${r.nroCertificado} · ${formatoARS(r.importe)}`),
].join('\n')

// La generación del comprobante (factura, factura X, remito) es la del camión:
// la venta de ventanilla tiene la misma forma salvo quién vendió (cajero) y
// quién entregó (muelle), que van a los campos del chofer del papel.
const comoVentaCamion = (v: VentaVentanilla): VentaCamion =>
  ({ ...v, choferId: v.cajaId, choferNombre: v.entregadoPor?.nombre ?? v.cajaNombre, camionId: '' } as unknown as VentaCamion)

const tieneComprobante = (v: VentaVentanilla): boolean => v.factura?.estado === 'emitida' || !!v.comprobanteInterno

export default function VentasDeCajero({ fila }: { fila: FilaVentanilla }) {
  const uids = useMemo(() => fila.ventas.map((v) => v.clienteId), [fila.ventas])
  const perfiles = usePerfilesClientes(uids)
  const copias = useCopiasTicketVentanilla()
  const [cai, setCai] = useState<CaiRemito | null>(() => caiRemitoOficialCacheado())
  useEffect(() => { getCaiRemitoOficial().then(setCai).catch(() => undefined) }, [])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const { abrir } = useVisorComprobante()
  const [aviso, setAviso] = useState('')

  const correr = useCallback(async (id: string, accion: () => Promise<string>) => {
    setOcupado(id)
    setAviso('')
    try { setAviso(await accion()) }
    catch (err) { reportError(err, { origen: 'VentasDeCajero', id }); setAviso('No se pudo generar el PDF. Probá de nuevo.') }
    finally { setOcupado(null) }
  }, [])

  const verTicket = (v: VentaVentanilla) => correr(`t:${v.id}`, async () => {
    // La factura va solo si está emitida (con eso `motivoFactura` no aparece nunca).
    const partes = partesTicketDeVenta(v, {
      incluirFactura: v.factura?.estado === 'emitida', incluirTurno: true, copiasTurno: copias[v.plantaId],
      cliente: v.clienteId ? perfiles.get(v.clienteId) : undefined,
    })
    abrir({ blob: await generateTicketsVentanilla(partes), nombre: `ticket-${v.plantaId}-turno-${v.turno}.pdf`, titulo: `Ticket · turno ${v.turno}`, subtitulo: v.clienteNombre })
    return ''
  })
  const verComprobante = (v: VentaVentanilla) => correr(`c:${v.id}`, async () => {
    const vc = comoVentaCamion(v)
    return abrirGenerado(abrir, await generarComprobanteVenta(vc, v.clienteId ? perfiles.get(v.clienteId) : undefined, cai), { subtitulo: v.clienteNombre, envio: envioDeVenta(vc, { coleccion: 'ventasVentanilla', id: v.id }) })
  })
  const verRecibo = (c: Cobranza) => correr(`r:${c.id}`, async () => {
    // Cobranza completa (con medios e imputaciones): el recibo numerado del
    // supervisor. Simple (las viejas): el recibo de mostrador de la planta.
    if (c.medios && c.imputaciones) {
      const r = await reciboSupervisorBlob(c)
      if (!r) return 'Esta cobranza no tiene recibo para generar.'
      abrir({ ...r, subtitulo: c.clienteNombre, envio: envioDeRecibo(c, r.titulo) })
      return ''
    }
    const blob = await generateReciboCobranza({ id: c.id, plantaId: c.plantaId ?? 'torcuato', clienteNombre: c.clienteNombre, importe: c.importe, formaPago: c.formaPago, referencia: c.referencia, registradoPor: c.registradoPor.nombre, fecha: c.fecha.toDate() })
    abrir({ blob, nombre: `recibo-cobranza-${c.id.slice(0, 8)}.pdf`, titulo: 'Recibo de mostrador', subtitulo: c.clienteNombre, envio: envioDeRecibo(c, 'Recibo de mostrador') })
    return ''
  })

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Ventas de {fila.nombre} · {fila.ventas.length}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] bg-white rounded-lg border border-[#E7E5DC]">
            <thead>
              <tr>
                {['Hora', 'Cliente', 'Pago', 'Detalle', 'Total', 'Comprobante', ''].map((h, i) => <th key={i} className={`${TH} ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {fila.ventas.map((v) => {
                const anulada = v.anulacion?.estado === 'anulada'
                const b = badgeComprobante(v)
                const anul = !anulada && v.anulacion ? textoAnulacion(v.anulacion) : null
                const detalle = detalleItems(v.items)
                const cliente = nombreClienteVenta(v)
                const ocasional = !v.clienteId
                return (
                  <tr key={v.id} className={anulada ? 'text-secundario line-through' : ''}>
                    <td className={`${TD} tabular-nums whitespace-nowrap`}>{hora(v.fecha)}</td>
                    <td className={`${TD} max-w-[260px]`}>
                      <span className="block truncate" title={v.clienteSucursalNombre ? `${v.clienteNombre} · ${v.clienteSucursalNombre}` : v.clienteNombre}>{cliente}</span>
                      {ocasional && <span className="block text-xs text-secundario">Ocasional{v.clienteOcasional?.cuit ? ` · CUIT ${v.clienteOcasional.cuit}` : v.clienteOcasional?.dni ? ` · DNI ${v.clienteOcasional.dni}` : ''}</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}><Badge tono="neutro" punto={false}>{chipPago(v)}</Badge></td>
                    <td className={`${TD} max-w-[320px]`}><span className="block truncate" title={detalle}>{detalle}</span></td>
                    <td className={`${TD} text-right tabular-nums font-semibold whitespace-nowrap`}>{formatoARS(importeCobrado(v))}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Badge tono={b.tono} title={b.title}>{b.texto}</Badge>
                      {anul && <span className={`block mt-1 text-xs ${anul.tono === 'bad' ? 'text-red-700' : anul.tono === 'warn' ? 'text-amber-700' : 'text-secundario'}`}>{anul.texto}</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="inline-flex gap-1.5">
                        <button type="button" onClick={() => verTicket(v)} disabled={ocupado !== null} className={btn} title="Ticket de 80 mm: factura (si la hay) y turno"><Printer size={12} /> Ticket</button>
                        {tieneComprobante(v) && (
                          <button type="button" onClick={() => verComprobante(v)} disabled={ocupado !== null} className={btn} title="Factura de ARCA, factura X o remito en A4"><FileText size={12} /> Comprobante</button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {fila.ventas.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={7}>Sin ventas todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Cobranzas de mostrador · {fila.recibos.length}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] bg-white rounded-lg border border-[#E7E5DC]">
            <thead>
              <tr>
                {['Hora', 'Cliente', 'Recibo', 'Medios', 'Total', ''].map((h, i) => <th key={i} className={`${TH} ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {fila.recibos.map((c) => (
                <tr key={c.id}>
                  <td className={`${TD} tabular-nums whitespace-nowrap`}>{hora(c.fecha)}</td>
                  <td className={`${TD} max-w-[260px]`}><span className="block truncate" title={c.clienteNombre}>{c.clienteNombre}</span></td>
                  <td className={`${TD} tabular-nums whitespace-nowrap`}>{c.numeroRecibo ?? (c.referencia ? <span className="text-secundario" title={c.referencia}>{c.referencia}</span> : '—')}</td>
                  <td className={`${TD} max-w-[360px]`}><span className="block truncate" title={mediosDetalle(c) || mediosTexto(c)}>{mediosTexto(c)}</span></td>
                  <td className={`${TD} text-right tabular-nums font-semibold whitespace-nowrap`}>{formatoARS(c.importe)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <button type="button" onClick={() => verRecibo(c)} disabled={ocupado !== null} className={btn}><Receipt size={12} /> Recibo</button>
                  </td>
                </tr>
              ))}
              {fila.recibos.length === 0 && <tr><td className={`${TD} text-secundario`} colSpan={6}>Sin cobranzas de mostrador.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {ocupado && <p className="text-xs text-secundario">Generando el PDF…</p>}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
    </div>
  )
}
