// PDF de la factura de promo (Rolito, letra X): el papel del talonario de
// PROMOCIÓN que usaba la empresa (ver papelInternoPdf.ts). No es un comprobante
// fiscal: sin QR de ARCA, sin CAE ni barras, "Código Nº: 00" y la leyenda
// "documento no válido como factura" al pie. Lleva la firma del cliente.

import type { ComprobanteInternoData } from './comprobanteInterno'
import { dibujarPapelInterno, type PapelInternoSpec } from './papelInternoPdf'

const fecha = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export function specFacturaX(d: ComprobanteInternoData): PapelInternoSpec {
  return {
    encabezado: { titulo: 'FÁBRICA DE HIELO', lineas: [] },
    letra: d.letra,
    codigoLetra: 'Código Nº: 00',
    tituloDocumento: d.titulo,
    numero: d.numero ?? 'SIN NÚMERO',
    fecha: fecha(d.fechaEmision),
    cliente: {
      nombre:         d.cliente.razonSocial,
      domicilio:      d.cliente.domicilio,
      localidadCp:    d.cliente.localidadCp,
      condicionIva:   d.cliente.condicionIva,
      codigo:         d.cliente.codigoCliente,
      cuit:           d.cliente.cuit,
      vendedor:       d.cliente.vendedor,
      condicionVenta: d.cliente.condicionVenta.toUpperCase(),
    },
    conPrecios: true,
    renglones: d.renglones.map((r) => ({
      descripcion:    r.descripcion.toUpperCase(),
      um:             'UNI',
      cantidad:       r.cantidad,
      precioUnitario: r.precioUnitario,
      importe:        r.total,
      ...(r.esCambio ? { nota: 'cambio sin cargo' } : {}),
    })),
    total: d.total,
    marcaAgua: 'GRACIAS POR SU COMPRA',
    pie: { lineas: d.numero ? [`Nº de control interno: ${d.numero}`] : [], leyenda: d.leyenda },
    ...(d.firma ? { firma: d.firma } : {}),
  }
}

export async function generateComprobanteInternoPdf(
  d: ComprobanteInternoData,
  opts: { descargar?: boolean } = {},
): Promise<Blob | void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  dibujarPapelInterno(doc, specFacturaX(d))
  if (opts.descargar === false) return doc.output('blob')
  doc.save(d.archivo)
}
