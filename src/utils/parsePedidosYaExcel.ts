import * as XLSX from 'xlsx'

// Parser puro del Excel de carga masiva de pedidos Pedidos Ya — separado del
// componente de UI para poder testearlo/reusarlo sin depender de React.
// Columnas esperadas: OC, CANTIDAD, TIENDA (informativa), CODIGO (matchea
// contra addresses[].id del cliente Delivery Hero), FECHA ENTREGA.

export interface PedidoYaRow {
  rowNum:        number
  oc:            string
  cantidad:      number
  tienda:        string
  codigo:        string
  fechaEntrega:  string   // YYYY-MM-DD, '' si no se pudo parsear
  parseError?:   string
}

const HEADER_ALIASES: Record<'oc' | 'cantidad' | 'tienda' | 'codigo' | 'fecha', string[]> = {
  oc:       ['OC', 'ORDEN DE COMPRA', 'N OC', 'NRO OC', 'NUMERO OC', 'NÚMERO OC'],
  cantidad: ['CANTIDAD', 'CANT'],
  tienda:   ['TIENDA', 'STORE'],
  codigo:   ['CODIGO', 'CÓDIGO', 'COD', 'COD SUCURSAL', 'CODIGO SUCURSAL'],
  fecha:    ['FECHA ENTREGA', 'FECHA DE ENTREGA', 'FECHA'],
}

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function buildHeaderMap(row: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const original of Object.keys(row)) {
    const norm = normalizeHeader(original)
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) && !(key in map)) map[key] = original
    }
  }
  return map
}

function parseCantidad(raw: unknown): number {
  const n = Number(String(raw ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? Math.trunc(n) : NaN
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseFecha(raw: unknown): string {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`
  }
  const str = String(raw ?? '').trim()
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`
  }
  return ''
}

export function parsePedidosYaExcel(file: File): Promise<PedidoYaRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data  = e.target?.result
        const wb    = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

        const result: PedidoYaRow[] = rows.map((row, idx) => {
          const h        = buildHeaderMap(row)
          const oc       = String(row[h.oc] ?? '').trim()
          const codigo   = String(row[h.codigo] ?? '').trim()
          const tienda   = String(row[h.tienda] ?? '').trim()
          const cantidad = parseCantidad(row[h.cantidad])
          const fechaEntrega = parseFecha(row[h.fecha])

          const errors: string[] = []
          if (!oc)                          errors.push('Falta OC')
          if (!codigo)                      errors.push('Falta código de sucursal')
          if (!Number.isFinite(cantidad) || cantidad <= 0) errors.push('Cantidad inválida')
          if (!fechaEntrega)                errors.push('Fecha de entrega inválida')

          return {
            rowNum:  idx + 2, // +2: encabezado (fila 1) + índice base 1
            oc,
            cantidad,
            tienda,
            codigo,
            fechaEntrega,
            parseError: errors.length > 0 ? errors.join(' · ') : undefined,
          }
        })

        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}
