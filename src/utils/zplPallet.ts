// Etiqueta del pallet de producción en ZPL (2026-09-14), para mandarla
// directo a la Zebra ZD421 por Bluetooth en vez de `window.print()`.
//
// Por qué ZPL y no el ticket HTML: la impresora dibuja ella misma el QR y el
// código de barras, no hay diálogo de Android, y las medidas son en puntos de
// impresora (203 dpi = 8 puntos por mm), no en "mm del navegador".
//
// Desde el 2026-09-25 el dibujo sale del modelo único de etiquetaPallet.ts
// (una banda por producto): acá solo se traduce cada forma a su comando ZPL.
//
// Módulo puro: sin React, sin Firebase. Se testea con vitest.
import type { PalletProduccion } from '@/types'
import { armarEtiquetaPallet, ETIQUETA_PALLET, type Forma, type TamanioEtiqueta } from './etiquetaPallet'

export { ETIQUETA_PALLET, type TamanioEtiqueta }

/** Puntos por mm de la ZD421 (203 dpi). */
export const DOTS_POR_MM = 8

/**
 * ZPL escapa poco: `^` y `~` son comandos y la barra invertida es prefijo de
 * hexadecimal en `^FH`. Como usamos `^FH` con `_` de prefijo, un `_` literal
 * también hay que codificarlo. Todo lo demás va tal cual (con ^CI28 la
 * impresora lee UTF-8).
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

/** Módulos de un QR versión 1 (el código del pallet entra de sobra). */
const QR_MODULOS = 21

/** Una forma del modelo → comando ZPL. */
export function zplDeForma(f: Forma): string {
  switch (f.t) {
    case 'rect': {
      const w = mm(f.w), h = mm(f.h)
      // ^GB con grosor = el lado menor rellena la caja entera.
      const grosor = f.borde ? mm(f.borde) : Math.min(w, h)
      return `^FO${mm(f.x)},${mm(f.y)}^GB${w},${h},${grosor}^FS`
    }
    case 'circulo': {
      const d = mm(f.d)
      return `^FO${mm(f.x)},${mm(f.y)}^GC${d},${d},B^FS`
    }
    case 'diagonal':
      // R = inclinada a la derecha: "/" de abajo a la izquierda a arriba a la derecha.
      return `^FO${mm(f.x)},${mm(f.y)}^GD${mm(f.w)},${mm(f.h)},${mm(f.grosor)},B,R^FS`
    case 'texto': {
      const alto = mm(f.alto)
      return `^FO${mm(f.x)},${mm(f.y)}^A0N,${alto},${alto}^FB${mm(f.ancho)},1,0,C,0${f.blanco ? '^FR' : ''}^FH_^FD${escaparZpl(f.texto)}^FS`
    }
    case 'qr': {
      const mag = Math.max(2, Math.floor(mm(f.lado) / QR_MODULOS))
      const lado = mag * QR_MODULOS
      const x = mm(f.x) + Math.round((mm(f.lado) - lado) / 2)
      return `^FO${x},${mm(f.y)}^BQN,2,${mag}^FDQA,${f.dato}^FS`
    }
    case 'barras': {
      // Code 128: ~11 módulos por carácter + arranque, control y parada.
      const modulos = 11 * (f.dato.length + 3) + 2
      const modulo = Math.max(2, Math.min(4, Math.floor(mm(f.w) / modulos)))
      const x = mm(f.x) + Math.max(0, Math.round((mm(f.w) - modulo * modulos) / 2))
      return `^BY${modulo},3,${mm(f.h)}\n^FO${x},${mm(f.y)}^BCN,${mm(f.h)},N,N,N^FD${f.dato}^FS`
    }
  }
}

/**
 * Etiqueta completa del pallet (una banda por producto, 2026-09-25). El
 * contenido es el del modelo de etiquetaPallet.ts, igual que el ticket de
 * respaldo en papel.
 */
export function armarZplPallet(pallet: PalletProduccion, tam: TamanioEtiqueta = ETIQUETA_PALLET): string {
  const etiqueta = armarEtiquetaPallet(pallet, tam)
  return [
    '^XA',
    '^CI28',                       // UTF-8: acentos y el punto medio salen bien
    `^PW${mm(tam.anchoMm)}`,
    `^LL${mm(tam.altoMm)}`,
    '^LH0,0',
    '^MTD',                        // térmica directa (la ZD421 de planta no usa ribbon)
    ...etiqueta.formas.map(zplDeForma),
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
