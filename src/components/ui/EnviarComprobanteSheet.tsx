import { useEffect, useState } from 'react'
import { Check, Mail, MessageCircle, Share2, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { getUserDocument } from '@/services/userService'
import { getEmailClienteTango } from '@/services/tangoComprobantesService'
import { enviarComprobantePorMail } from '@/services/envioComprobanteService'
import { publicarParaCompartir } from '@/services/compartirComprobanteService'
import { reportError } from '@/services/observability'
import { compartirArchivo, puedeCompartirArchivos } from '@/utils/compartir'
import { normalizarTelefonoAR, urlWhatsApp } from '@/utils/contacto'
import { EMAIL_RE, contactoDePerfil, textoWhatsApp, type EnvioComprobante } from '@/utils/envioComprobante'

// Hoja "Enviar" del visor de comprobantes (2026-09-15, pedido de Ariel): dos
// caminos, WhatsApp y mail, con el celular y el mail de la ficha de Tango del
// cliente precargados y EDITABLES antes de mandar.
// - WhatsApp: el PDF se publica en Storage y el chat se abre con el mensaje y
//   el link (wa.me no adjunta archivos a un número). La pestaña se abre en el
//   mismo clic, antes de subir, para que el navegador no la bloquee.
// - Mail: lo manda el servidor con el PDF adjunto (`enviarComprobantePorMail`),
//   igual que desde el menú Compartir.
// - "Otra app": el menú del sistema con el archivo adjunto, donde exista.

type Canal = 'whatsapp' | 'mail'

const CAMPO = 'mt-1 w-full h-11 bg-white border border-[#D3D1C7] rounded-lg px-3 text-base text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
const AREA  = 'mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

const formatoInternacional = (n: string) => `+${n.slice(0, 2)} ${n.slice(2, 3)} ${n.slice(3, 5)} ${n.slice(5, 9)}-${n.slice(9)}`

export default function EnviarComprobanteSheet({ titulo, nombre, envio, blob, onCerrar }: {
  titulo:   string
  nombre:   string
  envio:    EnvioComprobante
  /** El archivo, ya generado (lo tiene el visor). */
  blob:     () => Promise<Blob>
  onCerrar: () => void
}) {
  const [canal, setCanal] = useState<Canal>('whatsapp')
  const [telefono, setTelefono] = useState(envio.telefono ?? '')
  const [mail, setMail] = useState(envio.para ?? '')
  const [asunto, setAsunto] = useState(envio.asunto)
  const [mensaje, setMensaje] = useState(envio.mensaje ?? '')
  const [conCopia, setConCopia] = useState(false)
  // Lo que vino de la ficha, para rotular "de Tango" o "cambiado".
  const [deTango, setDeTango] = useState({ telefono: envio.telefono ?? '', mail: envio.para ?? '' })
  const [cargando, setCargando] = useState(!!envio.clienteUid || (!envio.para && !!envio.resolverPara))
  const [ocupado, setOcupado] = useState<'wa' | 'mail' | 'otra' | null>(null)
  const [aviso, setAviso] = useState('')
  const [enviadoA, setEnviadoA] = useState('')
  const [linkPdf, setLinkPdf] = useState('')
  const [linkWa, setLinkWa] = useState('')

  // Celular y mail de la ficha del cliente (los carga la sync de Tango). Solo
  // rellena lo que vino vacío: si la pantalla ya sabía el contacto, se respeta.
  useEffect(() => {
    if (!cargando) return
    let vivo = true
    ;(async () => {
      let tel = envio.telefono ?? ''
      let m = envio.para ?? ''
      if (envio.clienteUid) {
        const perfil = await getUserDocument(envio.clienteUid).catch(() => null)
        const c = contactoDePerfil(perfil)
        if (!tel) tel = c.telefono
        if (!m) m = (await (envio.resolverPara ? envio.resolverPara() : getEmailClienteTango(envio.clienteUid)).catch(() => '')) || c.mail
      } else if (!m && envio.resolverPara) {
        m = await envio.resolverPara().catch(() => '')
      }
      if (!vivo) return
      setDeTango({ telefono: tel, mail: m })
      setTelefono((prev) => prev.trim() ? prev : tel)
      setMail((prev) => prev.trim() ? prev : m)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [cargando, envio])

  const normalizado = normalizarTelefonoAR(telefono)

  const abrirWhatsApp = async () => {
    if (!normalizado) { setAviso('Escribí un celular válido: código de área y número, sin el 0 ni el 15.'); return }
    setAviso(''); setLinkWa(''); setOcupado('wa')
    // La pestaña se abre EN el clic: después de subir el archivo el navegador la bloquearía como popup.
    const ventana = window.open('', '_blank')
    try {
      const link = linkPdf || await publicarParaCompartir(await blob(), nombre)
      setLinkPdf(link)
      const url = urlWhatsApp(telefono, textoWhatsApp({ titulo, mensaje, link, clienteNombre: envio.clienteNombre })) ?? ''
      if (ventana) ventana.location.href = url
      else setLinkWa(url)
      setEnviadoA(`WhatsApp ${formatoInternacional(normalizado)}`)
    } catch (err) {
      ventana?.close()
      reportError(err, { origen: 'EnviarComprobanteSheet', accion: 'whatsapp' })
      setAviso('No se pudo publicar el PDF para armar el link. Revisá la señal y probá de nuevo.')
    } finally { setOcupado(null) }
  }

  const enviarMail = async () => {
    const destino = mail.trim().toLowerCase()
    if (!EMAIL_RE.test(destino)) { setAviso('Escribí un mail válido.'); return }
    setAviso(''); setOcupado('mail')
    try {
      await enviarComprobantePorMail({
        para: destino, asunto: asunto.trim() || titulo, mensaje: mensaje.trim(), nombreArchivo: nombre, pdf: await blob(),
        comprobante: envio.comprobante, clienteUid: envio.clienteUid, clienteNombre: envio.clienteNombre, conCopia,
        presentacion: envio.presentacion ?? { titulo, filas: [] },
        ...(envio.venta ? { venta: envio.venta } : {}),
      })
      setEnviadoA(destino)
    } catch (err) {
      reportError(err, { origen: 'EnviarComprobanteSheet', accion: 'mail', titulo })
      const msg = err instanceof Error && err.message && !/internal/i.test(err.message) ? err.message : 'No se pudo enviar el mail. Revisá la señal y probá de nuevo.'
      setAviso(msg)
    } finally { setOcupado(null) }
  }

  const otraApp = async () => {
    setAviso(''); setOcupado('otra')
    try {
      const r = await compartirArchivo(await blob(), nombre, { titulo, texto: asunto })
      if (r === 'compartido') onCerrar()
      else if (r === 'descargado') setAviso('Este dispositivo no puede compartir archivos: se descargó el PDF.')
    } catch (err) {
      reportError(err, { origen: 'EnviarComprobanteSheet', accion: 'otra' })
      setAviso('No se pudo compartir.')
    } finally { setOcupado(null) }
  }

  const tab = (activo: boolean) => `flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors ${activo ? 'bg-white text-gray-900 shadow-sm border border-[#D3D1C7]' : 'text-secundario'}`
  const pistaTelefono = cargando ? 'Buscando el celular en la ficha de Tango…'
    : !telefono.trim() ? (deTango.telefono ? '' : 'El cliente no tiene celular en Tango: escribilo vos.')
    : telefono.trim() === deTango.telefono ? 'Celular de la ficha de Tango'
    : deTango.telefono ? `Cambiado. En Tango: ${deTango.telefono}` : 'Celular escrito a mano'
  const pistaMail = cargando ? 'Buscando el mail en la ficha de Tango…'
    : !mail.trim() ? (deTango.mail ? '' : 'El cliente no tiene mail en Tango: escribilo vos.')
    : mail.trim().toLowerCase() === deTango.mail ? 'Mail de la ficha de Tango'
    : deTango.mail ? `Cambiado. En Tango: ${deTango.mail}` : 'Mail escrito a mano'

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar() } }}>
      <div role="dialog" aria-modal="true" aria-label={`Enviar ${titulo}`}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-3 max-h-[92vh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-gray-900">Enviar</p>
            <p className="text-xs text-secundario truncate" title={titulo}>{titulo}{envio.clienteNombre ? ` · ${envio.clienteNombre}` : ''}</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-11 h-11 -m-2 shrink-0 flex items-center justify-center text-secundario"><X size={20} /></button>
        </div>

        {enviadoA ? (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-3 rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] px-3 py-3">
              <Check size={20} className="text-accent shrink-0" />
              <p className="text-sm text-gray-900">{enviadoA.startsWith('WhatsApp') ? <>Se abrió <span className="font-semibold">{enviadoA}</span> con el mensaje y el link al PDF.</> : <>Enviado a <span className="font-semibold">{enviadoA}</span>.</>}</p>
            </div>
            {linkWa && (
              <a href={linkWa} target="_blank" rel="noopener noreferrer" className="block text-center rounded-xl bg-[#25D366] px-3 py-3 text-sm font-semibold text-white">
                Tocá acá para abrir WhatsApp
              </a>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setEnviadoA(''); setLinkWa('') }} className="flex-1">Enviar por otro medio</Button>
              <Button onClick={onCerrar} className="flex-1">Listo</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-1 rounded-xl bg-[#F1EFE8] p-1">
              <button type="button" onClick={() => { setCanal('whatsapp'); setAviso('') }} className={tab(canal === 'whatsapp')}><MessageCircle size={16} /> WhatsApp</button>
              <button type="button" onClick={() => { setCanal('mail'); setAviso('') }} className={tab(canal === 'mail')}><Mail size={16} /> Mail</button>
            </div>

            {canal === 'whatsapp' ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-secundario">Celular</span>
                  <input type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="11 5555-0000" autoComplete="off" className={CAMPO} />
                  <span className="block text-[11px] text-secundario mt-1">
                    {pistaTelefono}{normalizado && telefono.trim() ? ` · se manda a ${formatoInternacional(normalizado)}` : ''}
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs text-secundario">Mensaje</span>
                  <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} className={AREA} />
                </label>
                <p className="text-xs text-secundario">Se abre el chat con el mensaje y un link para bajar el PDF (válido 60 días). Podés retocarlo antes de mandarlo.</p>
                {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
                <Button onClick={abrirWhatsApp} loading={ocupado === 'wa'} disabled={ocupado !== null || cargando} className="w-full">
                  <MessageCircle size={16} className="mr-1.5" /> Abrir WhatsApp
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-secundario">Para</span>
                  <input type="email" inputMode="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="cliente@empresa.com" autoComplete="off" className={CAMPO} />
                  <span className="block text-[11px] text-secundario mt-1">{pistaMail}</span>
                </label>
                <label className="block">
                  <span className="text-xs text-secundario">Asunto</span>
                  <input type="text" value={asunto} onChange={(e) => setAsunto(e.target.value)} className={CAMPO} />
                </label>
                <label className="block">
                  <span className="text-xs text-secundario">Mensaje</span>
                  <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} className={AREA} />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={conCopia} onChange={(e) => setConCopia(e.target.checked)} className="accent-accent" />
                  Mandarme una copia
                </label>
                <p className="text-xs text-secundario">Va con el PDF adjunto desde WebMail@redonhielo.com.ar.</p>
                {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
                <Button onClick={enviarMail} loading={ocupado === 'mail'} disabled={ocupado !== null || cargando} className="w-full">
                  <Mail size={16} className="mr-1.5" /> Enviar mail
                </Button>
              </div>
            )}

            {puedeCompartirArchivos() && (
              <button type="button" onClick={otraApp} disabled={ocupado !== null}
                className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-[#D3D1C7] text-sm font-semibold text-gray-800 disabled:opacity-50">
                <Share2 size={16} className="text-accent" /> Otra app del celular (con el archivo adjunto)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
