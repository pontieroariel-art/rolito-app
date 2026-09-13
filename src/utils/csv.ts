// Exportación a CSV de las tablas de historial (fase 3.2, 2026-09-12).
//
// Separador `;` y BOM UTF-8: es lo que espera el Excel en español (con `,` el
// Excel argentino mete todo en una columna, y sin BOM come los acentos).
// `aCSV` es puro y está testeado; `descargarCSV` es la parte del navegador.

const BOM = '﻿'

/**
 * Una celda: comillas dobles si tiene `;`, comillas, salto de línea o espacios
 * al borde. Los números van con coma decimal y redondeados a dos decimales:
 * son pesos y cantidades, y sumar importes en punto flotante deja restos
 * (una diferencia de -1,13 salía -1,1300000000512227 en el Excel).
 */
export function celdaCSV(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return ''
    return String(Number.isInteger(valor) ? valor : Math.round(valor * 100) / 100).replace('.', ',')
  }
  const s = String(valor)
  return /[";\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function aCSV(encabezados: string[], filas: Array<Array<string | number | null | undefined>>): string {
  return [encabezados, ...filas].map((f) => f.map(celdaCSV).join(';')).join('\r\n')
}

/** Nombre de archivo sin caracteres que rompan en Windows. */
export function nombreArchivoCSV(base: string): string {
  const limpio = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  return `${limpio || 'export'}.csv`
}

export function descargarCSV(base: string, encabezados: string[], filas: Array<Array<string | number | null | undefined>>): void {
  const blob = new Blob([BOM + aCSV(encabezados, filas)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivoCSV(base)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sin revoke inmediato: Safari cancela la descarga si la URL muere antes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
