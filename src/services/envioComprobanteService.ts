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
  /** Venta de la app: el server anota `envioMail` en el doc y, si es automático, no la manda dos veces. */
  venta?:        { coleccion: 'ventasCamion' | 'ventasVentanilla'; id: string }
  automatico?:   boolean
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
/** Mismo tope que el server (20 MB de PDF; en base64 queda bajo el límite de 32 MB de la request). */
export const MAX_BYTES_MAIL = 20 * 1024 * 1024

export async function enviarComprobantesPorMail(e: EnvioLote): Promise<void> {
  if (!e.adjuntos.length) throw new Error('No hay comprobantes para mandar')
  if (e.adjuntos.length > MAX_ADJUNTOS_MAIL) throw new Error(`Se pueden mandar hasta ${MAX_ADJUNTOS_MAIL} comprobantes por mail`)
  const bytes = e.adjuntos.reduce((s, a) => s + a.pdf.size, 0)
  if (bytes > MAX_BYTES_MAIL) throw new Error(`Los PDF pesan ${(bytes / 1024 / 1024).toFixed(1)} MB: el tope por mail es ${MAX_BYTES_MAIL / 1024 / 1024} MB. Mandalos en dos tandas.`)
  const adjuntos: { nombreArchivo: string; pdfBase64: string }[] = []
  for (const a of e.adjuntos) adjuntos.push({ nombreArchivo: a.nombreArchivo, pdfBase64: await aBase64(a.pdf) })
  const fn = httpsCallable<Record<string, unknown>, { ok: boolean; para: string }>(getFunctions(), 'enviarComprobantePorMail')
  await fn({
    para: e.para, asunto: e.asunto, mensaje: e.mensaje ?? '', adjuntos,
    comprobante: e.comprobante, comprobantes: e.comprobantes, clienteUid: e.clienteUid ?? null, clienteNombre: e.clienteNombre, conCopia: e.conCopia === true,
    presentacion: e.presentacion ?? null,
  })
}

export async function enviarComprobantePorMail(e: EnvioComprobante): Promise<{ para: string; yaEnviado: boolean }> {
  const pdfBase64 = await aBase64(e.pdf)
  const fn = httpsCallable<Record<string, unknown>, { ok: boolean; para: string; yaEnviado?: boolean }>(getFunctions(), 'enviarComprobantePorMail')
  const r = await fn({
    para: e.para, asunto: e.asunto, mensaje: e.mensaje ?? '', nombreArchivo: e.nombreArchivo, pdfBase64,
    comprobante: e.comprobante, clienteUid: e.clienteUid ?? null, clienteNombre: e.clienteNombre, conCopia: e.conCopia === true,
    presentacion: e.presentacion ?? null,
    ...(e.venta ? { venta: e.venta } : {}),
    ...(e.automatico ? { automatico: true } : {}),
  })
  return { para: r.data.para, yaEnviado: r.data.yaEnviado === true }
}
