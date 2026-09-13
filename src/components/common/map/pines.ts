// Pines de los mapas (fase 3.3, 2026-09-12). Eran seis funciones que armaban
// el mismo SVG con otras medidas, repartidas en cuatro archivos. Todas piden
// que la API de Google Maps ya esté cargada (usan google.maps.Size/Point).

const icono = (svg: string, ancho: number, alto: number, anclaX: number, anclaY: number): google.maps.Icon => ({
  url:        `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
  scaledSize: new google.maps.Size(ancho, alto),
  anchor:     new google.maps.Point(anclaX, anclaY),
})

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Círculo con un texto adentro, anclado en su centro: el chofer en el mapa en
 * vivo (iniciales) y el resumen de logística (pedidos que le quedan).
 */
export function pinCircular(color: string, texto: string, opciones: { tamano?: number; borde?: string; grosorBorde?: number } = {}): google.maps.Icon {
  const { tamano = 44, borde = 'white', grosorBorde = 3 } = opciones
  const fuente = texto.length <= 2 ? 14 : texto.length <= 3 ? 12 : 10
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tamano}" height="${tamano}" viewBox="0 0 44 44">` +
    `<circle cx="22" cy="22" r="${20 - (grosorBorde - 3) / 2}" fill="${color}" stroke="${borde}" stroke-width="${grosorBorde}"/>` +
    `<text x="22" y="27" font-size="${fuente + 2}" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${escapar(texto)}</text>` +
    `</svg>`
  return icono(svg, tamano, tamano, tamano / 2, tamano / 2)
}

/**
 * Gota clásica con un texto adentro, anclada en la punta: la entrega en el
 * mapa en vivo y el pedido en la planificación.
 */
export function pinGota(color: string, texto: string, opciones: { ancho?: number } = {}): google.maps.Icon {
  const { ancho = 32 } = opciones
  const alto = Math.round(ancho * 40 / 32)
  const fuente = texto.length >= 3 ? 9 : 12
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 32 40">` +
    `<path d="M16 0C7.2 0 0 7.2 0 16c0 11 16 24 16 24s16-13 16-24C32 7.2 24.8 0 16 0z" fill="${color}"/>` +
    `<text x="16" y="21" font-size="${fuente}" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${escapar(texto)}</text>` +
    `</svg>`
  return icono(svg, ancho, alto, ancho / 2, alto)
}

/**
 * Círculo con etiqueta y palito, anclado en la base del palito: el cliente en
 * el mapa comercial y en el de heladeras.
 */
export function pinCliente(relleno: string, anillo: string, etiqueta: string, tamano = 40): google.maps.Icon {
  const r        = tamano / 2 - 2
  const fuente   = etiqueta.length <= 3 ? 11 : etiqueta.length <= 5 ? 9 : 8
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tamano}" height="${tamano + 10}">` +
    `<circle cx="${tamano / 2}" cy="${tamano / 2}" r="${r}" fill="${relleno}" stroke="${anillo}" stroke-width="3.5"/>` +
    `<text x="${tamano / 2}" y="${tamano / 2 + fuente / 3}" text-anchor="middle" fill="white" ` +
    `font-size="${fuente}" font-weight="bold" font-family="Arial,sans-serif">${escapar(etiqueta)}</text>` +
    `<line x1="${tamano / 2}" y1="${tamano - 2}" x2="${tamano / 2}" y2="${tamano + 9}" stroke="${relleno}" stroke-width="2.5"/>` +
    `</svg>`
  return icono(svg, tamano, tamano + 10, tamano / 2, tamano + 10)
}
