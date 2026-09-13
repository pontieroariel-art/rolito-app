// Clases de las tablas de la app (fase 3.2, 2026-09-12). Estaban copiadas
// palabra por palabra en diez pantallas de expedición, tesorería y facturación.
// Las tablas de historial usan `HistorialTable`, que las aplica sola; las que
// arman su propio <table> (celdas muy particulares) importan estas constantes.
// Módulo aparte del componente para que una pantalla que solo quiere los
// estilos no se lleve el componente entero en su chunk.

/** Encabezado de columna. */
export const TH = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'

/** Celda. */
export const TD = 'px-2 py-1.5 border-b border-gray-100 text-sm'

/** Campo de filtro (mes, select) de una barra de historial. */
export const CAMPO_FILTRO = 'bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
