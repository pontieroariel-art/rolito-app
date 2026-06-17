import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export interface PedidoParsed {
  numeroOC:     string
  clientName:   string
  clientAddress: string
  deliveryDate: string   // YYYY-MM-DD
  horaEntrega:  string
  products:     Array<{ name: string; quantity: number }>
}

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const pdf  = await pdfjsLib.getDocument({ data }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(
      content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join('\n'),
    )
  }
  return parts.join('\n')
}

function toISODate(ddmmyyyy: string): string {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

// Normaliza nombres de producto extraídos del PDF al catálogo interno
function normalizarProducto(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (s.includes('2') && s.includes('kg') && (s.includes('bolsa') || s.includes('hielo'))) return 'Hielo bolsa 2kg'
  if (s.includes('3') && s.includes('kg') && s.includes('bolsa'))  return 'Hielo bolsa 3kg'
  if (s.includes('10') && s.includes('kg') && s.includes('picado')) return 'Hielo picado bolsa 10kg'
  if (s.includes('10') && s.includes('kg') && s.includes('escama')) return 'Hielo en escamas 10kg'
  if (s.includes('10') && s.includes('kg') && s.includes('bolsa')) return 'Hielo bolsa 10kg'
  if (s.includes('barra'))                                           return 'Barra de hielo'
  if (s.includes('anticorrosivo'))                                   return 'Anticorrosivo'
  return raw // si no matchea nada conocido, dejar el nombre original
}

export function parsePedido(text: string): PedidoParsed | null {
  if (/Purchase Order:\s*PO\w+/i.test(text))             return parsePOFormat(text)
  if (/OrdJosimarAPlx|Comprador:\s*JOSIMAR/i.test(text)) return parseJosimarFormat(text)
  if (/OrdCotoPlx|COTO\s+CICSA/i.test(text))             return parseCotoFormat(text)
  if (/OrdIncPlx|OC_Carrefour|Nro\.\s*OC:/i.test(text)) return parseCarrefourFormat(text)
  return null
}

function parsePOFormat(text: string): PedidoParsed {
  const ocMatch   = text.match(/Purchase Order:\s*(PO\w+)/i)
  const numeroOC  = ocMatch?.[1] ?? ''

  const storeSection = text.split(/Store Information:/i)[1] ?? ''
  const storeLines   = storeSection.split('\n').map((s) => s.trim()).filter(Boolean)
  const clientName   = storeLines[0] ?? ''
  const clientAddress = storeLines.slice(1, 3).filter(Boolean).join(', ')

  // Data row format: "PO789011 04/05/2026 12:12 05/05/2026"
  const dateRowMatch = text.match(/PO\w+\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{2}\/\d{2}\/\d{4})/)
  const deliveryDate = dateRowMatch ? toISODate(dateRowMatch[2]) : ''

  const qtyMatch = text.match(/Total Case Number:\s*(\d+)/i)
  const qty      = qtyMatch ? parseInt(qtyMatch[1]) : 0

  // Product name: lines after barcode
  const barcodeIdx = text.indexOf('7798021470027')
  const afterBarcode = barcodeIdx >= 0 ? text.slice(barcodeIdx + 13) : ''
  const nameLines = afterBarcode.split('\n').map((s) => s.trim()).filter(Boolean)
  const rawName   = nameLines.slice(0, 2).join(' ').split(/\s+EA\s/i)[0].trim()
  const productName = normalizarProducto(rawName || 'Hielo bolsa 2kg')

  return { numeroOC, clientName, clientAddress, deliveryDate, horaEntrega: '', products: [{ name: productName, quantity: qty }] }
}

function parseJosimarFormat(text: string): PedidoParsed {
  // Nro OC: "Número OC:\n4501262733"
  const numeroOC    = text.match(/N[uú]mero\s+OC:\s*(\d+)/i)?.[1] ?? ''

  // Nombre del comprador: "Comprador:\nJOSIMAR"
  const clientName  = text.match(/Comprador:\s*([^\n\r]+)/i)?.[1]?.trim() ?? ''

  // Lugar de entrega: "Lugar Entrega:\nCalle 13 Esquina 150..."
  const clientAddress = text.match(/Lugar\s+Entrega:\s*([^\n\r]+)/i)?.[1]?.trim() ?? ''

  // Fecha entrega: "Fecha Entrega:\n19/06/2026"
  const dateRaw      = text.match(/Fecha\s+Entrega:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? ''
  const deliveryDate = dateRaw ? toISODate(dateRaw) : ''

  // Cantidad: "Cantidad Cajas:\n12"
  const qty = parseInt(text.match(/Cantidad\s+Cajas:\s*(\d+)/i)?.[1] ?? '0')

  const products = qty > 0
    ? [{ name: normalizarProducto('ROLITO HIELO BOLSA 2 Kg'), quantity: qty }]
    : []

  return { numeroOC, clientName, clientAddress, deliveryDate, horaEntrega: '', products }
}

function parseCotoFormat(text: string): PedidoParsed {
  // Nro OC: "Pedido:\n59595870092" (mínimo 8 dígitos para evitar falsos matches)
  const numeroOC    = text.match(/Pedido:\s*(\d{8,})/)?.[1] ?? ''

  // Nombre del lugar: "L. de Entrega:\nVTE LOPEZ"
  const clientName  = text.match(/L\.\s*de\s+Entrega:\s*([^\n\r]+)/i)?.[1]?.trim() ?? ''

  // Fecha entrega: "Fecha de Entrega:\n17/06/2026"
  const dateRaw      = text.match(/Fecha\s+de\s+Entrega:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? ''
  const deliveryDate = dateRaw ? toISODate(dateRaw) : ''

  // Cantidad: línea del EAN → "{EAN}\n{qty}\n1\n..."
  // Coto no muestra precio, se extrae solo la cantidad
  const qtyMatch = text.match(/7798021470027\s*(\d+)\s*1/)
  const qty      = qtyMatch ? parseInt(qtyMatch[1]) : 0

  const products = qty > 0
    ? [{ name: normalizarProducto('HIELO . ROLITO BSA 2 KGM'), quantity: qty }]
    : []

  return { numeroOC, clientName, clientAddress: '', deliveryDate, horaEntrega: '', products }
}

function parseCarrefourFormat(text: string): PedidoParsed {
  // 16-digit OC number (Carrefour format starts with 019...)
  const ocMatch  = text.match(/\b(0\d{15})\b/)
  const numeroOC = ocMatch?.[1] ?? ''

  const nameMatch  = text.match(/Nombre:\s*([^\n]+)/)
  const clientName = nameMatch?.[1]?.trim() ?? ''

  const domMatch    = text.match(/Domicilio:\s*([^\n]+)/)
  const clientAddress = domMatch?.[1]?.trim() ?? ''

  // First date after "Fecha entrega:" label
  const afterFechaEntrega = text.split(/Fecha entrega:/i)[1] ?? ''
  const dateMatch = afterFechaEntrega.match(/(\d{2}\/\d{2}\/\d{4})/)
  const deliveryDate = dateMatch ? toISODate(dateMatch[1]) : ''

  const horaMatch  = text.match(/Hora de entrega:\s*([\d:]+)/)
  const horaEntrega = horaMatch?.[1] ?? ''

  // Product row: "7798021470027 HIELO BOLSA ROLITO POR 2 KG CJ 1 174 1560.0000 ..."
  const productRowMatch = text.match(/7798021470027\s+([A-ZÁÉÍÓÚÑ\s\d]+?)\s+(?:CJ|EA|UN|KG)\s+\d+\s+(\d+)\s+[\d.,]+/i)
  const qty         = productRowMatch ? parseInt(productRowMatch[2]) : 0
  const productName = normalizarProducto(productRowMatch?.[1]?.trim() || 'Hielo bolsa 2kg')

  return { numeroOC, clientName, clientAddress, deliveryDate, horaEntrega, products: [{ name: productName, quantity: qty }] }
}
