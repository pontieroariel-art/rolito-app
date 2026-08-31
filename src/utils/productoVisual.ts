import { CatalogProducto } from '../types'

// Color estable derivado del id (fallback cuando el producto no define color).
const PLACEHOLDER_COLORS = [
  '#2563eb', '#0891b2', '#4f46e5', '#0d9488', '#7c3aed', '#db2777',
  '#ea580c', '#16a34a', '#0ea5e9', '#64748b', '#9333ea', '#0284c7',
]
export function colorDeId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PLACEHOLDER_COLORS[h % PLACEHOLDER_COLORS.length]
}

/** Color del producto para badge y placeholder: el propio, o uno estable por id. */
export function colorDe(p: Pick<CatalogProducto, 'id' | 'color'>): string {
  return p.color || colorDeId(p.id)
}

/** Badge automático desde el nombre: el peso o el volumen ("10 kg", "6 L"). */
export function autoEtiqueta(nombre: string): string {
  const kg = nombre.match(/(\d+)\s*kg/i)
  if (kg) return `${kg[1]} kg`
  const lt = nombre.match(/(\d+)\s*(?:litros?|lts?|l)\b/i)
  if (lt) return `${lt[1]} L`
  return ''
}

/** Texto del badge de la tarjeta: el que cargó el usuario, o el automático. */
export function etiquetaDe(p: Pick<CatalogProducto, 'nombre' | 'etiqueta'>): string {
  return (p.etiqueta ?? '').trim() || autoEtiqueta(p.nombre)
}
