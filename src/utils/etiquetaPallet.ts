// Etiqueta del pallet de producción: UN modelo, dos dibujos (2026-09-25).
//
// Diseño "una banda por producto" aprobado por Ariel, con sus ajustes: en la
// cámara de frío el pallet se tiene que reconocer de LEJOS. La Zebra ZD421 es
// térmica y solo imprime en negro, así que se distingue por:
//   - una banda de 30 mm arriba: a la izquierda el código corto del producto
//     en blanco sobre negro (10, 3, 2, PIC, ESC, BAR, CEM) y a la derecha un
//     PATRÓN distinto por producto, que se reconoce sin leer;
//   - la cantidad en grande (88 BOLSAS), para contar sin buscar el producto;
//   - el día del año en grande más la fecha legible, para rotar lo más viejo.
//
// Este módulo arma la etiqueta como una lista de formas en milímetros. De ahí
// salen la etiqueta ZPL de la Zebra (zplPallet.ts) y el ticket de respaldo
// en SVG (ProduccionTicket.tsx), así los dos nunca se desfasan.
//
// Diseñada para un rollo de 80 × 120 mm; en un rollo más grande se escala
// entera y se centra. Módulo puro: sin React, sin Firebase.
import type { PalletProduccion } from '@/types'
import { PLANTA_INFO } from './constants'
import { PRODUCTOS_HIELO, type PatronEtiqueta } from './produccionCatalogo'

export interface TamanioEtiqueta { anchoMm: number; altoMm: number }

/** Rollo de referencia del diseño. Si el real es otro, se ajusta acá (y en @page de index.css). */
export const ETIQUETA_PALLET: TamanioEtiqueta = { anchoMm: 80, altoMm: 120 }
const BASE: TamanioEtiqueta = { anchoMm: 80, altoMm: 120 }

export type Forma =
  /** Rectángulo lleno o solo el borde (`borde` = grosor). */
  | { t: 'rect'; x: number; y: number; w: number; h: number; borde?: number }
  /** Círculo lleno; x, y = esquina superior izquierda del cuadrado que lo contiene. */
  | { t: 'circulo'; x: number; y: number; d: number }
  /** Línea diagonal "/" que cruza la caja de abajo a la izquierda a arriba a la derecha. */
  | { t: 'diagonal'; x: number; y: number; w: number; h: number; grosor: number }
  /** Texto en una línea, centrado en la caja [x, x + ancho]. `alto` = alto de la letra. */
  | { t: 'texto'; x: number; y: number; ancho: number; alto: number; texto: string; blanco?: boolean }
  | { t: 'qr'; x: number; y: number; lado: number; dato: string }
  | { t: 'barras'; x: number; y: number; w: number; h: number; dato: string }

export interface EtiquetaPallet {
  tamanio: TamanioEtiqueta
  formas: Forma[]
}

/**
 * Proporción ancho/alto de una mayúscula en negrita, con margen. Sirve para
 * que el texto entre en su caja: la fuente de la Zebra es más angosta, la del
 * navegador se comprime con textLength si hace falta.
 */
export const ANCHO_POR_ALTO = 0.62

/** Alto de letra para que `texto` entre en `ancho`, con tope `maximo`. */
export function altoQueEntra(texto: string, ancho: number, maximo: number): number {
  const n = Math.max(1, texto.length)
  return Math.min(maximo, Math.floor((ancho / (n * ANCHO_POR_ALTO)) * 10) / 10)
}

// ── Banda ────────────────────────────────────────────────────────────────────

export const BANDA_ALTO = 30
export const BLOQUE_ANCHO = 32
/** Separación blanca entre el bloque del código y el patrón. */
const SEPARACION = 1.5

/** Formas del patrón de un producto, dentro de la zona dada. Pura. */
export function formasDelPatron(patron: PatronEtiqueta, z: { x: number; y: number; w: number; h: number }): Forma[] {
  const out: Forma[] = []
  switch (patron) {
    case 'liso':
      out.push({ t: 'rect', ...z })
      break
    case 'verticales': {
      const ancho = 4, paso = 8
      for (let x = z.x; x + ancho <= z.x + z.w + 0.01; x += paso) out.push({ t: 'rect', x, y: z.y, w: ancho, h: z.h })
      break
    }
    case 'horizontales': {
      const alto = 5, n = 3
      const paso = (z.h - alto) / (n - 1)
      for (let i = 0; i < n; i++) out.push({ t: 'rect', x: z.x, y: z.y + i * paso, w: z.w, h: alto })
      break
    }
    case 'cuadros': {
      const filas = 5
      const lado = z.h / filas
      const cols = Math.floor(z.w / lado)
      const x0 = z.x + (z.w - cols * lado) / 2
      for (let f = 0; f < filas; f++) {
        for (let c = 0; c < cols; c++) if ((f + c) % 2 === 0) out.push({ t: 'rect', x: x0 + c * lado, y: z.y + f * lado, w: lado, h: lado })
      }
      break
    }
    case 'diagonales': {
      const w = 10, paso = 9, grosor = 3.2
      const n = Math.floor((z.w - w) / paso) + 1
      const x0 = z.x + (z.w - ((n - 1) * paso + w)) / 2
      for (let i = 0; i < n; i++) out.push({ t: 'diagonal', x: x0 + i * paso, y: z.y, w, h: z.h, grosor })
      break
    }
    case 'marco':
      out.push({ t: 'rect', ...z, borde: 6 })
      break
    case 'puntos': {
      const d = 10, filas = 2
      const cols = Math.floor(z.w / (d + 2))
      const gx = (z.w - cols * d) / (cols + 1)
      const gy = (z.h - filas * d) / (filas + 1)
      for (let f = 0; f < filas; f++) {
        for (let c = 0; c < cols; c++) out.push({ t: 'circulo', x: z.x + gx + c * (d + gx), y: z.y + gy + f * (d + gy), d })
      }
      break
    }
  }
  return out
}

// ── Fecha ────────────────────────────────────────────────────────────────────

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']

/** Día del año (1 a 366), en hora local. */
export function diaDelAnio(d: Date): number {
  const inicio = new Date(d.getFullYear(), 0, 1)
  const hoy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((hoy.getTime() - inicio.getTime()) / 86_400_000) + 1
}

/** "DÍA 257 · LUN 14/09": el número ordena la rotación, la fecha la entiende cualquiera. */
export function lineaDia(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `DÍA ${diaDelAnio(d)} · ${DIAS[d.getDay()]} ${dd}/${mm}`
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// ── La etiqueta ──────────────────────────────────────────────────────────────

/** Escala una forma del diseño base al rollo real. */
function escalar(f: Forma, s: number, dx: number): Forma {
  const x = (v: number) => v * s + dx
  switch (f.t) {
    case 'rect': return { ...f, x: x(f.x), y: f.y * s, w: f.w * s, h: f.h * s, ...(f.borde ? { borde: f.borde * s } : {}) }
    case 'circulo': return { ...f, x: x(f.x), y: f.y * s, d: f.d * s }
    case 'diagonal': return { ...f, x: x(f.x), y: f.y * s, w: f.w * s, h: f.h * s, grosor: f.grosor * s }
    case 'texto': return { ...f, x: x(f.x), y: f.y * s, ancho: f.ancho * s, alto: f.alto * s }
    case 'qr': return { ...f, x: x(f.x), y: f.y * s, lado: f.lado * s }
    case 'barras': return { ...f, x: x(f.x), y: f.y * s, w: f.w * s, h: f.h * s }
  }
}

export function armarEtiquetaPallet(pallet: PalletProduccion, tam: TamanioEtiqueta = ETIQUETA_PALLET): EtiquetaPallet {
  const W = BASE.anchoMm
  const producto = PRODUCTOS_HIELO[pallet.productoId]
  const planta = PLANTA_INFO[pallet.plantaId]
  const fecha = pallet.fechaFabricacion.toDate()
  const unidad = producto.unidadLabel.toUpperCase()

  const formas: Forma[] = [
    // Banda: bloque negro con el código corto en blanco…
    { t: 'rect', x: 0, y: 0, w: BLOQUE_ANCHO, h: BANDA_ALTO },
    (() => {
      const alto = altoQueEntra(producto.codigoCorto, BLOQUE_ANCHO - 5, 20)
      return { t: 'texto', x: 2.5, y: (BANDA_ALTO - alto) / 2, ancho: BLOQUE_ANCHO - 5, alto, texto: producto.codigoCorto, blanco: true } as Forma
    })(),
    // …y el patrón del producto.
    ...formasDelPatron(producto.patron, { x: BLOQUE_ANCHO + SEPARACION, y: 0, w: W - BLOQUE_ANCHO - SEPARACION, h: BANDA_ALTO }),

    { t: 'texto', x: 3, y: 33, ancho: W - 6, alto: altoQueEntra(producto.nombreEtiqueta, W - 6, 5), texto: producto.nombreEtiqueta },
    (() => {
      const texto = `${pallet.unidades} ${unidad}`
      return { t: 'texto', x: 3, y: 40, ancho: W - 6, alto: altoQueEntra(texto, W - 6, 9), texto } as Forma
    })(),
    { t: 'qr', x: (W - 30) / 2, y: 51, lado: 30, dato: pallet.codigo },
    { t: 'texto', x: 3, y: 83, ancho: W - 6, alto: 5.5, texto: pallet.codigo },
    { t: 'barras', x: 8, y: 90, w: W - 16, h: 11, dato: pallet.codigo },
    (() => {
      const texto = lineaDia(fecha)
      return { t: 'texto', x: 3, y: 103, ancho: W - 6, alto: altoQueEntra(texto, W - 6, 7), texto } as Forma
    })(),
    (() => {
      const texto = `${planta.localidad} · ${hhmm(fecha)} · ${pallet.operador.nombre}`.toUpperCase()
      return { t: 'texto', x: 3, y: 112.5, ancho: W - 6, alto: altoQueEntra(texto, W - 6, 3), texto } as Forma
    })(),
  ]

  const s = Math.min(tam.anchoMm / BASE.anchoMm, tam.altoMm / BASE.altoMm)
  const dx = (tam.anchoMm - BASE.anchoMm * s) / 2
  return { tamanio: tam, formas: s === 1 && dx === 0 ? formas : formas.map((f) => escalar(f, s, dx)) }
}
