// Búsqueda "tolerante" para buscadores de clientes (y afines): minúsculas, sin
// acentos y solo letras/números. El autocorrector del iPad convierte "FC." en
// "F.C." y los usuarios escriben "fc280", "FC 280" o "F.C.280": todo tiene que
// encontrar a "FC.280". Lo mismo con "Peña" vs "Pena".

/** "F.C. 280 Peña" → "fc280pena" */
export function normalizarBusqueda(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '')
}

/**
 * true si `query` (ya normalizada o no) aparece en alguno de los `campos`.
 * Una query vacía o solo de puntuación coincide con todo.
 */
export function coincideBusqueda(query: string, ...campos: (string | null | undefined)[]): boolean {
  const q = normalizarBusqueda(query)
  if (!q) return true
  return campos.some((c) => normalizarBusqueda(c).includes(q))
}

/** Atributos para inputs de búsqueda: sin autocorrector ni mayúsculas automáticas del teléfono. */
export const INPUT_BUSQUEDA_PROPS = {
  autoCorrect: 'off',
  autoCapitalize: 'off',
  autoComplete: 'off',
  spellCheck: false,
} as const
