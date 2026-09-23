import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, ExternalLink, Printer, Share2, X } from 'lucide-react'
import { descargarArchivo } from '@/utils/compartir'
import { reportError } from '@/services/observability'
import type { EnvioComprobante } from '@/utils/envioComprobante'

// La hoja de envío se carga recién al tocar Enviar: arrastra el armado de
// comprobantes (facturas, remitos, QR: ~65 KB) y el visor vive en App.tsx,
// así que con el import directo todo eso entraba en el chunk del login
// (auditoría 2026-09-22).
const EnviarComprobanteSheet = lazy(() => import('./EnviarComprobanteSheet'))

/**
 * VISOR DE COMPROBANTES (2026-09-15, pedido de Ariel: "erradicar la descarga
 * automática forzada; siempre un visor previo en pantalla, y la descarga solo si
 * el usuario hace clic en Descargar").
 *
 * Un solo visor para toda la app, montado una vez en AppContent (igual que
 * VerComoBanner). Cualquier pantalla lo abre con `useVisorComprobante().abrir(...)`
 * pasándole el archivo ya generado en memoria (Blob) o una URL (foto de Storage).
 * Muestra PDF en un iframe (blob:) o una imagen; Descargar, Imprimir y Enviar
 * son clics explícitos dentro del visor. Enviar abre la hoja de WhatsApp / mail
 * (`EnviarComprobanteSheet`) con el contacto de la ficha de Tango precargado. Cierra con la X, Esc, clic en el velo o
 * el gesto atrás del teléfono.
 *
 * Nada de esto descarga solo: el blob: URL se crea al abrir y se revoca al cerrar.
 */

export interface ComprobanteAbierto {
  /** El archivo ya generado. Uno de los dos. */
  blob?: Blob
  url?:  string
  /** Se infiere del blob/URL si no viene. */
  tipo?: 'pdf' | 'imagen'
  /** Nombre con el que se descarga (con extensión). */
  nombre:     string
  titulo:     string
  subtitulo?: string
  /** De dónde salió: "Generado en el teléfono", "Tango", "Archivo de administración"… */
  fuente?:    string
  /** Impresión propia (p. ej. la Eliprinter de ventanilla con su modo). Sin esto, imprime el iframe. */
  onImprimir?: (blob: Blob) => Promise<unknown> | unknown
  /** Para quién es y qué comprobante es (precarga celular y mail de Tango). Sin esto, se manda "a mano". */
  envio?:      EnvioComprobante
  /** Al cerrar (X, Esc, atrás). Sirve para encadenar otro papel: abrir() adentro. */
  onCerrar?:   () => void
}

interface Contexto {
  abrir:  (c: ComprobanteAbierto) => void
  cerrar: () => void
}

const Ctx = createContext<Contexto | null>(null)

export function useVisorComprobante(): Contexto {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVisorComprobante() necesita <VisorComprobanteProvider> arriba')
  return ctx
}

/**
 * Abre en el visor un comprobante ya generado con la forma { ok, blob, nombre, titulo }
 * (generarComprobanteVenta, obtenerFacturaPdf…). Devuelve '' o el motivo para mostrar.
 */
export function abrirGenerado(
  abrir: Contexto['abrir'],
  g: { ok: true; blob: Blob; nombre: string; titulo: string } | { ok: false; motivo: string },
  extra: Partial<Pick<ComprobanteAbierto, 'subtitulo' | 'fuente' | 'envio' | 'onImprimir'>> = {},
): string {
  if (!g.ok) return g.motivo
  abrir({ blob: g.blob, nombre: g.nombre, titulo: g.titulo, ...extra })
  return ''
}

const esImagen = (c: ComprobanteAbierto): boolean =>
  c.tipo === 'imagen' || (!c.tipo && (c.blob ? c.blob.type.startsWith('image/') : /\.(jpe?g|png|webp|gif)(\?|$)/i.test(c.url ?? '')))

/** ¿El navegador muestra PDFs adentro de un iframe? Chrome/Firefox lo dicen; iOS instalada como app, no. */
function puedeMostrarPdf(): boolean {
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean; standalone?: boolean }
  if (typeof nav.pdfViewerEnabled === 'boolean') return nav.pdfViewerEnabled
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent)
  if (ios && nav.standalone) return false
  return true
}

export function VisorComprobanteProvider({ children }: { children: ReactNode }) {
  const [actual, setActual] = useState<ComprobanteAbierto | null>(null)
  const actualRef = useRef<ComprobanteAbierto | null>(null)
  const abrir = useCallback((c: ComprobanteAbierto) => { actualRef.current = c; setActual(c) }, [])
  const cerrar = useCallback(() => {
    const prev = actualRef.current
    actualRef.current = null
    setActual(null)
    prev?.onCerrar?.()
  }, [])
  const valor = useMemo(() => ({ abrir, cerrar }), [abrir, cerrar])
  return (
    <Ctx.Provider value={valor}>
      {children}
      {actual && <Visor c={actual} onCerrar={cerrar} />}
    </Ctx.Provider>
  )
}

function Visor({ c, onCerrar }: { c: ComprobanteAbierto; onCerrar: () => void }) {
  const imagen = esImagen(c)
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const sinVisorPdf = !imagen && !puedeMostrarPdf()

  // blob: URL viva mientras el visor está abierto.
  const url = useMemo(() => (c.blob ? URL.createObjectURL(c.blob) : c.url ?? ''), [c.blob, c.url])
  useEffect(() => () => { if (c.blob) URL.revokeObjectURL(url) }, [c.blob, url])

  // Esc, foco inicial, sin scroll de fondo, y el gesto "atrás" del teléfono cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onKey)
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cerrarRef.current?.focus()
    history.pushState({ visorComprobante: true }, '')
    const onPop = () => onCerrar()
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
      window.removeEventListener('popstate', onPop)
      if (history.state?.visorComprobante) history.back()
    }
  }, [onCerrar])

  const blobActual = async (): Promise<Blob> => {
    if (c.blob) return c.blob
    const r = await fetch(url)
    return r.blob()
  }

  const descargar = async () => {
    try { descargarArchivo(await blobActual(), c.nombre) } catch (err) { reportError(err, { origen: 'VisorComprobante', accion: 'descargar' }); setAviso('No se pudo descargar. Probá de nuevo.') }
  }
  const imprimir = async () => {
    setAviso(''); setOcupado(true)
    try {
      if (c.onImprimir) { await c.onImprimir(await blobActual()); return }
      const w = iframeRef.current?.contentWindow
      if (w && !sinVisorPdf && !imagen) { w.focus(); w.print(); return }
      // Imagen o sin visor de PDF: la pestaña nueva tiene su propio Imprimir.
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      reportError(err, { origen: 'VisorComprobante', accion: 'imprimir' })
      setAviso('No se pudo imprimir desde acá: abrilo en otra pestaña e imprimí desde ahí.')
    } finally { setOcupado(false) }
  }

  const btn = 'h-11 min-w-11 px-3 inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50'
  const btnSec = `${btn} border-[#D3D1C7] bg-white text-gray-800`
  const btnPri = `${btn} border-accent bg-accent text-white`

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/55 flex items-center justify-center sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }} role="dialog" aria-modal="true" aria-label={c.titulo}>
      <div className="bg-white w-full h-full sm:h-[92vh] sm:max-h-[1000px] sm:max-w-[960px] sm:rounded-2xl sm:border sm:border-[#D3D1C7] sm:shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E7E5DC] min-h-[60px]">
          <div className="flex-1 min-w-0 pl-1">
            <p className="text-[15px] font-bold text-gray-900 truncate" title={c.titulo}>{c.titulo}</p>
            {c.subtitulo && <p className="text-xs text-secundario truncate" title={c.subtitulo}>{c.subtitulo}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setEnviando(true)} disabled={ocupado} className={btnSec} title="Enviar por WhatsApp o mail">
              <Share2 size={18} /><span className="hidden sm:inline">Enviar</span>
            </button>
            <button type="button" onClick={imprimir} disabled={ocupado} className={btnSec} title="Imprimir">
              <Printer size={18} /><span className="hidden sm:inline">Imprimir</span>
            </button>
            <button type="button" onClick={descargar} disabled={ocupado} className={btnPri} title="Descargar">
              <Download size={18} /><span className="hidden sm:inline">Descargar</span>
            </button>
            <button ref={cerrarRef} type="button" onClick={onCerrar} className={`${btnSec} px-0 w-11`} title="Cerrar (Esc)" aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#E9E7E0] relative">
          {imagen ? (
            <div className="h-full flex items-center justify-center p-4">
              <img src={url} alt={c.titulo} className="max-w-full max-h-full object-contain" />
            </div>
          ) : sinVisorPdf ? (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div className="bg-white border border-[#D3D1C7] rounded-2xl p-5 max-w-sm">
                <p className="text-[15px] font-semibold text-gray-900 mb-1">Este navegador no muestra el PDF acá adentro</p>
                <p className="text-sm text-secundario mb-4">Abrilo en otra pestaña o descargalo. El archivo ya está listo.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <a href={url} target="_blank" rel="noopener" className={btnSec}><ExternalLink size={18} /> Abrir en otra pestaña</a>
                  <button type="button" onClick={descargar} className={btnPri}><Download size={18} /> Descargar</button>
                </div>
              </div>
            </div>
          ) : (
            <iframe ref={iframeRef} src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={c.titulo} className="w-full h-full border-0 block" />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-[#E7E5DC] text-xs text-secundario">
          <span className="truncate">{aviso ? <span className="text-amber-700">{aviso}</span> : (c.fuente ?? 'Generado en este dispositivo')}</span>
          <span className="hidden sm:inline shrink-0"><kbd className="border border-[#D3D1C7] rounded px-1.5 text-[11px]">Esc</kbd> cierra · no se guarda hasta que toques Descargar</span>
        </div>
      </div>
      {enviando && (
        <Suspense fallback={null}>
          <EnviarComprobanteSheet titulo={c.titulo} nombre={c.nombre} subtitulo={c.subtitulo} envio={c.envio} blob={blobActual} onCerrar={() => setEnviando(false)} />
        </Suspense>
      )}
    </div>
  )
}
