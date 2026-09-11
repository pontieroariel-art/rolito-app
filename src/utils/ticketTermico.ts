// Tickets para la impresora térmica del mostrador (Eliprinter RP-8060P,
// Bluetooth/USB, rollo de 80 mm con 72 mm imprimibles, 203 dpi).
//
// Decisión 2026-09-07 (Ariel): todo lo que la ventanilla le entrega al público
// —factura electrónica y comprobante de turno— sale por esa impresora, no por
// una láser A4. Por eso los comprobantes del mostrador se dibujan acá en una
// página de 80 mm de ancho y alto a medida del contenido, y se mandan
// directo al diálogo de impresión en vez de descargarse.
//
// Cómo se arma el PDF: cada ticket es una función que dibuja sobre un jsPDF y
// devuelve el alto que ocupó. Se dibuja una vez en una página de prueba
// (para medir) y otra vez en la definitiva, ya con el alto justo — así el
// rollo no corre papel de más. Varios tickets en un mismo PDF salen como
// páginas sucesivas: un solo diálogo de impresión, dos papeles.

import type { jsPDF } from 'jspdf'
import { descargarArchivo } from './compartir'

export const ANCHO_TICKET = 80
/** Margen lateral: 72 mm imprimibles centrados en el rollo de 80. */
export const X0 = 4
export const X1 = ANCHO_TICKET - 4
export const ANCHO_UTIL = X1 - X0
export const XC = ANCHO_TICKET / 2

/** Dibuja un ticket a partir de `y` y devuelve el `y` final (mm). */
export type DibujoTicket = (doc: jsPDF, y: number) => number | Promise<number>

const ALTO_MEDICION = 1500
const MARGEN_SUPERIOR = 4
const MARGEN_INFERIOR = 6
/** Alto de la zona de corte que cierra cada ticket cuando salen varios juntos. */
export const ZONA_CORTE = 16

// La Eliprinter del mostrador no tiene guillotina: cuando la factura y las
// copias del turno salen en la misma tira, caja las separa a mano. Cada ticket
// termina entonces con una franja en blanco y una línea punteada de borde a
// borde con "CORTAR", para que se vea dónde va el corte (pedido de Ariel,
// 2026-09-11). Con un solo ticket no hace falta: se corta contra la barra.
export function zonaCorte(doc: jsPDF, y: number): number {
  const yl = y + ZONA_CORTE / 2
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.setLineDashPattern([1.5, 1.2], 0)
  doc.line(0, yl, ANCHO_TICKET, yl)
  doc.setLineDashPattern([], 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(0, 0, 0)
  const etiqueta = '- - CORTAR - -'
  const ancho = doc.getTextWidth(etiqueta) + 3
  doc.setFillColor(255, 255, 255)
  doc.rect(XC - ancho / 2, yl - 2, ancho, 3.5, 'F')
  doc.text(etiqueta, XC, yl + 0.8, { align: 'center' })
  return y + ZONA_CORTE
}

export async function armarPdfTickets(dibujos: DibujoTicket[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  if (dibujos.length === 0) throw new Error('Sin tickets para armar')
  const conCorte = dibujos.length > 1

  // Primera pasada: medir cada ticket en una página larga de prueba.
  const altos: number[] = []
  for (const dibujo of dibujos) {
    const prueba = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [ANCHO_TICKET, ALTO_MEDICION], compress: true })
    const fin = await dibujo(prueba, MARGEN_SUPERIOR)
    altos.push(Math.ceil(fin + (conCorte ? ZONA_CORTE : MARGEN_INFERIOR)))
  }

  // Segunda pasada: la página definitiva de cada uno con su alto justo.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [ANCHO_TICKET, altos[0]], compress: true })
  for (let i = 0; i < dibujos.length; i++) {
    if (i > 0) doc.addPage([ANCHO_TICKET, altos[i]], 'portrait')
    const fin = await dibujos[i](doc, MARGEN_SUPERIOR)
    if (conCorte) zonaCorte(doc, fin)
  }
  return doc.output('blob')
}

// ── Primitivas de dibujo (todas devuelven el y siguiente) ────────────────────

export function texto(doc: jsPDF, s: string, y: number, opts: {
  tam?: number; negrita?: boolean; align?: 'left' | 'center' | 'right'; x?: number; interlineado?: number
} = {}): number {
  const tam = opts.tam ?? 8
  doc.setFont('helvetica', opts.negrita ? 'bold' : 'normal')
  doc.setFontSize(tam)
  doc.setTextColor(0, 0, 0)
  const align = opts.align ?? 'left'
  const x = opts.x ?? (align === 'center' ? XC : align === 'right' ? X1 : X0)
  const lineas: string[] = doc.splitTextToSize(s, ANCHO_UTIL)
  const salto = opts.interlineado ?? tam * 0.42
  for (const l of lineas) {
    doc.text(l, x, y, { align })
    y += salto
  }
  return y
}

/** Etiqueta en negrita seguida del valor, envuelto a lo ancho del ticket. */
export function campo(doc: jsPDF, etiqueta: string, valor: string, y: number, tam = 7.5): number {
  doc.setFontSize(tam)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.text(etiqueta, X0, y)
  const ancho = doc.getTextWidth(etiqueta) + 1
  doc.setFont('helvetica', 'normal')
  const lineas: string[] = doc.splitTextToSize(valor, ANCHO_UTIL - ancho)
  const salto = tam * 0.42
  lineas.forEach((l, i) => doc.text(l, X0 + ancho, y + i * salto))
  return y + Math.max(1, lineas.length) * salto
}

/** Texto a la izquierda y otro a la derecha en la misma línea. */
export function fila(doc: jsPDF, izq: string, der: string, y: number, opts: { tam?: number; negrita?: boolean } = {}): number {
  const tam = opts.tam ?? 8
  doc.setFont('helvetica', opts.negrita ? 'bold' : 'normal')
  doc.setFontSize(tam)
  doc.setTextColor(0, 0, 0)
  const anchoDer = doc.getTextWidth(der) + 2
  const lineas: string[] = doc.splitTextToSize(izq, ANCHO_UTIL - anchoDer)
  doc.text(der, X1, y, { align: 'right' })
  const salto = tam * 0.42
  lineas.forEach((l, i) => doc.text(l, X0, y + i * salto))
  return y + Math.max(1, lineas.length) * salto
}

export function separador(doc: jsPDF, y: number, punteado = true): number {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.25)
  if (punteado) doc.setLineDashPattern([0.8, 0.8], 0)
  doc.line(X0, y, X1, y)
  doc.setLineDashPattern([], 0)
  return y + 3
}

/** Imagen centrada (QR, logo) de `lado` mm. */
export function imagenCentrada(doc: jsPDF, dataUrl: string, y: number, lado: number, formato: 'PNG' | 'JPEG' = 'PNG'): number {
  doc.addImage(dataUrl, formato, XC - lado / 2, y, lado, lado)
  return y + lado + 2
}

// ── Impresión ────────────────────────────────────────────────────────────────

const esMovil = () => /Android|iPhone|iPad/i.test(navigator.userAgent)

export type ResultadoImpresion = 'impreso' | 'descargado'

/**
 * Manda el PDF al diálogo de impresión del navegador sin descargarlo: se carga
 * en un iframe oculto y se imprime desde ahí. Chrome recuerda la última
 * impresora usada, así que en la PC de caja el diálogo ya viene con la
 * Eliprinter elegida y alcanza con Enter.
 *
 * En un celular/tablet el navegador no puede imprimir un PDF embebido, así
 * que se descarga y se abre con la app de la impresora.
 */
// ── Modo de impresión del dispositivo (2026-09-08) ───────────────────────────
// La tablet de caja imprime por Bluetooth con RawBT (app de Android de
// impresión térmica): la app le pasa el PDF con el esquema rawbt: y RawBT lo
// manda a la Eliprinter sin diálogo ni descarga. Se elige una vez por
// dispositivo (localStorage). 'auto' es el comportamiento de siempre: diálogo
// de impresión en una compu, descarga en celular/tablet.
export type ModoImpresion = 'auto' | 'rawbt'
const CLAVE_MODO = 'ventanilla_modoImpresion'
export const MODOS_IMPRESION: { id: ModoImpresion; label: string }[] = [
  { id: 'auto',  label: 'Automática (diálogo / descarga)' },
  { id: 'rawbt', label: 'RawBT por Bluetooth (tablet Android)' },
]

export function leerModoImpresion(): ModoImpresion {
  try { return localStorage.getItem(CLAVE_MODO) === 'rawbt' ? 'rawbt' : 'auto' } catch { return 'auto' }
}
export function guardarModoImpresion(modo: ModoImpresion): void {
  try { localStorage.setItem(CLAVE_MODO, modo) } catch { /* sin storage: queda en auto */ }
}

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter'

async function blobABase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Manda el PDF a RawBT. Chrome solo deja abrir otra app desde un toque del
 * usuario: si esto corre fuera de un gesto (por ejemplo al llegar el CAE
 * solo), la navegación se bloquea y no imprime — por eso en modo RawBT la
 * factura se imprime con un botón. El `intent:` con package abre Play Store
 * si RawBT no está instalado.
 */
export async function imprimirConRawBT(blob: Blob): Promise<void> {
  const b64 = await blobABase64(blob)
  window.location.href = `intent:data:application/pdf;base64,${b64}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};end;`
}

export async function imprimirPdf(blob: Blob, nombreArchivo: string, modo: ModoImpresion = leerModoImpresion()): Promise<ResultadoImpresion> {
  if (modo === 'rawbt') {
    await imprimirConRawBT(blob)
    return 'impreso'
  }
  if (esMovil()) {
    descargarArchivo(blob, nombreArchivo)
    return 'descargado'
  }
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  const cargado = new Promise<boolean>((resolve) => {
    iframe.onload = () => resolve(true)
    iframe.onerror = () => resolve(false)
  })
  iframe.src = url
  document.body.appendChild(iframe)
  const ok = await cargado
  // El visor de PDF necesita un instante después del load para aceptar print().
  await new Promise((r) => setTimeout(r, 500))
  let impreso = false
  if (ok) {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      impreso = true
    } catch {
      impreso = false
    }
  }
  if (!impreso) descargarArchivo(blob, nombreArchivo)
  // El diálogo puede quedar abierto un rato; el iframe se limpia después.
  setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url) }, 120_000)
  return impreso ? 'impreso' : 'descargado'
}
