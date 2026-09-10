import { getFunctions, httpsCallable } from 'firebase/functions'
import type { EmpresaTango } from '@/types'

// Envío de un comprobante en PDF por mail al cliente, vía la Cloud Function
// enviarComprobantePorMail (Resend con adjunto; un mailto: no puede adjuntar).
// La función valida el rol, limita la frecuencia y registra el envío en
// enviosComprobantes.

export interface EnvioComprobante {
  para:          string
  asunto:        string
  mensaje?:      string
  nombreArchivo: string
  pdf:           Blob
  comprobante:   { tipo: string; numero: string; empresa?: EmpresaTango }
  clienteUid?:   string
  clienteNombre: string
  conCopia?:     boolean
  /** Tarjeta del mail: título legible y filas ya formateadas. */
  presentacion?: { titulo: string; emoji?: string; filas: { label: string; value: string }[] }
}

async function aBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const paso = 0x8000
  for (let i = 0; i < buf.length; i += paso) bin += String.fromCharCode(...buf.subarray(i, i + paso))
  return btoa(bin)
}

/** Varios PDF en un solo mail (envío en bloque desde Comprobantes de clientes, 2026-09-10). */
export interface EnvioLote {
  para:          string
  asunto:        string
  mensaje?:      string
  adjuntos:      { nombreArchivo: string; pdf: Blob }[]
  /** Lo que representa el mail (para el registro); en un bloque, `tipo: 'LOTE'`. */
  comprobante:   { tipo: string; numero: string; empresa?: EmpresaTango }
  comprobantes:  { tipo: string; numero: string; empresa?: EmpresaTango }[]
  clienteUid?:   string
  clienteNombre: string
  conCopia?:     boolean
  presentacion?: { titulo: string; emoji?: string; filas: { label: string; value: string }[] }
}

export const MAX_ADJUNTOS_MAIL = 40

export async function enviarComprobantesPorMail(e: EnvioLote): Promise<void> {
  if (!e.adjuntos.length) throw new Error('No hay comprobantes para mandar')
  if (e.adjuntos.length > MAX_ADJUNTOS_MAIL) throw new Error(`Se pueden mandar hasta ${MAX_ADJUNTOS_MAIL} comprobantes por mail`)
  const adjuntos: { nombreArchivo: string; pdfBase64: string }[] = []
  for (const a of e.adjuntos) adjuntos.push({ nombreArchivo: a.nombreArchivo, pdfBase64: await aBase64(a.pdf) })
  const fn = httpsCallable<Record<string, unknown>, { ok: boolean; para: string }>(getFunctions(), 'enviarComprobantePorMail')
  await fn({
    para: e.para, asunto: e.asunto, mensaje: e.mensaje ?? '', adjuntos,
    comprobante: e.comprobante, comprobantes: e.comprobantes, clienteUid: e.clienteUid ?? null, clienteNombre: e.clienteNombre, conCopia: e.conCopia === true,
    presentacion: e.presentacion ?? null,
  })
}

export async function enviarComprobantePorMail(e: EnvioComprobante): Promise<void> {
  const pdfBase64 = await aBase64(e.pdf)
  const fn = httpsCallable<Record<string, unknown>, { ok: boolean; para: string }>(getFunctions(), 'enviarComprobantePorMail')
  await fn({
    para: e.para, asunto: e.asunto, mensaje: e.mensaje ?? '', nombreArchivo: e.nombreArchivo, pdfBase64,
    comprobante: e.comprobante, clienteUid: e.clienteUid ?? null, clienteNombre: e.clienteNombre, conCopia: e.conCopia === true,
    presentacion: e.presentacion ?? null,
  })
}
