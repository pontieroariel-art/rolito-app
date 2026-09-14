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
  const tamanioLinea = producto.etiquetaGrilla === producto.tamanioTicket
    ? producto.tamanioTicket
    : `${producto.etiquetaGrilla} · ${producto.tamanioTicket}`

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
    centrado(y(0.03), mm(9),  'ROLITO', ancho),
    centrado(y(0.11), mm(12), tamanioLinea, ancho),
    centrado(y(0.22), mm(3.6), `HORA FAB.: ${hora}`, ancho),
    centrado(y(0.255), mm(3.6), `FECHA FAB.: ${fecha}`, ancho),
    centrado(y(0.29), mm(3.6), pallet.operador.nombre, ancho),
    centrado(y(0.345), mm(3.2), planta.razonSocial, ancho),
    centrado(y(0.375), mm(3.2), planta.direccion, ancho),
    centrado(y(0.405), mm(3.2), planta.localidad, ancho),
    centrado(y(0.435), mm(3.2), `Tel.: ${planta.telefono}`, ancho),
    // QR con el código en texto plano (igual que el ticket HTML).
    `^FO${Math.round((ancho - qrLado) / 2)},${y(0.49)}^BQN,2,${qrMag}^FDQA,${pallet.codigo}^FS`,
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
