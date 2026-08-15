// Pin SVG circular con etiqueta — compartido entre ClientesMapPage (admin) y
// el mapa de clientes de heladeras. Requiere que la API de Google Maps ya
// esté cargada (usa google.maps.Size/Point).
export function makePin(fillColor: string, ringColor: string, label: string, size = 40) {
  const r        = size / 2 - 2
  const fontSize = label.length <= 3 ? 11 : label.length <= 5 ? 9 : 8
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 10}">` +
    `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="${fillColor}" stroke="${ringColor}" stroke-width="3.5"/>` +
    `<text x="${size/2}" y="${size/2 + fontSize/3}" text-anchor="middle" fill="white" ` +
    `font-size="${fontSize}" font-weight="bold" font-family="Arial,sans-serif">${label}</text>` +
    `<line x1="${size/2}" y1="${size-2}" x2="${size/2}" y2="${size+9}" stroke="${fillColor}" stroke-width="2.5"/>` +
    `</svg>`,
  )
  return {
    url:        `data:image/svg+xml;charset=UTF-8,${svg}`,
    scaledSize: new google.maps.Size(size, size + 10),
    anchor:     new google.maps.Point(size / 2, size + 10),
  }
}
