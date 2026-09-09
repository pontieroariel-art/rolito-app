import type { UserProfile, VentaCamion } from '@/types'
import { armarFacturaDeVenta } from './facturaDeVenta'
import { armarFacturaX, armarRemito, tipoComprobanteInterno, type CaiRemito } from './comprobanteInterno'
import { codigoComprobanteInterno } from './numeracionInterna'
import { compartirArchivo, descargarArchivo } from './compartir'

// El comprobante de una venta del camión, en un solo lugar (2026-09-06; antes
// la orquestación vivía inline en VentasChofer.tsx): qué papel le corresponde
// (factura de ARCA, remito, factura X de promo), cómo describirlo en pantalla,
// cómo está en Tango y cómo generarlo y entregarlo (ver / enviar).

export type EstadoComprobante = 'ok' | 'rechazada' | 'incierta' | 'sin_numero' | 'sin_comprobante'

export interface DescripcionComprobante {
  /** 'Factura A' | 'Factura B' | 'Factura C' | 'Factura' | 'Remito' | 'Remito Rolito' | 'Factura X' | 'Sin comprobante' */
  etiqueta: string
  /** "00001-00000341" o '' si todavía no tiene número. */
  numero:   string
  estado:   EstadoComprobante
  /** Texto corto del estado para mostrar al lado ('CAE ok', 'rechazada por ARCA', …). */
  detalle:  string
}

const LETRA: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' }

export const nroFacturaArca = (v: VentaCamion): string =>
  v.factura ? `${String(v.factura.puntoVenta).padStart(5, '0')}-${String(v.factura.numero).padStart(8, '0')}` : ''

export function describirComprobante(v: VentaCamion): DescripcionComprobante {
  const tipoInterno = tipoComprobanteInterno(v)
  if (tipoInterno) {
    const etiqueta = tipoInterno === 'facturaX' ? 'Factura X' : tipoInterno === 'remitoPromo' ? 'Remito Rolito' : 'Remito'
    if (!v.comprobanteInterno) return { etiqueta, numero: '', estado: 'sin_numero', detalle: 'sin número' }
    return { etiqueta, numero: codigoComprobanteInterno(v.comprobanteInterno), estado: 'ok', detalle: '' }
  }
  const f = v.factura
  if (!f) return { etiqueta: 'Factura', numero: '', estado: 'sin_comprobante', detalle: 'sin factura todavía' }
  const etiqueta = `Factura ${LETRA[f.cbteTipo] ?? ''}`.trim()
  if (f.estado === 'rechazada') return { etiqueta, numero: nroFacturaArca(v), estado: 'rechazada', detalle: 'rechazada por ARCA' }
  if (f.estado === 'incierta') return { etiqueta, numero: nroFacturaArca(v), estado: 'incierta', detalle: 'en revisión en ARCA' }
  return { etiqueta, numero: nroFacturaArca(v), estado: 'ok', detalle: 'CAE ok' }
}

export interface EstadoTangoVenta {
  estado:  'confirmado' | 'pendiente' | 'error'
  /** "FAC A 01104-00000062" / "R 01105-00000041" / "pendiente" / el error. */
  texto:   string
  stock?:  string   // "VPR 00900-00000001" cuando el stock viajó aparte (promo)
}

export function estadoTangoVenta(v: VentaCamion): EstadoTangoVenta {
  const t = v.tango
  const stock = t?.stockEstado === 'confirmado' && t.stockNumero ? `${t.stockTipo ?? ''} ${t.stockNumero}`.trim() : undefined
  if (!t || t.estado === 'pendiente' || t.estado === 'enviado') return { estado: 'pendiente', texto: 'Pendiente en Tango', stock }
  if (t.estado === 'error') return { estado: 'error', texto: t.ultimoError ? `Tango: ${t.ultimoError}` : 'Error en Tango', stock }
  const numero = t.facturaNumero ? `FAC ${t.facturaNumero}` : t.remitoNumero ? `R ${t.remitoNumero}` : ''
  return { estado: 'confirmado', texto: numero ? `Tango ✓ ${numero}` : 'En Tango', stock }
}

/** Problemas de control de una venta (para el filtro "con problemas" y el chip de la barra de estado). */
export function problemasDeVenta(v: VentaCamion): string[] {
  const out: string[] = []
  const c = describirComprobante(v)
  if (c.estado === 'rechazada') out.push('Factura rechazada por ARCA')
  if (c.estado === 'incierta') out.push('Factura en revisión en ARCA')
  if (c.estado === 'sin_comprobante') out.push('Sin factura')
  if (c.estado === 'sin_numero') out.push(`${c.etiqueta} sin número`)
  if (v.tango?.estado === 'error') out.push('No llegó a Tango')
  return out
}

export type ComprobanteGenerado = { ok: true; blob: Blob; nombre: string; titulo: string } | { ok: false; motivo: string }

// Si la pantalla no tenía el perfil (la lista de clientes activos son 2.000+
// docs y en el celular tarda o falla), se busca por id: sin perfil el remito
// salía sin domicilio, C.P., código ni CUIT (visto 2026-09-09, R 01105-00000116).
async function perfilDelCliente(venta: VentaCamion, cliente: UserProfile | undefined): Promise<UserProfile | undefined> {
  if (cliente || !venta.clienteId) return cliente
  try {
    const { getUserDocument } = await import('@/services/userService')
    return (await getUserDocument(venta.clienteId)) ?? undefined
  } catch {
    return undefined
  }
}

/** Genera el PDF del comprobante que le corresponde a la venta (sin descargarlo). */
export async function generarComprobanteVenta(venta: VentaCamion, clienteEnPantalla: UserProfile | undefined, caiRemito: CaiRemito | null): Promise<ComprobanteGenerado> {
  const cliente = await perfilDelCliente(venta, clienteEnPantalla)
  const tipoInterno = tipoComprobanteInterno(venta)
  if (tipoInterno === 'remito' || tipoInterno === 'remitoPromo') {
    const armado = armarRemito(venta, cliente, caiRemito)
    if (!armado.ok) return { ok: false, motivo: armado.motivo }
    const { generateRemitoPdf } = await import('./remitoPdf')
    const blob = (await generateRemitoPdf(armado.datos, { descargar: false })) as Blob
    return { ok: true, blob, nombre: armado.datos.archivo, titulo: `Remito ${armado.datos.numero ?? 'sin número'}` }
  }
  if (tipoInterno === 'facturaX') {
    const armado = armarFacturaX(venta, cliente)
    if (!armado.ok) return { ok: false, motivo: armado.motivo }
    const { generateComprobanteInternoPdf } = await import('./comprobanteInternoPdf')
    const blob = (await generateComprobanteInternoPdf(armado.datos, { descargar: false })) as Blob
    return { ok: true, blob, nombre: armado.datos.archivo, titulo: `Factura X ${armado.datos.numero ?? 'sin número'}` }
  }
  const armado = armarFacturaDeVenta(venta, cliente)
  if (!armado.ok) return { ok: false, motivo: armado.motivo }
  const { generateFacturaArcaPdf } = await import('./facturaArcaPdf')
  const blob = (await generateFacturaArcaPdf(armado.datos)) as Blob
  return { ok: true, blob, nombre: `factura-${nroFacturaArca(venta)}.pdf`, titulo: `Factura ${nroFacturaArca(venta)}` }
}

/**
 * Ver (descargar) o enviar (compartir) el comprobante de la venta.
 * Devuelve un aviso para mostrar en pantalla, o '' si salió bien.
 */
export async function entregarComprobanteVenta(
  venta: VentaCamion, cliente: UserProfile | undefined, caiRemito: CaiRemito | null, modo: 'ver' | 'enviar',
): Promise<string> {
  let generado: ComprobanteGenerado
  try {
    generado = await generarComprobanteVenta(venta, cliente, caiRemito)
  } catch {
    return 'No se pudo generar el comprobante. Probá de nuevo.'
  }
  if (!generado.ok) return generado.motivo
  if (modo === 'ver') { descargarArchivo(generado.blob, generado.nombre); return '' }
  const r = await compartirArchivo(generado.blob, generado.nombre, { titulo: generado.titulo, texto: `${generado.titulo} — ${venta.clienteNombre}` })
  return r === 'descargado' ? 'Este dispositivo no puede compartir archivos: se descargó.' : ''
}
