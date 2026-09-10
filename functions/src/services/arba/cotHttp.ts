import { URL_COT } from './cot'

// Presentación del archivo TXT al web service COT de ARBA (2026-09-10): POST
// multipart con `user` (CUIT), `password` (CIT) y `file`. ARBA responde XML
// (application/xml, ISO-8859-1): TBError si falla la autenticación o el
// formato, validacionesRemitos con el COT por remito si lo procesó. Verificado
// contra producción el 2026-09-10 (archivo sin remitos → "45 No hay registro
// 02"), así que la forma del POST es la correcta. Ver docs/arba/COT.md.

const TIMEOUT_MS = 40_000

export interface PresentacionCot { status: number; xml: string }

export async function presentarArchivoCot(
  ambiente: 'produccion' | 'prueba',
  credenciales: { cuit: string; cit: string },
  archivo: { nombre: string; contenido: string },
): Promise<PresentacionCot> {
  const url = URL_COT[ambiente]
  const form = new FormData()
  form.append('user', credenciales.cuit.replace(/\D/g, ''))
  form.append('password', credenciales.cit)
  // ISO-8859-1: la Ñ y las vocales con acento (si quedara alguna) van en un byte.
  const bytes = Buffer.from(archivo.contenido, 'latin1')
  form.append('file', new Blob([bytes], { type: 'text/plain' }), archivo.nombre)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { method: 'POST', body: form, signal: ctl.signal })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, xml: buf.toString('latin1') }
  } finally {
    clearTimeout(timer)
  }
}
