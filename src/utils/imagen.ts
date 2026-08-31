// Redimensiona/comprime una imagen en el cliente antes de subirla a Storage.
// Objetivo: miniaturas livianas (~20-50 KB) para la botonera de venta, que carga
// en el celular del chofer. Sin librerías: usa canvas.

async function cargarBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` respeta la orientación EXIF (fotos sacadas con el celular).
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* algunos navegadores no soportan la opción → fallback a <img> */
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

export async function resizeImage(file: File, maxPx = 480, quality = 0.8): Promise<Blob> {
  const bitmap = await cargarBitmap(file)
  const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width  * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) bitmap.close()

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('No se pudo procesar la imagen')
  return blob
}
