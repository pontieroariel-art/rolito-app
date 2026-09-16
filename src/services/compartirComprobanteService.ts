import { auth } from './firebase'
import { obtenerStorage } from './storage'
import { nombrePublicado } from '@/utils/envioComprobante'

// Publicar un comprobante para mandarlo por WhatsApp a un número (2026-09-15).
// WhatsApp no deja adjuntar un archivo a un chat elegido por número desde la
// web: `wa.me/<número>?text=` abre el chat con el texto escrito, nada más. Por
// eso el PDF se sube a Storage (`compartidos/{uid}/{fecha-nombre}`) y en el
// texto va el link de descarga de Firebase: lleva su propio token, así el
// cliente lo abre sin usuario. Sigue siendo una URL imposible de adivinar,
// igual que las fotos del catálogo o de un ticket. Quién lo publicó queda en
// la ruta (el uid), y la regla de Storage solo deja escribir en la propia.

/** Sube el archivo y devuelve el link público (con token) para pegar en el chat. */
export async function publicarParaCompartir(blob: Blob, nombreArchivo: string): Promise<string> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Sin sesión')
  const { storage, ref, uploadBytes, getDownloadURL } = await obtenerStorage()
  const r = ref(storage, `compartidos/${uid}/${nombrePublicado(nombreArchivo)}`)
  await uploadBytes(r, blob, { contentType: blob.type || 'application/pdf', contentDisposition: `inline; filename="${nombreArchivo}"` })
  return getDownloadURL(r)
}
