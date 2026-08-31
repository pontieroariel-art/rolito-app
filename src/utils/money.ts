// Helpers de dinero para las cobranzas de supervisor (admiten centavos, a
// diferencia de las cobranzas simples de caja/chofer que son enteras). Toda
// comparación/suma de importes se hace en CENTAVOS ENTEROS para evitar los
// clásicos errores de coma flotante (0.1 + 0.2 !== 0.3).

export function aCentavos(n: number): number {
  return Math.round(n * 100)
}

export function sumaCentavos(importes: number[]): number {
  return importes.reduce((s, n) => s + aCentavos(n), 0)
}

export function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

// "$1.234,56" — siempre con 2 decimales (los comprobantes de Tango, cheques y
// retenciones traen centavos).
export function formatoARS(n: number): string {
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Parsea lo que tipea el usuario en un input de importe con decimales
// (acepta "1234,56", "1234.56", "1.234,56"). Devuelve 0 si no parsea.
export function parseImporte(v: string): number {
  const limpio = v.trim().replace(/\$/g, '').replace(/\s/g, '')
  if (!limpio) return 0
  // Si tiene coma, la coma es el separador decimal y los puntos son de miles.
  const normalizado = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio
  const n = Number(normalizado)
  return Number.isFinite(n) && n >= 0 ? redondear2(n) : 0
}
