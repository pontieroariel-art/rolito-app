import * as XLSX from 'xlsx'
import { DeliveryAddress } from '../../../types'

// Parser puro del Excel de importación masiva de clientes — separado del
// componente de UI para poder testearlo/reusarlo sin depender de React.

export interface ClientePreview {
  cuit:            string
  cuitDigits:      string
  email:           string        // Firebase Auth email — siempre sintético cuit@rolito.app
  emailContacto:   string        // email real del Excel, solo guardado en Firestore
  razonSocial:     string
  codigoCliente:   string
  telefono:        string
  notasContacto:   string
  fechaAlta:       Date | null
  addresses:       DeliveryAddress[]
  sucursales:      number
}

export function excelSerialToDate(serial: unknown): Date | null {
  if (typeof serial !== 'number' || serial <= 0) return null
  // Excel epoch: Dec 30 1899 (accounts for the 1900 leap-year bug)
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
}

export function cleanPhoneDigits(raw: unknown): string {
  if (!raw) return ''
  return String(raw).replace(/\D/g, '').slice(0, 20)
}

export function buildNotasContacto(t1: unknown, t2: unknown): string {
  const parts = [t1, t2]
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean)
  return parts.join(' / ')
}

export function parseExcelFile(file: File): Promise<ClientePreview[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data  = e.target?.result
        const wb    = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

        // Group by CUIT
        const map = new Map<string, typeof rows>()
        for (const row of rows) {
          const cuit = String(row['CUIT'] ?? '').trim()
          if (!cuit) continue
          if (!map.has(cuit)) map.set(cuit, [])
          map.get(cuit)!.push(row)
        }

        const clientes: ClientePreview[] = []
        for (const [cuit, grupo] of map.entries()) {
          const first       = grupo[0]
          const cuitDigits    = cuit.replace(/\D/g, '')
          const emailContacto = String(first['E_MAIL'] ?? '').trim().toLowerCase()
          const email         = `${cuitDigits}@rolito.app`   // Auth siempre sintético

          const addresses: DeliveryAddress[] = grupo.map((row, idx) => {
            const domicilio  = String(row['DOMICILIO']  ?? '').trim()
            const localidad  = String(row['LOCALIDAD']  ?? '').trim()
            const addressStr = [domicilio, localidad].filter(Boolean).join(', ')
            const cod        = String(row['COD_CTE '] ?? row['COD_CTE'] ?? '').trim()
            return {
              id:               cod || `addr-${idx}`,
              nombre:           cod || localidad || `Sucursal ${idx + 1}`,
              address:          addressStr,
              lat:              null,
              lng:              null,
              horarioApertura:  '',
              horarioCierre:    '',
              contactoNombre:   '',
              contactoTelefono: cleanPhoneDigits(row['TELEFONO_1']),
              // "Principal" queda como elección explícita, no se auto-marca
              // la primera fila (grupos empresarios con sucursales
              // equivalentes en el Excel).
              esPrincipal:      false,
            }
          })

          clientes.push({
            cuit,
            cuitDigits,
            email,
            emailContacto,
            razonSocial:   String(first['RAZON_SOCI'] ?? '').trim(),
            codigoCliente: String(first['COD_CTE '] ?? first['COD_CTE'] ?? '').trim(),
            telefono:      cleanPhoneDigits(first['TELEFONO_1']),
            notasContacto: buildNotasContacto(first['TELEFONO_1'], first['TELEFONO_2']),
            fechaAlta:     excelSerialToDate(first['FECHA_ALTA'] as unknown),
            addresses,
            sucursales:    grupo.length,
          })
        }
        resolve(clientes)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsArrayBuffer(file)
  })
}
