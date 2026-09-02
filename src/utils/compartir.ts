// Compartir un archivo desde la app.
//
// En el celular del chofer abre el menú del sistema —WhatsApp, mail, lo que
// tenga instalado— con el archivo adjunto. En una compu de escritorio, o si el
// navegador no lo soporta, cae a descargarlo, que siempre funciona.
//
// Hay dos capacidades distintas y conviene no confundirlas: `navigator.share`
// existe en más lugares de los que aceptan ARCHIVOS. Por eso se pregunta por
// `canShare({ files })` y no solo por `share`.

export type ResultadoCompartir = 'compartido' | 'descargado' | 'cancelado'

export async function compartirArchivo(
  blob: Blob,
  nombreArchivo: string,
  opciones: { titulo: string; texto?: string } = { titulo: '' },
): Promise<ResultadoCompartir> {
  const file = new File([blob], nombreArchivo, { type: blob.type || 'application/pdf' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opciones.titulo, text: opciones.texto })
      return 'compartido'
    } catch (err) {
      // El usuario cerró el menú: no es un error, no hay que caer a descargar.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelado'
      // Cualquier otra falla sí justifica el plan B.
    }
  }

  descargarArchivo(blob, nombreArchivo)
  return 'descargado'
}

export function descargarArchivo(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sin esto el blob queda en memoria hasta que se recargue la página.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** ¿El navegador puede compartir archivos? Sirve para rotular el botón. */
export function puedeCompartirArchivos(): boolean {
  try {
    const prueba = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' })
    return Boolean(navigator.canShare?.({ files: [prueba] }))
  } catch {
    return false
  }
}
