// Etiqueta del pallet de producción en ZPL (2026-09-14), para mandarla
// directo a la Zebra ZD421 por Bluetooth en vez de `window.print()`.
//
// Por qué ZPL y no el ticket HTML: la impresora dibuja ella misma el QR y el
// código de barras, no hay diálogo de Android, y las medidas son en puntos de
// impresora (203 dpi = 8 puntos por mm), no en "mm del navegador" que nunca
// se calibraron. El contenido es el MISMO que ProduccionTicket.tsx, que queda
// como respaldo cuando no hay impresora conectada.
//
// Módulo puro: sin React, sin Firebase. Se testea con vitest.
import type { PalletProduccion } from '@/types'
import { PLANTA_INFO } from './constants'
import { PRODUCTOS_HIELO } from './produccionCatalogo'

/** Tamaño del rollo. Punto de partida 100 × 150 mm; se ajusta contra el rollo real. */
export interface TamanioEtiqueta { anchoMm: number; altoMm: number }
export const ETIQUETA_PALLET: TamanioEtiqueta = { anchoMm: 100, altoMm: 150 }

/** Puntos por mm de la ZD421 (203 dpi). */
export const DOTS_POR_MM = 8

/**
 * ZPL escapa poco: `^` y `~` son comandos y `\` es prefijo de hexadecimal
 * en `^FH`. Como usamos `^FH` con `_` de prefijo, un `_` literal también hay
 * que codificarlo. Todo lo demás va tal cual (con ^CI28 la impresora lee UTF-8).
 */
export function escaparZpl(texto: string): string {
  return texto.replace(/_/g, '_5F').replace(/\^/g, '_5E').replace(/~/g, '_7E').replace(/\\/g, '_5C')
}

const mm = (v: number) => Math.round(v * DOTS_POR_MM)

/** Un renglón de texto centrado en todo el ancho: fuente 0 (escalable), alto en puntos. */
function centrado(y: number, alto: number, texto: string, ancho: number): string {
  return `^FO0,${y}^A0N,${alto},${alto}^FB${ancho},1,0,C,0^FH_^FD${escaparZpl(texto)}^FS`
}

/** Fecha y hora como las imprime el ticket HTML (es-AR). */
function fechaHora(d: Date): { hora: string; fecha: string } {
  return {
    hora:  d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
    fecha: d.toLocaleDateString('es-AR'),
  }
}

/**
 * Banda del producto (2026-09-25, pedido de Ariel): en la cámara de frío los
 * pallets se tienen que distinguir de LEJOS. La Zebra es térmica y solo
 * imprime en negro, así que la diferencia es de tamaño y contraste: una
 * franja negra arriba con la palabra del producto en blanco, lo más grande
 * que entre en el ancho (PICADO, ESCAMA, 2KG…), y el peso abajo cuando la
 * palabra no lo dice. La comparten la etiqueta ZPL y el ticket HTML.
 */
export interface BandaProducto {
  /** Palabra grande: PICADO, ESCAMA, CEMENTERA, 2KG, BARRA. */
  palabra: string
  /** Segunda línea (el peso) o null si la palabra ya es el peso. */
  subtitulo: string | null
  /** Alto de letra de la palabra, en mm, para que entre en `anchoUtilMm`. */
  altoLetraMm: number
}

/** Proporción ancho/alto de una mayúscula de la fuente 0 de Zebra (y de Inter en negrita), con margen. */
const ANCHO_POR_ALTO = 0.62
const ALTO_LETRA_MAX_MM = 30

export function bandaDeProducto(productoId: PalletProduccion['productoId'], anchoUtilMm: number): BandaProducto {
  const producto = PRODUCTOS_HIELO[productoId]
  const palabra = producto.etiquetaGrilla
  const subtitulo = producto.etiquetaGrilla === producto.tamanioTicket ? null : producto.tamanioTicket
  const altoLetraMm = Math.min(ALTO_LETRA_MAX_MM, Math.floor((anchoUtilMm / (palabra.length * ANCHO_POR_ALTO)) * 10) / 10)
  return { palabra, subtitulo, altoLetraMm }
}

/** Alto de la banda negra: 27 % de la etiqueta (40 mm en el rollo de 150). */
export const BANDA_FRACCION = 0.27

/**
 * Etiqueta completa del pallet. Mismo orden que el ticket en papel: marca,
 * tamaño en grande, hora/fecha/operario, planta, QR, código de barras,
 * código en texto y descripción. Las posiciones son fracciones del alto para
 * que el mismo dibujo sirva si el rollo no es de 150 mm.
 */
export function armarZplPallet(pallet: PalletProduccion, tam: TamanioEtiqueta = ETIQUETA_PALLET): string {
  const ancho = mm(tam.anchoMm)
  const alto  = mm(tam.altoMm)
  const planta   = PLANTA_INFO[pallet.plantaId]
  const producto = PRODUCTOS_HIELO[pallet.productoId]
  const { hora, fecha } = fechaHora(pallet.fechaFabricacion.toDate())
  const banda = bandaDeProducto(pallet.productoId, tam.anchoMm - 8)
  const bandaAlto = Math.round(alto * BANDA_FRACCION)
  const letra = mm(banda.altoLetraMm)
  const sub = mm(8)
  // La palabra y el peso centrados en vertical dentro de la banda.
  const bloque = letra + (banda.subtitulo ? sub + mm(2) : 0)
  const yPalabra = Math.round((bandaAlto - bloque) / 2)

  // Módulo del QR y grosor del código de barras, pensados para 100 mm de
  // ancho: QR de ~25 mm de lado (magnificación 8) y Code 128 de ~60 mm.
  const qrMag   = Math.max(3, Math.round(ancho / 100))
  const qrLado  = qrMag * 25                     // ~25 módulos × magnificación
  const barAlto = mm(16)
  const barModulo = Math.max(2, Math.round(ancho / 270))
  const barAncho  = barModulo * 11 * (pallet.codigo.length + 3) // aprox. Code 128

  const y = (fraccion: number) => Math.round(alto * fraccion)

  return [
    '^XA',
    '^CI28',                       // UTF-8: acentos y el punto medio salen bien
    `^PW${ancho}`,
    `^LL${alto}`,
    '^LH0,0',
    '^MTD',                        // térmica directa (la ZD421 de planta no usa ribbon)
    // Banda negra a todo el ancho y la palabra en blanco encima (^FR: invertido).
    `^FO0,0^GB${ancho},${bandaAlto},${bandaAlto}^FS`,
    centrado(yPalabra, letra, banda.palabra, ancho).replace('^FH_', '^FR^FH_'),
    ...(banda.subtitulo ? [centrado(yPalabra + letra + mm(2), sub, banda.subtitulo, ancho).replace('^FH_', '^FR^FH_')] : []),
    centrado(y(0.29), mm(3.6), `ROLITO · HORA FAB.: ${hora} · ${fecha}`, ancho),
    centrado(y(0.32), mm(3.6), pallet.operador.nombre, ancho),
    centrado(y(0.37), mm(3.2), planta.razonSocial, ancho),
    centrado(y(0.395), mm(3.2), planta.direccion, ancho),
    centrado(y(0.42), mm(3.2), planta.localidad, ancho),
    centrado(y(0.445), mm(3.2), `Tel.: ${planta.telefono}`, ancho),
    // QR con el código en texto plano (igual que el ticket HTML).
    `^FO${Math.round((ancho - qrLado) / 2)},${y(0.485)}^BQN,2,${qrMag}^FDQA,${pallet.codigo}^FS`,
    // Code 128 con el texto abajo (Y), sin chequeo (N).
    `^BY${barModulo},3,${barAlto}`,
    `^FO${Math.max(0, Math.round((ancho - barAncho) / 2))},${y(0.72)}^BCN,${barAlto},Y,N,N^FD${pallet.codigo}^FS`,
    centrado(y(0.87), mm(4), pallet.codigo, ancho),
    centrado(y(0.915), mm(3.4), producto.descripcionTicket, ancho),
    '^PQ1',
    '^XZ',
  ].join('\n')
}

/**
 * Etiqueta de prueba para calibrar el rollo: marco al borde del área
 * imprimible, medidas y una línea de texto. Si el marco sale cortado o queda
 * corto, se corrigen `anchoMm`/`altoMm`.
 */
export function armarZplPrueba(tam: TamanioEtiqueta = ETIQUETA_PALLET, ahora: Date = new Date()): string {
  const ancho = mm(tam.anchoMm)
  const alto  = mm(tam.altoMm)
  const { hora, fecha } = fechaHora(ahora)
  return [
    '^XA', '^CI28', `^PW${ancho}`, `^LL${alto}`, '^LH0,0', '^MTD',
    `^FO4,4^GB${ancho - 8},${alto - 8},4^FS`,
    centrado(Math.round(alto * 0.30), mm(9), 'PRUEBA', ancho),
    centrado(Math.round(alto * 0.42), mm(5), `${tam.anchoMm} x ${tam.altoMm} mm`, ancho),
    centrado(Math.round(alto * 0.50), mm(3.6), 'El marco tiene que llegar al borde', ancho),
    centrado(Math.round(alto * 0.56), mm(3.6), `${fecha} ${hora}`, ancho),
    `^FO${Math.round(ancho / 2) - 100},${Math.round(alto * 0.64)}^BQN,2,8^FDQA,PRUEBA^FS`,
    '^PQ1', '^XZ',
  ].join('\n')
}
