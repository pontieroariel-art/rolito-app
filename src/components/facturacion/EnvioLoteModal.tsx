import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Mail } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { enviarComprobantesPorMail, MAX_ADJUNTOS_MAIL } from '@/services/envioComprobanteService'
import { generarPdfsLote, type FallaDeItem, type PdfDeItem, type ProgresoLote } from '@/services/comprobantesLoteService'
import { reportError } from '@/services/observability'
import { armarMailLote, describirLote, resumenLote, type ItemLote } from '@/utils/comprobantesLote'
import type { UserProfile } from '@/types'

// Mail al cliente con varios comprobantes adjuntos (2026-09-10, facturación):
// destinatario precargado con el mail de Tango, asunto y mensaje armados con
// lo elegido, y un solo envío por Resend con todos los PDF. Los PDF se generan
// recién al confirmar, de a uno y mostrando el avance; si alguno no se puede
// armar (sin CAE, no está en la app), se avisa y se ofrece mandar el resto.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INPUT = 'mt-1 w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

type Fase =
  | { tipo: 'form' }
  | { tipo: 'generando'; progreso: ProgresoLote }
  | { tipo: 'revisar'; generados: PdfDeItem[]; fallidos: FallaDeItem[] }
  | { tipo: 'enviando' }
  | { tipo: 'enviado'; cantidad: number; para: string }

export default function EnvioLoteModal({ abierto, onClose, items, cliente, email, onEnviado }: {
  abierto:  boolean
  onClose:  () => void
  items:    ItemLote[]
  cliente:  Pick<UserProfile, 'uid' | 'razonSocial'>
  /** Mail de la ficha de Tango del cliente ('' si no tiene). */
  email:    string
  onEnviado?: () => void
}) {
  const mail = useMemo(() => armarMailLote(items, cliente), [items, cliente])
  const resumen = useMemo(() => resumenLote(items), [items])
  const [para, setPara] = useState(email)
  const [asunto, setAsunto] = useState(mail.asunto)
  const [mensaje, setMensaje] = useState(mail.mensaje)
  const [conCopia, setConCopia] = useState(false)
  const [fase, setFase] = useState<Fase>({ tipo: 'form' })
  const [aviso, setAviso] = useState('')
  const cancelado = useRef(false)

  // Cada apertura arranca limpia, con lo elegido en ese momento. Solo al abrir:
  // si mientras está abierto llega un refresco de Tango y cambian los ítems, no
  // hay que pisar lo que la persona ya escribió.
  const inicial = useRef({ email, mail })
  inicial.current = { email, mail }
  useEffect(() => {
    if (!abierto) return
    setPara(inicial.current.email); setAsunto(inicial.current.mail.asunto); setMensaje(inicial.current.mail.mensaje); setConCopia(false)
    setFase({ tipo: 'form' }); setAviso(''); cancelado.current = false
  }, [abierto])

  const ocupado = fase.tipo === 'generando' || fase.tipo === 'enviando'

  const cerrar = () => {
    if (fase.tipo === 'enviando') return
    cancelado.current = true
    onClose()
  }

  const enviar = async (generados: PdfDeItem[]) => {
    const destino = para.trim().toLowerCase()
    setFase({ tipo: 'enviando' })
    setAviso('')
    try {
      const enviados = generados.map((g) => g.item)
      const m = armarMailLote(enviados, cliente)
      await enviarComprobantesPorMail({
        para: destino, asunto: asunto.trim() || m.asunto, mensaje: mensaje.trim(),
        adjuntos: generados.map((g) => ({ nombreArchivo: g.nombre, pdf: g.blob })),
        comprobante: m.comprobante, comprobantes: m.comprobantes,
        clienteUid: cliente.uid, clienteNombre: cliente.razonSocial, conCopia,
        presentacion: m.presentacion,
      })
      setFase({ tipo: 'enviado', cantidad: generados.length, para: destino })
      onEnviado?.()
    } catch (err) {
      reportError(err, { origen: 'EnvioLoteModal', cantidad: generados.length })
      const msg = err instanceof Error && err.message && !/internal/i.test(err.message) ? err.message : 'No se pudo enviar el mail. Probá de nuevo en un rato.'
      setAviso(msg)
      setFase({ tipo: 'form' })
    }
  }

  const generarYEnviar = async () => {
    const destino = para.trim().toLowerCase()
    if (!EMAIL_RE.test(destino)) { setAviso('Escribí un mail válido.'); return }
    if (items.length > MAX_ADJUNTOS_MAIL) { setAviso(`Se pueden mandar hasta ${MAX_ADJUNTOS_MAIL} comprobantes por mail: sacá algunos o mandalos en dos tandas.`); return }
    setAviso('')
    cancelado.current = false
    setFase({ tipo: 'generando', progreso: { hecho: 0, total: items.length, actual: items[0] ?? null } })
    const r = await generarPdfsLote(items, (p) => setFase({ tipo: 'generando', progreso: p }), () => cancelado.current)
    if (cancelado.current) return
    if (!r.generados.length) {
      setAviso(r.fallidos.length === 1 ? r.fallidos[0].motivo : 'No se pudo armar ninguno de los PDF elegidos.')
      setFase({ tipo: 'form' })
      return
    }
    if (r.fallidos.length) { setFase({ tipo: 'revisar', generados: r.generados, fallidos: r.fallidos }); return }
    await enviar(r.generados)
  }

  return (
    <Modal open={abierto} onClose={cerrar} title={`Enviar por mail — ${describirLote(resumen)}`} variant="light">
      {fase.tipo === 'enviado' ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-900">Enviado a <span className="font-semibold">{fase.para}</span> con {fase.cantidad} {fase.cantidad === 1 ? 'PDF adjunto' : 'PDF adjuntos'}.</p>
          <Button onClick={onClose} className="w-full">Listo</Button>
        </div>
      ) : fase.tipo === 'generando' ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-900">Generando los PDF… {fase.progreso.hecho} de {fase.progreso.total}</p>
          {fase.progreso.actual && <p className="text-xs text-gray-500 truncate">{fase.progreso.actual.titulo}</p>}
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${fase.progreso.total ? Math.round((fase.progreso.hecho / fase.progreso.total) * 100) : 0}%` }} />
          </div>
          <Button variant="outline" onClick={cerrar} className="w-full">Cancelar</Button>
        </div>
      ) : fase.tipo === 'revisar' ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{fase.fallidos.length === 1 ? 'Un comprobante no se pudo armar' : `${fase.fallidos.length} comprobantes no se pudieron armar`}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {fase.fallidos.map((f) => <li key={f.item.clave}><span className="font-medium">{f.item.titulo}</span>: {f.motivo}</li>)}
              </ul>
            </div>
          </div>
          <p className="text-sm text-gray-700">¿Mandamos igual {fase.generados.length === 1 ? 'el que sí se armó' : `los ${fase.generados.length} que sí se armaron`}?</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setFase({ tipo: 'form' })} className="flex-1">Volver</Button>
            <Button onClick={() => enviar(fase.generados)} className="flex-1"><Mail size={14} className="mr-1.5" /> Enviar {fase.generados.length}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Va un solo mail con {items.length === 1 ? 'el PDF adjunto' : `${items.length} PDF adjuntos`}: {describirLote(resumen)}.</p>
          <label className="block">
            <span className="text-xs text-gray-500">Para</span>
            <input type="email" value={para} onChange={(e) => setPara(e.target.value)} placeholder="cliente@empresa.com" autoComplete="off" className={INPUT} />
            {email && para.trim().toLowerCase() === email.toLowerCase()
              ? <span className="text-[11px] text-gray-400">Mail de la ficha de Tango</span>
              : !email ? <span className="text-[11px] text-amber-700">Este cliente no tiene mail en Tango: escribilo vos.</span> : null}
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Asunto</span>
            <input type="text" value={asunto} onChange={(e) => setAsunto(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Mensaje</span>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} className={INPUT} />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={conCopia} onChange={(e) => setConCopia(e.target.checked)} className="accent-accent" />
            Mandarme una copia
          </label>
          {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={cerrar} disabled={ocupado} className="flex-1">Cancelar</Button>
            <Button onClick={generarYEnviar} loading={ocupado} disabled={ocupado || items.length === 0} className="flex-1">
              <Mail size={14} className="mr-1.5" /> Enviar {items.length > 1 ? items.length : ''}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
