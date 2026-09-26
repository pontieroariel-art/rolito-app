import { useEffect, useRef, useState } from 'react'
import { reportError } from '@/services/observability'

// Páginas de un PDF dibujadas a lo ancho del contenedor (relevamiento de
// responsividad, 2026-09-26). En Android el navegador no muestra PDF adentro de
// la página y el visor quedaba en "abrilo en otra pestaña"; en un celular con
// visor, el de escritorio metido en un marco angosto mostraba la hoja más ancha
// que la pantalla, con la fecha y el CUIT cortados. Acá cada página se dibuja con
// pdf.js del ancho disponible, todas una abajo de la otra.
// pdf.js pesa ~450 KB: se carga recién al abrir un comprobante en el celular.

export default function PdfPaginas({ url, titulo, onFallo }: { url: string; titulo: string; onFallo: () => void }) {
  const contRef = useRef<HTMLDivElement>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    let destruir: (() => void) | undefined
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
        const data = await (await fetch(url)).arrayBuffer()
        const tarea = pdfjs.getDocument({ data })
        destruir = () => { void tarea.destroy() }
        const doc = await tarea.promise
        const cont = contRef.current
        if (!vivo || !cont) return
        cont.replaceChildren()
        const ancho = Math.max(200, cont.clientWidth - 16)
        // El doble de la pantalla (tope 3): al agrandar con dos dedos se sigue leyendo.
        const dpr = Math.min((window.devicePixelRatio || 1) * 2, 3)
        for (let n = 1; n <= doc.numPages; n++) {
          const pagina = await doc.getPage(n)
          if (!vivo) return
          const escala = ancho / pagina.getViewport({ scale: 1 }).width
          const vista = pagina.getViewport({ scale: escala * dpr })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vista.width)
          canvas.height = Math.floor(vista.height)
          canvas.style.width = `${ancho}px`
          canvas.style.height = `${Math.floor(vista.height / dpr)}px`
          canvas.className = 'block mx-auto mb-2 bg-white shadow-sm'
          canvas.setAttribute('aria-label', `${titulo}, página ${n} de ${doc.numPages}`)
          canvas.setAttribute('role', 'img')
          cont.appendChild(canvas)
          await pagina.render({ canvas, viewport: vista }).promise
          if (n === 1 && vivo) setCargando(false)
        }
      } catch (err) {
        reportError(err, { origen: 'PdfPaginas', accion: 'dibujar el PDF' })
        if (vivo) onFallo()
      }
    })()
    return () => { vivo = false; destruir?.() }
  }, [url, titulo, onFallo])

  return (
    <div className="h-full overflow-y-auto p-2">
      {cargando && <p className="text-sm text-secundario text-center py-10">Preparando el comprobante…</p>}
      <div ref={contRef} />
    </div>
  )
}
