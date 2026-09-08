import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, FileDown, Share2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { generateReciboCobranzaSupervisor, nombreArchivoReciboSupervisor } from '@/utils/pdf'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { formatoARS } from '@/utils/money'
import { Cobranza } from '@/types'

// Tarjeta + detalle de una cobranza de supervisor. Se usa en Inicio (cobrado
// hoy) y en Cobranzas anteriores. Al tocarla abre el detalle con los medios,
// el estado en Tango y las acciones: enviar el recibo (WhatsApp, mail — Web
// Share con el PDF adjunto) o descargarlo. Misma mecánica que Mis ventas del
// chofer: en una compu, "enviar" cae a descargar y avisa.

function datosPdf(c: Cobranza) {
  if (!c.imputaciones || !c.medios) return null
  return {
    numeroRecibo:  c.numeroRecibo,
    clienteNombre: c.clienteNombre,
    empresa:       c.empresa ?? 'redonhielo',
    importe:       c.importe,
    imputaciones:  c.imputaciones,
    medios:        c.medios,
    registradoPor: c.registradoPor.nombre,
    fecha:         c.fecha.toDate(),
  }
}

/** Descarga o comparte el recibo. Devuelve un aviso para mostrar, o '' si no hace falta. */
export async function entregarReciboSupervisor(c: Cobranza, compartir: boolean): Promise<string> {
  const datos = datosPdf(c)
  if (!datos) return 'Esta cobranza no tiene recibo para generar.'
  if (!compartir) { await generateReciboCobranzaSupervisor(datos); return '' }
  const blob = (await generateReciboCobranzaSupervisor(datos, { descargar: false })) as Blob
  const titulo = `Recibo ${c.numeroRecibo ?? 'de cobranza'}`
  const r = await compartirArchivo(blob, nombreArchivoReciboSupervisor(datos), { titulo, texto: `${titulo} — ${c.clienteNombre} — ${formatoARS(c.importe)}` })
  return r === 'descargado' ? 'Este dispositivo no puede compartir archivos: se descargó el PDF.' : ''
}

/** Chip con el estado del recibo en Tango (write-back de la cola tango-outbox). */
export function EstadoTangoChip({ c }: { c: Cobranza }) {
  if (c.tango?.estado === 'confirmado') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
        <CheckCircle2 size={12} /> En Tango{c.tango.reciboNumero ? ` · ${c.tango.reciboNumero}` : ''}
      </span>
    )
  }
  if (c.tango?.estado === 'error') {
    // La cola agotó los reintentos: lo mira la oficina (el motivo viene del bridge).
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-600" title={c.tango.ultimoError ?? undefined}>
        <AlertTriangle size={12} /> Error en Tango{c.tango.ultimoError ? ` · ${c.tango.ultimoError.slice(0, 80)}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
      <Clock size={12} /> Pendiente en Tango
    </span>
  )
}

export function CobranzaSupervisorCard({ c, sinSubir = false }: { c: Cobranza; sinSubir?: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ocupada, setOcupada] = useState(false)
  const facturas = c.imputaciones?.length ?? 0

  const entregar = async (compartir: boolean) => {
    setOcupada(true)
    setAviso('')
    try { setAviso(await entregarReciboSupervisor(c, compartir)) } finally { setOcupada(false) }
  }

  return (
    <>
      <button type="button" onClick={() => setAbierta(true)}
        className="w-full text-left bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 active:scale-[0.99] transition-transform">
        <div className="flex justify-between items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{c.clienteNombre}</p>
          <p className="text-sm font-semibold text-gray-900 shrink-0">{formatoARS(c.importe)}</p>
        </div>
        <div className="flex justify-between items-center gap-2 mt-0.5">
          <p className="text-xs text-gray-500 truncate">
            {c.numeroRecibo ?? 'Sin número'} · {facturas} {facturas === 1 ? 'factura' : 'facturas'} · {c.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          {sinSubir
            ? <span className="text-[11px] text-amber-600 shrink-0">Sin subir</span>
            : <EstadoTangoChip c={c} />}
        </div>
      </button>

      {abierta && (
        <Modal open onClose={() => setAbierta(false)} title={`Recibo ${c.numeroRecibo ?? 'sin número'}`}>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{c.clienteNombre}</p>
              <p className="text-xs text-gray-500">
                {c.fecha.toDate().toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {c.registradoPor.nombre}
              </p>
              <div className="mt-1">{sinSubir ? <span className="text-[11px] text-amber-600">Todavía no se subió (sin señal); se envía solo al volver la conexión.</span> : <EstadoTangoChip c={c} />}</div>
            </div>

            {c.imputaciones && c.imputaciones.length > 0 && (
              <ul className="text-xs text-gray-600 space-y-0.5">
                {c.imputaciones.map((i) => (
                  <li key={`${i.comprobanteTipo}|${i.comprobanteNumero}`} className="flex justify-between gap-2">
                    <span className="truncate">{i.comprobanteTipo} {i.comprobanteNumero}</span>
                    <span className="shrink-0">{formatoARS(i.importeImputado)}</span>
                  </li>
                ))}
              </ul>
            )}

            {c.medios && (
              <ul className="text-xs text-gray-600 space-y-0.5 border-t border-[#D3D1C7] pt-2">
                {c.medios.efectivo > 0 && <li className="flex justify-between"><span>Efectivo</span><span>{formatoARS(c.medios.efectivo)}</span></li>}
                {c.medios.transferencia > 0 && <li className="flex justify-between"><span>Transferencia</span><span>{formatoARS(c.medios.transferencia)}</span></li>}
                {c.medios.cheques.map((ch, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="truncate">Cheque {ch.numero} · {ch.bancoNombre} · cobro {ch.fechaAcreditacion}</span><span className="shrink-0">{formatoARS(ch.importe)}</span></li>
                ))}
                {c.medios.retenciones.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="truncate">{RETENCION_LABELS[r.tipo]} · cert. {r.nroCertificado}</span><span className="shrink-0">{formatoARS(r.importe)}</span></li>
                ))}
                <li className="flex justify-between font-semibold text-gray-900 pt-1"><span>Total</span><span>{formatoARS(c.importe)}</span></li>
              </ul>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={() => entregar(true)} disabled={ocupada} className="w-full">
                <Share2 size={16} className="mr-2" /> {puedeCompartirArchivos() ? 'Enviar recibo (WhatsApp, mail…)' : 'Enviar recibo'}
              </Button>
              <Button variant="outline" onClick={() => entregar(false)} disabled={ocupada} className="w-full">
                <FileDown size={16} className="mr-2" /> Descargar PDF
              </Button>
              {aviso && <p className="text-xs text-gray-500">{aviso}</p>}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
