import { useState, type ReactNode } from 'react'
import { FileDown, Mail, Share2, X } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { compartirArchivo, descargarArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { enviarComprobantePorMail } from '@/services/envioComprobanteService'
import { reportError } from '@/services/observability'
import type { EmpresaTango } from '@/types'

// Menú para entregar un PDF (factura, remito, composición de saldos) de tres
// formas (2026-09-10): WhatsApp u otra app del celular (menú del sistema con el
// archivo), mail al cliente (lo manda el servidor con el adjunto, destinatario
// precargado con el mail de Tango y editable) o descarga. El PDF se genera
// recién al elegir, con `generar`.

export type PdfGenerado = { ok: true; blob: Blob; nombre: string } | { ok: false; motivo: string }

export interface DatosMail {
  para:          string
  asunto:        string
  mensaje?:      string
  comprobante:   { tipo: string; numero: string; empresa?: EmpresaTango }
  clienteUid?:   string
  clienteNombre: string
}

export default function MenuCompartirPdf({ generar, titulo, texto, mail, trigger }: {
  generar:  () => Promise<PdfGenerado>
  titulo:   string
  texto?:   string
  mail:     DatosMail
  /** Botón que abre el menú: recibe el handler y si hay algo en curso. */
  trigger:  (abrir: () => void, ocupado: boolean) => ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const [mailAbierto, setMailAbierto] = useState(false)
  const [ocupado, setOcupado] = useState<'compartir' | 'descargar' | 'mail' | null>(null)
  const [aviso, setAviso] = useState('')
  const [para, setPara] = useState(mail.para)
  const [asunto, setAsunto] = useState(mail.asunto)
  const [mensaje, setMensaje] = useState(mail.mensaje ?? '')
  const [conCopia, setConCopia] = useState(false)
  const [enviadoA, setEnviadoA] = useState('')

  const cerrar = () => { setAbierto(false); setAviso('') }

  const correr = async (modo: 'compartir' | 'descargar') => {
    setOcupado(modo)
    setAviso('')
    try {
      const g = await generar()
      if (!g.ok) { setAviso(g.motivo); return }
      if (modo === 'descargar') { descargarArchivo(g.blob, g.nombre); cerrar(); return }
      const r = await compartirArchivo(g.blob, g.nombre, { titulo, texto })
      if (r === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
      else cerrar()
    } catch (err) {
      reportError(err, { origen: 'MenuCompartirPdf', modo, titulo })
      setAviso('No se pudo generar el PDF. Probá de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  const abrirMail = () => { setAbierto(false); setEnviadoA(''); setAviso(''); setMailAbierto(true) }

  const enviarMail = async () => {
    const destino = para.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) { setAviso('Escribí un mail válido.'); return }
    setOcupado('mail')
    setAviso('')
    try {
      const g = await generar()
      if (!g.ok) { setAviso(g.motivo); return }
      await enviarComprobantePorMail({
        para: destino, asunto: asunto.trim() || titulo, mensaje: mensaje.trim(), nombreArchivo: g.nombre, pdf: g.blob,
        comprobante: mail.comprobante, clienteUid: mail.clienteUid, clienteNombre: mail.clienteNombre, conCopia,
      })
      setEnviadoA(destino)
    } catch (err) {
      reportError(err, { origen: 'MenuCompartirPdf.mail', titulo })
      const msg = err instanceof Error && err.message && !/internal/i.test(err.message) ? err.message : 'No se pudo enviar el mail. Revisá la señal y probá de nuevo.'
      setAviso(msg)
    } finally {
      setOcupado(null)
    }
  }

  const puedeCompartir = puedeCompartirArchivos()

  return (
    <>
      {trigger(() => { setAbierto(true); setAviso('') }, ocupado !== null)}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
          <div role="dialog" aria-label={titulo} className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">{titulo}</p>
              <button type="button" onClick={cerrar} aria-label="Cerrar" className="text-gray-400 p-1 -m-1"><X size={18} /></button>
            </div>
            {puedeCompartir && (
              <button type="button" onClick={() => correr('compartir')} disabled={ocupado !== null}
                className="w-full flex items-center gap-3 rounded-xl border border-[#D3D1C7] px-3 py-3 text-left text-sm text-gray-900 active:bg-[#F8F7F2] disabled:opacity-50">
                <Share2 size={18} className="text-accent shrink-0" />
                <span><span className="font-medium">WhatsApp u otra app</span><br /><span className="text-xs text-gray-500">Se abre el menú del celular con el PDF adjunto</span></span>
              </button>
            )}
            <button type="button" onClick={abrirMail} disabled={ocupado !== null}
              className="w-full flex items-center gap-3 rounded-xl border border-[#D3D1C7] px-3 py-3 text-left text-sm text-gray-900 active:bg-[#F8F7F2] disabled:opacity-50">
              <Mail size={18} className="text-accent shrink-0" />
              <span><span className="font-medium">Mail al cliente</span><br /><span className="text-xs text-gray-500">{mail.para ? `A ${mail.para}` : 'El cliente no tiene mail en Tango: lo escribís vos'}</span></span>
            </button>
            <button type="button" onClick={() => correr('descargar')} disabled={ocupado !== null}
              className="w-full flex items-center gap-3 rounded-xl border border-[#D3D1C7] px-3 py-3 text-left text-sm text-gray-900 active:bg-[#F8F7F2] disabled:opacity-50">
              <FileDown size={18} className="text-accent shrink-0" />
              <span><span className="font-medium">Descargar</span><br /><span className="text-xs text-gray-500">Guarda el PDF en este dispositivo</span></span>
            </button>
            {ocupado && ocupado !== 'mail' && <p className="text-xs text-gray-500">Generando el PDF…</p>}
            {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
          </div>
        </div>
      )}

      <Modal open={mailAbierto} onClose={() => { if (ocupado !== 'mail') setMailAbierto(false) }} title={`Enviar por mail — ${titulo}`} variant="light">
        {enviadoA ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-900">Enviado a <span className="font-semibold">{enviadoA}</span>.</p>
            <Button onClick={() => setMailAbierto(false)} className="w-full">Listo</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-gray-500">Para</span>
              <input type="email" value={para} onChange={(e) => setPara(e.target.value)} placeholder="cliente@empresa.com" autoComplete="off"
                className="mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
              {mail.para && para.trim().toLowerCase() === mail.para.toLowerCase() && <span className="text-[11px] text-gray-400">Mail de la ficha de Tango</span>}
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Asunto</span>
              <input type="text" value={asunto} onChange={(e) => setAsunto(e.target.value)}
                className="mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Mensaje</span>
              <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3}
                className="mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={conCopia} onChange={(e) => setConCopia(e.target.checked)} className="accent-accent" />
              Mandarme una copia
            </label>
            {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMailAbierto(false)} disabled={ocupado === 'mail'} className="flex-1">Cancelar</Button>
              <Button onClick={enviarMail} loading={ocupado === 'mail'} disabled={ocupado !== null} className="flex-1"><Mail size={14} className="mr-1.5" /> Enviar</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
