// Clases de las tablas de la app (fase 3.2, 2026-09-12). Estaban copiadas
// palabra por palabra en diez pantallas de expedición, tesorería y facturación.
// Las tablas de historial usan `HistorialTable`, que las aplica sola; las que
// arman su propio <table> (celdas muy particulares) importan estas constantes.
// Módulo aparte del componente para que una pantalla que solo quiere los
// estilos no se lleve el componente entero en su chunk.
//
// 2026-09-13, convenciones de diseño: el encabezado pasó de 11 px a 12 px (las
// mayúsculas diminutas no se leen en la tablet de planta), el gris salió a
// `text-secundario` y el separador de filas dejó de ser `gray-100`, que es
// azulado y cortaba la paleta cálida.

/** Encabezado de columna. */
export const TH = 'text-left text-xs uppercase tracking-wide text-secundario font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'

/** Celda. */
export const TD = 'px-2 py-1.5 border-b border-[#E7E5DC] text-sm'

/** Campo de filtro (mes, select) de una barra de historial. */
export const CAMPO_FILTRO = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

/**
 * Toda celda con importes, kilos o cantidades. Alinea a la derecha y fija el
 * ancho de la cifra para que la columna se lea en vertical sin que los números
 * bailen. `HistorialTable` lo aplica solo con `alinear: 'der'`.
 */
export const NUMERO = 'text-right tabular-nums'
