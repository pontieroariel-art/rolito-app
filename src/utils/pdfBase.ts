import type { jsPDF } from 'jspdf'

/**
 * BASE DE LOS PDF A4 de la app (fase 3.4 del reordenamiento, 2026-09-12).
 *
 * Los documentos operativos (liquidación del repartidor, cierre de caja, acta
 * de entrega a tesorería, remito de carga, listados, recibos, comodatos)
 * comparten el mismo papel: logo arriba a la izquierda, título a la derecha,
 * subtítulo, línea verde, tablas con encabezado verde, firmas y un pie con la
 * fecha de generación. Eso estaba copiado línea por línea en catorce lugares:
 * el logo se pedía catorce veces, la misma cabecera se dibujaba diez, y el
 * `doc.lastAutoTable.finalY` con su @ts-expect-error aparecía veinte veces.
 *
 * Estas funciones hacen EXACTAMENTE las mismas llamadas a jsPDF que hacía cada
 * documento, en el mismo orden: el PDF que sale es byte por byte el mismo.
 * No tocan datos, cálculos, columnas ni totales.
 *
 * Lo que NO pasa por acá, a propósito:
 *  - factura ARCA y factura X: tienen el formato que exige ARCA, con su propio
 *    encabezado, código de barras y QR (`facturaArcaPdf.ts`, `facturaPdf.ts`);
 *  - remito interno y comprobante interno: ya comparten `papelInternoPdf.ts`;
 *  - tickets de 80 mm: ya comparten `ticketTermico.ts`.
 */

const VERDE: [number, number, number] = [45, 106, 79]

/** Encabezado de tabla verde, el de todos los documentos operativos. */
export const ESTILO_CABECERA_TABLA = {
  fillColor: VERDE, textColor: 255, fontStyle: 'bold' as const, fontSize: 7.5,
}

export interface DocA4 {
  doc: jsPDF
  autoTable: typeof import('jspdf-autotable')['default']
  pageW: number
  pageH: number
  /** El logo ya reescalado, o null si no se pudo bajar. */
  logo: string | null
}

/**
 * Abre un A4 vertical en milímetros con jsPDF y autoTable ya importados (los
 * dos entran por `import()` para no cargarlos hasta que alguien pide un PDF) y
 * el logo resuelto una sola vez.
 */
export async function nuevoA4(): Promise<DocA4> {
  const [{ default: JsPDF }, { default: autoTable }, { fetchImageAsBase64 }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./pdf'),
  ])
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  return {
    doc,
    autoTable,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    logo: await fetchImageAsBase64('/logo-rolito.png'),
  }
}

/**
 * Logo + título a la derecha + subtítulo + línea verde. Devuelve la `y` donde
 * puede arrancar el contenido.
 *
 * `tamSubtitulo` y `yLinea` existen porque los documentos no eran idénticos:
 * la hoja de ruta y el historial de despacho usan una línea más abajo (30) y
 * el resto a 26; el subtítulo va en 10 en los cierres y en 9 en los listados.
 */
export function encabezadoA4(
  d: Pick<DocA4, 'doc' | 'pageW' | 'logo'>,
  titulo: string,
  subtitulo?: string,
  opts: { tamSubtitulo?: number; yLinea?: number; anchoLogo?: number; altoLogo?: number } = {},
): number {
  const { doc, pageW, logo } = d
  const { tamSubtitulo = 10, yLinea = 26, anchoLogo = 40, altoLogo = 13 } = opts

  if (logo) doc.addImage(logo, 'PNG', 14, 8, anchoLogo, altoLogo)
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text(titulo, pageW - 14, 14, { align: 'right' })
  if (subtitulo !== undefined) {
    doc.setFontSize(tamSubtitulo)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80)
    doc.text(subtitulo, pageW - 14, 20, { align: 'right' })
  }
  doc.setTextColor(0)
  doc.setDrawColor(...VERDE)
  doc.setLineWidth(0.6)
  doc.line(14, yLinea, pageW - 14, yLinea)
  return yLinea + 6
}

/** `y` después de la última tabla de autoTable (que lo deja en runtime). */
export function finTabla(doc: jsPDF, siNoHay: number): number {
  // @ts-expect-error jspdf-autotable agrega lastAutoTable en runtime
  return (doc.lastAutoTable?.finalY ?? siNoHay) as number
}

/** Pie con la fecha de generación, abajo a la derecha. */
export function pieA4(d: Pick<DocA4, 'doc' | 'pageW' | 'pageH'>, texto = 'Rolito app'): void {
  const { doc, pageW, pageH } = d
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(`Generado ${new Date().toLocaleString('es-AR')} · ${texto}`, pageW - 14, pageH - 8, { align: 'right' })
}

/**
 * Bloque de firma: etiqueta arriba, la firma dibujada, la raya y el aclarado.
 * Una firma inválida se omite en vez de romper el PDF.
 */
export function firmaA4(
  d: Pick<DocA4, 'doc'>,
  opts: { x: number; y: number; etiqueta: string; firma?: string; aclaracion: string; conRaya?: boolean; ancho?: number; alto?: number },
): void {
  const { doc } = d
  const { x, y, etiqueta, firma, aclaracion, conRaya = true, ancho = 50, alto = 20 } = opts
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(etiqueta, x, y + 4)
  if (firma) { try { doc.addImage(firma, 'PNG', x, y + 6, ancho, alto) } catch { /* firma inválida: se omite */ } }
  if (conRaya) {
    doc.setDrawColor(150)
    doc.setLineWidth(0.3)
    doc.line(x, y + 27, x + ancho + 10, y + 27)
  }
  doc.setTextColor(0)
  doc.text(aclaracion, x, y + (conRaya ? 31 : 30))
}

/** Devuelve el blob (para mandar por mail o WhatsApp) o baja el archivo. */
export function salidaPdf(doc: jsPDF, archivo: string, descargar?: boolean): Blob | void {
  if (descargar === false) return doc.output('blob')
  doc.save(archivo)
}
