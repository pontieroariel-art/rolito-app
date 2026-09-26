import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Ban, CheckCircle2, Clock, Eye, RotateCcw, Share2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import AnularReciboModal from '@/components/cobranzas/AnularReciboModal'
import { useAuth } from '@/context/AuthContext'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { envioDeRecibo } from '@/utils/envioComprobante'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { formatoARS } from '@/utils/money'
import { cobranzaAnulada, reciboAnulable, textoAnulacionCobranza } from '@/utils/anulacionCobranza'
import { Cobranza } from '@/types'

// Los generadores de PDF se cargan al tocar el botón, no con la pantalla (R9).
const pdf = () => import('@/utils/pdf')

/** A dónde va "Hacer el recibo correcto" según quién cobró (misma pantalla de cobro, precargada). */
export const rutaReemitirRecibo = (c: Cobranza): string =>
  `${c.origen === 'supervisor' ? '/supervisor/cobrar' : c.origen === 'cobrador' ? '/chofer/cobrar' : '/caja/cobranzas'}?reemitir=${c.id}`

const TONO = { warn: 'text-amber-700', bad: 'text-red-600', neutral: 'text-secundario' } as const

/** Chip del estado de la anulación del recibo (2026-09-15); nada si no hay anulación. */
export function EstadoAnulacionReciboChip({ c }: { c: Cobranza }) {
  const t = textoAnulacionCobranza(c.anulacion)
  if (!t) return null
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${TONO[t.tono]}`}><Ban size={12} /> {t.texto}</span>
}

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
    ...(c.aCuenta ? { aCuenta: c.aCuenta } : {}),
    registradoPor: c.registradoPor.nombre,
    fecha:         c.fecha.toDate(),
  }
}

/** El recibo como archivo en memoria, para el visor (2026-09-15). null si la cobranza no tiene recibo. */
export async function reciboSupervisorBlob(c: Cobranza): Promise<{ blob: Blob; nombre: string; titulo: string } | null> {
  const datos = datosPdf(c)
  if (!datos) return null
  const { generateReciboCobranzaSupervisor, nombreArchivoReciboSupervisor } = await pdf()
  const blob = await generateReciboCobranzaSupervisor(datos)
  return { blob, nombre: nombreArchivoReciboSupervisor(datos), titulo: `Recibo ${c.numeroRecibo ?? 'de cobranza'}` }
}

/** Comparte el recibo por el menú del sistema (WhatsApp, mail…). Para verlo: `reciboSupervisorBlob` + visor. Devuelve un aviso para mostrar, o '' si no hace falta. */
export async function entregarReciboSupervisor(c: Cobranza): Promise<string> {
  const datos = datosPdf(c)
  if (!datos) return 'Esta cobranza no tiene recibo para generar.'
  const { generateReciboCobranzaSupervisor, nombreArchivoReciboSupervisor } = await pdf()
  const blob = await generateReciboCobranzaSupervisor(datos)
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
    <span className="inline-flex items-center gap-1 text-[11px] text-secundario">
      <Clock size={12} /> Pendiente en Tango
    </span>
  )
}

export function CobranzaSupervisorCard({ c, sinSubir = false }: { c: Cobranza; sinSubir?: boolean }) {
  const { user } = useAuth()
  const [abierta, setAbierta] = useState(false)
  const [anulando, setAnulando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [ocupada, setOcupada] = useState(false)
  const facturas = c.imputaciones?.length ?? 0
  const anulada = cobranzaAnulada(c)
  // Anular (2026-09-15): solo el que cobró, sobre un recibo numerado sin anulación en curso.
  const puedeAnular = !!user && !sinSubir && reciboAnulable(c, user.uid)
  const propia = user?.uid === c.registradoPor.uid

  const { abrir } = useVisorComprobante()
  const entregar = async () => {
    setOcupada(true)
    setAviso('')
    try { setAviso(await entregarReciboSupervisor(c)) } finally { setOcupada(false) }
  }
  // Visor (2026-09-15): el recibo se ve en pantalla; descargar o enviar es un clic adentro.
  const ver = async () => {
    setOcupada(true); setAviso('')
    try {
      const r = await reciboSupervisorBlob(c)
      if (!r) { setAviso('Esta cobranza no tiene recibo para generar.'); return }
      abrir({ ...r, subtitulo: `${c.clienteNombre} · ${formatoARS(c.importe)}`, envio: envioDeRecibo(c, r.titulo) })
    } finally { setOcupada(false) }
  }

  return (
    <>
      <button type="button" onClick={() => setAbierta(true)}
        className={`w-full text-left bg-white rounded-xl border shadow-sm p-3 active:scale-[0.99] transition-transform ${anulada ? 'border-red-200 opacity-75' : 'border-[#D3D1C7]'}`}>
        <div className="flex justify-between items-center gap-2">
          <p className={`text-sm font-medium truncate ${anulada ? 'text-secundario line-through' : 'text-gray-900'}`}>{c.clienteNombre}</p>
          <p className={`text-sm font-semibold shrink-0 ${anulada ? 'text-secundario line-through' : 'text-gray-900'}`}>{formatoARS(c.importe)}</p>
        </div>
        {c.anulacion && <div className="mt-0.5"><EstadoAnulacionReciboChip c={c} /></div>}
        <div className="flex justify-between items-center gap-2 mt-0.5">
          <p className="text-xs text-secundario truncate">
            {c.numeroRecibo ?? 'Sin número'} · {facturas} {facturas === 1 ? 'factura' : 'facturas'}{c.aCuenta ? ` · a cuenta ${formatoARS(c.aCuenta)}` : ''} · {c.fecha.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
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
              <p className="text-xs text-secundario">
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
            {c.aCuenta ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                A cuenta (saldo a favor del cliente): <span className="font-semibold">{formatoARS(c.aCuenta)}</span>
              </p>
            ) : null}

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
                {(c.medios.aCuentaAplicado ?? []).map((a, i) => (
                  <li key={`ac${i}`} className="flex justify-between gap-2"><span className="truncate">Saldo a favor aplicado · recibo {a.reciboNumero}</span><span className="shrink-0">{formatoARS(a.importe)}</span></li>
                ))}
                <li className="flex justify-between font-semibold text-gray-900 pt-1"><span>Total</span><span>{formatoARS(c.importe)}</span></li>
              </ul>
            )}

            {c.anulacion && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800 space-y-0.5">
                <EstadoAnulacionReciboChip c={c} />
                {c.anulacion.nota ? <p className="text-red-700">{c.anulacion.nota}</p> : null}
                {anulada && c.anulacion.anuladaPor ? <p className="text-red-700/80">Autorizó {c.anulacion.anuladaPor.nombre}</p> : null}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {anulada && propia && (
                <Link to={rutaReemitirRecibo(c)} className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-accent text-white font-semibold">
                  <RotateCcw size={16} /> Hacer el recibo correcto
                </Link>
              )}
              <Button onClick={() => entregar()} disabled={ocupada} className="w-full">
                <Share2 size={16} className="mr-2" /> {puedeCompartirArchivos() ? 'Enviar recibo (WhatsApp, mail…)' : 'Enviar recibo'}
              </Button>
              <Button variant="outline" onClick={ver} disabled={ocupada} className="w-full">
                <Eye size={16} className="mr-2" /> Ver recibo
              </Button>
              {puedeAnular && (
                <button type="button" onClick={() => setAnulando(true)}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 text-red-700 text-sm font-semibold">
                  <Ban size={16} /> Anular recibo
                </button>
              )}
              {aviso && <p className="text-xs text-secundario">{aviso}</p>}
            </div>
          </div>
        </Modal>
      )}

      {anulando && user && (
        <AnularReciboModal cobranza={c} actor={{ uid: user.uid, nombre: user.nombre }}
          onCerrar={(pedida) => { setAnulando(false); if (pedida) { setAbierta(false) } }} />
      )}
    </>
  )
}
